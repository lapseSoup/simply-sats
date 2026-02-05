/**
 * Cancellation Service for Simply Sats
 *
 * Provides AbortController management for cancellable async operations.
 * Use this to prevent memory leaks when components unmount during async operations.
 */

/**
 * A cancellation token that can be passed to async operations
 */
export interface CancellationToken {
  signal: AbortSignal
  throwIfCancelled: () => void
  isCancelled: boolean
}

/**
 * Controller for managing cancellation of async operations
 */
export class CancellationController {
  private controller: AbortController

  constructor() {
    this.controller = new AbortController()
  }

  /**
   * Get a token to pass to cancellable operations
   */
  get token(): CancellationToken {
    return {
      signal: this.controller.signal,
      throwIfCancelled: () => {
        if (this.controller.signal.aborted) {
          throw new CancellationError('Operation was cancelled')
        }
      },
      get isCancelled() {
        return this.signal.aborted
      }
    }
  }

  /**
   * Cancel all operations using this controller
   */
  cancel(): void {
    this.controller.abort()
  }

  /**
   * Check if operations have been cancelled
   */
  get isCancelled(): boolean {
    return this.controller.signal.aborted
  }

  /**
   * Reset the controller for reuse
   */
  reset(): void {
    this.controller = new AbortController()
  }
}

/**
 * Error thrown when an operation is cancelled
 */
export class CancellationError extends Error {
  readonly isCancellation = true

  constructor(message = 'Operation was cancelled') {
    super(message)
    this.name = 'CancellationError'
  }
}

/**
 * Check if an error is a cancellation error
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return (
    error instanceof CancellationError ||
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'isCancellation' in error)
  )
}

/**
 * Global sync controller - used to cancel wallet sync operations
 */
let syncController: CancellationController | null = null

/**
 * Sync mutex to prevent database race conditions
 * Ensures only one sync operation runs at a time
 */
class SyncMutex {
  private locked = false
  private currentSyncPromise: Promise<void> | null = null
  private resolveCurrentSync: (() => void) | null = null

  /**
   * Acquire the mutex. If locked, waits for current sync to complete.
   * Returns a release function that must be called when sync is done.
   */
  async acquire(): Promise<() => void> {
    // If there's a sync in progress, wait for it to complete
    if (this.locked && this.currentSyncPromise) {
      await this.currentSyncPromise
    }

    this.locked = true
    this.currentSyncPromise = new Promise(resolve => {
      this.resolveCurrentSync = resolve
    })

    return () => this.release()
  }

  private release(): void {
    this.locked = false
    if (this.resolveCurrentSync) {
      this.resolveCurrentSync()
      this.resolveCurrentSync = null
      this.currentSyncPromise = null
    }
  }

  get isLocked(): boolean {
    return this.locked
  }
}

const syncMutex = new SyncMutex()

/**
 * Check if a sync is currently in progress
 */
export function isSyncInProgress(): boolean {
  return syncMutex.isLocked
}

/**
 * Acquire the sync mutex. Returns a release function.
 * Use this to ensure exclusive access during sync operations.
 */
export async function acquireSyncLock(): Promise<() => void> {
  return syncMutex.acquire()
}

/**
 * Get the current sync cancellation controller, creating one if needed
 */
export function getSyncController(): CancellationController {
  if (!syncController) {
    syncController = new CancellationController()
  }
  return syncController
}

/**
 * Cancel any ongoing sync operations
 */
export function cancelSync(): void {
  if (syncController) {
    syncController.cancel()
    syncController = null
  }
}

/**
 * Start a new sync session (cancels any previous sync)
 */
export function startNewSync(): CancellationToken {
  cancelSync()
  syncController = new CancellationController()
  return syncController.token
}

/**
 * Run an async operation with cancellation support
 * Returns undefined if cancelled, otherwise returns the result
 */
export async function withCancellation<T>(
  operation: (token: CancellationToken) => Promise<T>,
  token?: CancellationToken
): Promise<T | undefined> {
  const controller = token ? null : new CancellationController()
  const activeToken = token || controller!.token

  try {
    return await operation(activeToken)
  } catch (error) {
    if (isCancellationError(error)) {
      return undefined
    }
    throw error
  }
}

/**
 * Create a delay that can be cancelled
 */
export function cancellableDelay(ms: number, token: CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token.isCancelled) {
      reject(new CancellationError())
      return
    }

    const timeoutId = setTimeout(resolve, ms)

    token.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId)
      reject(new CancellationError())
    }, { once: true })
  })
}
