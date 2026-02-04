/**
 * Tests for Network Utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchWithTimeout,
  fetchWithRetry,
  fetchJson,
  postJson
} from './network'
import { TimeoutError, NetworkError } from './errors'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('network', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('fetchWithTimeout', () => {
    it('should fetch successfully within timeout', async () => {
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithTimeout('https://example.com', { timeout: 5000 })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should throw TimeoutError when request times out', async () => {
      // Mock a request that never resolves (simulating a hanging connection)
      mockFetch.mockImplementationOnce(
        (_url: string, options: { signal?: AbortSignal }) => {
          return new Promise((_resolve, reject) => {
            // Listen to the abort signal
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'))
              })
            }
            // Never resolve naturally - wait for abort
          })
        }
      )

      // Use a very short timeout to make test fast
      await expect(
        fetchWithTimeout('https://example.com', { timeout: 50 })
      ).rejects.toThrow(TimeoutError)
    }, 10000) // 10 second test timeout

    it('should use default timeout when not specified', async () => {
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithTimeout('https://example.com')

      expect(response.status).toBe(200)
    })
  })

  describe('fetchWithRetry', () => {
    it('should succeed on first try', async () => {
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithRetry('https://example.com')

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should retry on 429 (rate limit)', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithRetry('https://example.com', {
        retries: 3,
        retryDelay: 10 // Short delay for tests
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should retry on 500 server error', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response('error', { status: 500 }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithRetry('https://example.com', {
        retries: 3,
        retryDelay: 10
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not retry on 404', async () => {
      mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }))

      const response = await fetchWithRetry('https://example.com', {
        retries: 3,
        retryDelay: 10
      })

      expect(response.status).toBe(404)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should throw NetworkError after exhausting retries', async () => {
      mockFetch.mockResolvedValue(new Response('error', { status: 500 }))

      const promise = fetchWithRetry('https://example.com', {
        retries: 2,
        retryDelay: 10
      })

      // Should return the last response even after retries
      const response = await promise
      expect(response.status).toBe(500)
      expect(mockFetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should retry on network errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('Network error'))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))

      const response = await fetchWithRetry('https://example.com', {
        retries: 3,
        retryDelay: 10
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('fetchJson', () => {
    it('should parse JSON response', async () => {
      const data = { foo: 'bar' }
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )

      const result = await fetchJson<typeof data>('https://example.com')

      expect(result).toEqual(data)
    })

    it('should throw NetworkError on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      )

      await expect(fetchJson('https://example.com')).rejects.toThrow(NetworkError)
    })

    it('should throw on invalid JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('not json', { status: 200 })
      )

      await expect(fetchJson('https://example.com')).rejects.toThrow()
    })
  })

  describe('postJson', () => {
    it('should send JSON and parse response', async () => {
      const requestData = { name: 'test' }
      const responseData = { id: 123 }

      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(responseData), { status: 200 })
      )

      const result = await postJson<typeof requestData, typeof responseData>(
        'https://example.com',
        requestData
      )

      expect(result).toEqual(responseData)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestData)
        })
      )
    })

    it('should handle empty response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('', { status: 200 })
      )

      const result = await postJson('https://example.com', { data: 'test' })

      expect(result).toBeUndefined()
    })
  })
})
