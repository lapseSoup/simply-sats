/**
 * HTTP Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHttpClient, createApiClient } from './httpClient'
import { isOk, isErr } from '../../domain/types'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('httpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createHttpClient', () => {
    it('should create a client with default config', () => {
      const client = createHttpClient()
      expect(client).toBeDefined()
      expect(client.get).toBeDefined()
      expect(client.post).toBeDefined()
      expect(client.fetch).toBeDefined()
    })

    it('should merge custom config with defaults', () => {
      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 5000
      })
      expect(client).toBeDefined()
    })
  })

  describe('get()', () => {
    it('should make a GET request and return data', async () => {
      const mockData = { id: 1, name: 'Test' }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData)
      })

      const client = createHttpClient({ enableLogging: false })
      const resultPromise = client.get('/test')

      // Advance timers to handle any async operations
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.value).toEqual(mockData)
      }
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should prepend baseUrl to path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({})
      })

      const client = createHttpClient({
        baseUrl: 'https://api.example.com',
        enableLogging: false
      })
      const resultPromise = client.get('/users')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.any(Object)
      )
    })

    it('should return error for non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      })

      const client = createHttpClient({ enableLogging: false, maxRetries: 1 })
      const resultPromise = client.get('/notfound')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.status).toBe(404)
        expect(result.error.code).toBe('HTTP_ERROR')
      }
    })

    it('should return error for JSON parse failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Invalid JSON'))
      })

      const client = createHttpClient({ enableLogging: false })
      const resultPromise = client.get('/bad-json')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.code).toBe('PARSE_ERROR')
      }
    })
  })

  describe('post()', () => {
    it('should make a POST request with JSON body', async () => {
      const mockResponse = { success: true }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse)
      })

      const client = createHttpClient({ enableLogging: false })
      const body = { name: 'test' }
      const resultPromise = client.post('/create', body)
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isOk(result)).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        '/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      )
    })

    it('should include error body in error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: () => Promise.resolve('Validation failed: name is required')
      })

      const client = createHttpClient({ enableLogging: false, maxRetries: 1 })
      const resultPromise = client.post('/create', {})
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.message).toContain('Validation failed')
      }
    })
  })

  describe('retry logic', () => {
    it('should retry on 500 errors', async () => {
      // First call returns 500, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true })
        })

      const client = createHttpClient({
        enableLogging: false,
        maxRetries: 3,
        retryDelayMs: 10
      })

      const resultPromise = client.get('/flaky')

      // Run through all retry delays
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isOk(result)).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should retry on 429 rate limit', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({})
        })

      const client = createHttpClient({
        enableLogging: false,
        maxRetries: 2,
        retryDelayMs: 10
      })

      const resultPromise = client.get('/rate-limited')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isOk(result)).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should not retry on 400 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      })

      const client = createHttpClient({
        enableLogging: false,
        maxRetries: 3,
        retryDelayMs: 10
      })

      const resultPromise = client.get('/bad-request')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
    })

    it('should respect noRetry option', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      })

      const client = createHttpClient({
        enableLogging: false,
        maxRetries: 3
      })

      const resultPromise = client.get('/no-retry', { noRetry: true })
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No retry due to noRetry option
    })

    it('should exhaust retries and return last error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable'
      })

      const client = createHttpClient({
        enableLogging: false,
        maxRetries: 3,
        retryDelayMs: 10
      })

      const resultPromise = client.get('/always-fails')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.status).toBe(503)
      }
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('timeout handling', () => {
    it('should abort request on timeout', async () => {
      // Use real timers for this test since AbortController doesn't work well with fake timers
      vi.useRealTimers()

      // Mock a slow request that takes longer than timeout
      mockFetch.mockImplementation(() =>
        new Promise((_, reject) => {
          // Simulate AbortError being thrown after abort
          setTimeout(() => {
            const error = new Error('The operation was aborted')
            error.name = 'AbortError'
            reject(error)
          }, 150) // This will be aborted before it completes
        })
      )

      const client = createHttpClient({
        enableLogging: false,
        timeout: 50, // Short timeout
        maxRetries: 1
      })

      const result = await client.get('/slow')

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.code).toBe('TIMEOUT')
      }

      // Restore fake timers for other tests
      vi.useFakeTimers()
    })
  })

  describe('createApiClient', () => {
    it('should create a client with baseUrl pre-configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' })
      })

      const client = createApiClient('https://api.example.com')
      const resultPromise = client.get('/endpoint')
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/endpoint',
        expect.any(Object)
      )
    })
  })

  describe('fetch()', () => {
    it('should return raw Response object', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/plain' })
      }
      mockFetch.mockResolvedValueOnce(mockResponse)

      const client = createHttpClient({ enableLogging: false })
      const resultPromise = client.fetch('/raw')
      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(isOk(result)).toBe(true)
      if (isOk(result)) {
        expect(result.value.ok).toBe(true)
        expect(result.value.status).toBe(200)
      }
    })

    it('should allow custom HTTP methods', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204
      })

      const client = createHttpClient({ enableLogging: false })
      const resultPromise = client.fetch('/resource', { method: 'DELETE' })
      await vi.runAllTimersAsync()
      await resultPromise

      expect(mockFetch).toHaveBeenCalledWith(
        '/resource',
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})
