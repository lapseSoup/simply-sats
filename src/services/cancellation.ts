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
 * Ensures only one sync/send operation runs at a time.
 * Uses a promise chain to properly serialize all contenders (not just 2).
 */
class SyncMutex {
  private _tail: Promise<void> = Promise.resolve()
  private _locked = false

  /**
   * Acquire the mutex. Queues behind all prior holders.
   * Returns a release function that must be called when done.
   */
  async acquire(): Promise<() => void> {
    let release: () => void
    const prev = this._tail
    this._tail = new Promise<void>(resolve => {
      release = () => {
        this._locked = false
        resolve()
      }
    })
    // Wait for the previous holder to release
    await prev
    this._locked = true
    return release!
  }

  get isLocked(): boolean {
    return this._locked
  }
}

const syncMutexes = new Map<number, SyncMutex>()

/**
 * Get or lazily create a mutex for the given account
 */
function getMutex(accountId: number): SyncMutex {
  let mutex = syncMutexes.get(accountId)
  if (!mutex) {
    mutex = new SyncMutex()
    syncMutexes.set(accountId, mutex)
  }
  return mutex
}

/**
 * Check if a sync is currently in progress.
 * If accountId is provided, checks only that account.
 * If omitted, checks if ANY account is syncing.
 */
export function isSyncInProgress(accountId?: number): boolean {
  if (accountId !== undefined) {
    const mutex = syncMutexes.get(accountId)
    return mutex ? mutex.isLocked : false
  }
  // Check if any account has an active lock
  for (const mutex of syncMutexes.values()) {
    if (mutex.isLocked) return true
  }
  return false
}

/**
 * Acquire the sync mutex for a specific account. Returns a release function.
 * Use this to ensure exclusive access during sync operations.
 * Each account has its own lock so cross-account operations don't block each other.
 */
export async function acquireSyncLock(accountId: number = 1): Promise<() => void> {
  return getMutex(accountId).acquire()
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

    const onAbort = () => {
      clearTimeout(timeoutId)
      reject(new CancellationError())
    }

    const timeoutId = setTimeout(() => {
      token.signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    token.signal.addEventListener('abort', onAbort, { once: true })
  })
}
