/**
 * Request Cache for API Calls
 *
 * Provides a simple TTL-based cache for API requests to reduce
 * redundant network calls and improve performance.
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

export interface CacheConfig {
  defaultTTL: number       // Default time-to-live in ms
  maxEntries: number       // Maximum number of cached entries
  cleanupInterval: number  // Interval for cleanup in ms
}

const DEFAULT_CONFIG: CacheConfig = {
  defaultTTL: 30000,       // 30 seconds
  maxEntries: 100,
  cleanupInterval: 60000   // 1 minute
}

/**
 * Generic request cache with TTL support
 */
export class RequestCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private config: CacheConfig
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.startCleanup()
  }

  /**
   * Get a cached value
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data
  }

  /**
   * Set a cached value
   */
  set(key: string, data: T, ttl?: number): void {
    const actualTTL = ttl ?? this.config.defaultTTL
    const now = Date.now()

    // Enforce max entries
    if (this.cache.size >= this.config.maxEntries && !this.cache.has(key)) {
      this.evictOldest()
    }

    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + actualTTL
    })
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete a cached value
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Clear all cached values
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the number of cached entries
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Execute a function with caching
   * If the value is cached and not expired, return it
   * Otherwise, execute the function and cache the result
   */
  async getOrFetch(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) {
      return cached
    }

    const data = await fetchFn()
    this.set(key, data, ttl)
    return data
  }

  /**
   * Evict the oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return

    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Stop the cleanup timer
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.clear()
  }
}

// ============================================
// Pre-configured Caches
// ============================================

/**
 * Cache for balance queries (30 second TTL)
 */
export const balanceCache = new RequestCache<number>({
  defaultTTL: 30000,
  maxEntries: 20
})

/**
 * Cache for UTXO queries (15 second TTL - shorter for transaction safety)
 */
export const utxoCache = new RequestCache<unknown[]>({
  defaultTTL: 15000,
  maxEntries: 20
})

/**
 * Cache for fee rate queries (5 minute TTL)
 */
export const feeRateCache = new RequestCache<number>({
  defaultTTL: 300000,
  maxEntries: 1
})

/**
 * Cache for transaction details (1 hour TTL - transactions don't change)
 */
export const txDetailsCache = new RequestCache<unknown>({
  defaultTTL: 3600000,
  maxEntries: 50
})

/**
 * Cache for block height (30 second TTL)
 */
export const blockHeightCache = new RequestCache<number>({
  defaultTTL: 30000,
  maxEntries: 1
})

// ============================================
// Utility Functions
// ============================================

/**
 * Create a cache key from URL and params
 */
export function createCacheKey(url: string, params?: Record<string, string | number | boolean>): string {
  if (!params) return url
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return `${url}?${sortedParams}`
}

/**
 * Clear all API caches
 */
export function clearAllCaches(): void {
  balanceCache.clear()
  utxoCache.clear()
  feeRateCache.clear()
  txDetailsCache.clear()
  blockHeightCache.clear()
}

export default RequestCache
