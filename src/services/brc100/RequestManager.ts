/**
 * BRC-100 Request Manager
 *
 * Class-based management of pending BRC-100 requests.
 * Replaces global mutable state with encapsulated instance.
 */

import type { BRC100Request, BRC100Response } from './types'

interface PendingRequest {
  request: BRC100Request
  resolve: (response: BRC100Response) => void
  reject: (error: Error) => void
  createdAt: number
}

/**
 * Manages pending BRC-100 requests awaiting user approval.
 * Provides cleanup of stale requests and thread-safe operations.
 */
export class RequestManager {
  private pending = new Map<string, PendingRequest>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private requestCallback: ((request: BRC100Request) => void) | null = null
  private ttlMs: number

  constructor(ttlMs: number = 5 * 60 * 1000) {
    this.ttlMs = ttlMs
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), this.ttlMs)
  }

  /**
   * Set the callback for when new requests arrive
   */
  setRequestHandler(callback: (request: BRC100Request) => void): void {
    this.requestCallback = callback
  }

  /**
   * Get the current request handler
   */
  getRequestHandler(): ((request: BRC100Request) => void) | null {
    return this.requestCallback
  }

  /**
   * Add a pending request
   */
  add(
    id: string,
    request: BRC100Request,
    resolve: (response: BRC100Response) => void,
    reject: (error: Error) => void
  ): void {
    this.pending.set(id, {
      request,
      resolve,
      reject,
      createdAt: Date.now()
    })

    // Notify UI if callback is set
    if (this.requestCallback) {
      this.requestCallback(request)
    }
  }

  /**
   * Get a pending request by ID
   */
  get(id: string): PendingRequest | undefined {
    return this.pending.get(id)
  }

  /**
   * Check if a request exists
   */
  has(id: string): boolean {
    return this.pending.has(id)
  }

  /**
   * Remove a pending request
   */
  remove(id: string): boolean {
    return this.pending.delete(id)
  }

  /**
   * Get all pending requests
   */
  getAll(): BRC100Request[] {
    return Array.from(this.pending.values()).map(p => p.request)
  }

  /**
   * Resolve a pending request with a response
   */
  resolve(id: string, response: BRC100Response): void {
    const pending = this.pending.get(id)
    if (pending) {
      pending.resolve(response)
      this.pending.delete(id)
    }
  }

  /**
   * Reject a pending request with an error
   */
  reject(id: string, error: Error): void {
    const pending = this.pending.get(id)
    if (pending) {
      pending.reject(error)
      this.pending.delete(id)
    }
  }

  /**
   * Clean up stale requests older than TTL
   */
  cleanup(): void {
    const now = Date.now()
    for (const [id, pending] of this.pending.entries()) {
      if (now - pending.createdAt > this.ttlMs) {
        // Reject stale request
        pending.reject(new Error('Request timed out'))
        this.pending.delete(id)
      }
    }
  }

  /**
   * Get the count of pending requests
   */
  get size(): number {
    return this.pending.size
  }

  /**
   * Stop the cleanup interval (for shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }

    // Reject all pending requests
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(new Error('Request manager destroyed'))
      this.pending.delete(id)
    }
  }
}

// Singleton instance for backward compatibility
let requestManagerInstance: RequestManager | null = null

/**
 * Get the global RequestManager instance
 */
export function getRequestManager(): RequestManager {
  if (!requestManagerInstance) {
    requestManagerInstance = new RequestManager()
  }
  return requestManagerInstance
}

/**
 * Reset the global RequestManager (for testing)
 */
export function resetRequestManager(): void {
  if (requestManagerInstance) {
    requestManagerInstance.destroy()
    requestManagerInstance = null
  }
}
