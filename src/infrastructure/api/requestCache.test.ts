// @vitest-environment node

/**
 * Tests for Request Cache (requestCache.ts)
 *
 * Covers: RequestCache class (get, set, has, delete, clear, size, getOrFetch,
 *         eviction, expiration, cleanup, dispose),
 *         createCacheKey, clearAllCaches, pre-configured caches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RequestCache,
  createCacheKey,
  clearAllCaches,
  balanceCache,
  utxoCache,
  feeRateCache,
  txDetailsCache,
  blockHeightCache,
} from './requestCache'

describe('RequestCache', () => {
  let cache: RequestCache<string>

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new RequestCache<string>({ defaultTTL: 1000, maxEntries: 3, cleanupInterval: 5000 })
  })

  afterEach(() => {
    cache.dispose()
    vi.useRealTimers()
  })

  // =========================================================================
  // get / set
  // =========================================================================

  describe('get and set', () => {
    it('should return undefined for missing key', () => {
      expect(cache.get('missing')).toBeUndefined()
    })

    it('should store and retrieve a value', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should overwrite existing value', () => {
      cache.set('key1', 'first')
      cache.set('key1', 'second')
      expect(cache.get('key1')).toBe('second')
    })

    it('should use custom TTL when provided', () => {
      cache.set('short', 'data', 100) // 100ms TTL
      expect(cache.get('short')).toBe('data')

      vi.advanceTimersByTime(101)
      expect(cache.get('short')).toBeUndefined()
    })

    it('should expire after default TTL', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')

      vi.advanceTimersByTime(1001) // Past 1000ms TTL
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should not expire before TTL', () => {
      cache.set('key1', 'value1')
      vi.advanceTimersByTime(999) // Just before TTL
      expect(cache.get('key1')).toBe('value1')
    })
  })

  // =========================================================================
  // has
  // =========================================================================

  describe('has', () => {
    it('should return false for missing key', () => {
      expect(cache.has('missing')).toBe(false)
    })

    it('should return true for existing key', () => {
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
    })

    it('should return false for expired key', () => {
      cache.set('key1', 'value1')
      vi.advanceTimersByTime(1001)
      expect(cache.has('key1')).toBe(false)
    })
  })

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should delete an existing key and return true', () => {
      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeUndefined()
    })

    it('should return false for non-existent key', () => {
      expect(cache.delete('missing')).toBe(false)
    })
  })

  // =========================================================================
  // clear
  // =========================================================================

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'val1')
      cache.set('key2', 'val2')
      cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
    })
  })

  // =========================================================================
  // size
  // =========================================================================

  describe('size', () => {
    it('should track number of entries', () => {
      expect(cache.size).toBe(0)
      cache.set('key1', 'val1')
      expect(cache.size).toBe(1)
      cache.set('key2', 'val2')
      expect(cache.size).toBe(2)
    })
  })

  // =========================================================================
  // eviction
  // =========================================================================

  describe('eviction', () => {
    it('should evict oldest entry when maxEntries is exceeded', () => {
      cache.set('key1', 'val1')
      vi.advanceTimersByTime(10)
      cache.set('key2', 'val2')
      vi.advanceTimersByTime(10)
      cache.set('key3', 'val3')
      vi.advanceTimersByTime(10)

      // Adding a 4th entry should evict key1 (oldest)
      cache.set('key4', 'val4')

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('val2')
      expect(cache.get('key3')).toBe('val3')
      expect(cache.get('key4')).toBe('val4')
      expect(cache.size).toBe(3)
    })

    it('should not evict when updating existing key', () => {
      cache.set('key1', 'val1')
      cache.set('key2', 'val2')
      cache.set('key3', 'val3')

      // Update existing key — should not trigger eviction
      cache.set('key1', 'updated')

      expect(cache.size).toBe(3)
      expect(cache.get('key1')).toBe('updated')
      expect(cache.get('key2')).toBe('val2')
      expect(cache.get('key3')).toBe('val3')
    })
  })

  // =========================================================================
  // getOrFetch
  // =========================================================================

  describe('getOrFetch', () => {
    it('should return cached value without calling fetchFn', async () => {
      cache.set('key1', 'cached')
      const fetchFn = vi.fn().mockResolvedValue('fetched')

      const result = await cache.getOrFetch('key1', fetchFn)

      expect(result).toBe('cached')
      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('should call fetchFn and cache result when not cached', async () => {
      const fetchFn = vi.fn().mockResolvedValue('fetched')

      const result = await cache.getOrFetch('key1', fetchFn)

      expect(result).toBe('fetched')
      expect(fetchFn).toHaveBeenCalledOnce()
      expect(cache.get('key1')).toBe('fetched')
    })

    it('should call fetchFn when cached value has expired', async () => {
      cache.set('key1', 'old')
      vi.advanceTimersByTime(1001)

      const fetchFn = vi.fn().mockResolvedValue('new')
      const result = await cache.getOrFetch('key1', fetchFn)

      expect(result).toBe('new')
      expect(fetchFn).toHaveBeenCalledOnce()
    })

    it('should use custom TTL for fetched values', async () => {
      const fetchFn = vi.fn().mockResolvedValue('data')

      await cache.getOrFetch('key1', fetchFn, 500)

      vi.advanceTimersByTime(499)
      expect(cache.get('key1')).toBe('data')

      vi.advanceTimersByTime(2)
      expect(cache.get('key1')).toBeUndefined()
    })
  })

  // =========================================================================
  // cleanup (internal)
  // =========================================================================

  describe('cleanup timer', () => {
    it('should remove expired entries on cleanup interval', () => {
      cache.set('key1', 'val1', 100) // 100ms TTL
      cache.set('key2', 'val2', 10000) // 10s TTL

      // Advance past TTL of key1 and past cleanup interval
      vi.advanceTimersByTime(5001)

      // Cleanup should have removed key1
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe('val2')
    })
  })

  // =========================================================================
  // dispose
  // =========================================================================

  describe('dispose', () => {
    it('should clear all entries and stop cleanup timer', () => {
      cache.set('key1', 'val1')
      cache.dispose()

      expect(cache.size).toBe(0)
    })
  })
})

// =========================================================================
// createCacheKey
// =========================================================================

describe('createCacheKey', () => {
  it('should return URL when no params', () => {
    expect(createCacheKey('/api/balance')).toBe('/api/balance')
  })

  it('should append sorted params to URL', () => {
    const key = createCacheKey('/api/data', { b: 'two', a: 'one' })
    expect(key).toBe('/api/data?a=one&b=two')
  })

  it('should handle numeric and boolean params', () => {
    const key = createCacheKey('/api', { limit: 100, active: true })
    expect(key).toBe('/api?active=true&limit=100')
  })
})

// =========================================================================
// Pre-configured caches
// =========================================================================

describe('Pre-configured caches', () => {
  afterEach(() => {
    clearAllCaches()
  })

  it('should export balanceCache', () => {
    balanceCache.set('addr1', 50000)
    expect(balanceCache.get('addr1')).toBe(50000)
  })

  it('should export utxoCache', () => {
    utxoCache.set('addr1', [{ txid: 'tx1' }])
    expect(utxoCache.get('addr1')).toEqual([{ txid: 'tx1' }])
  })

  it('should export feeRateCache', () => {
    feeRateCache.set('rate', 0.5)
    expect(feeRateCache.get('rate')).toBe(0.5)
  })

  it('should export txDetailsCache', () => {
    txDetailsCache.set('tx1', { txid: 'tx1', vin: [] })
    expect(txDetailsCache.get('tx1')).toEqual({ txid: 'tx1', vin: [] })
  })

  it('should export blockHeightCache', () => {
    blockHeightCache.set('height', 800000)
    expect(blockHeightCache.get('height')).toBe(800000)
  })
})

// =========================================================================
// clearAllCaches
// =========================================================================

describe('clearAllCaches', () => {
  it('should clear all pre-configured caches', () => {
    balanceCache.set('addr1', 50000)
    utxoCache.set('addr1', [])
    feeRateCache.set('rate', 0.5)
    txDetailsCache.set('tx1', {})
    blockHeightCache.set('height', 800000)

    clearAllCaches()

    expect(balanceCache.get('addr1')).toBeUndefined()
    expect(utxoCache.get('addr1')).toBeUndefined()
    expect(feeRateCache.get('rate')).toBeUndefined()
    expect(txDetailsCache.get('tx1')).toBeUndefined()
    expect(blockHeightCache.get('height')).toBeUndefined()
  })
})
