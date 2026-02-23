/**
 * Base HTTP Client
 *
 * Provides a consistent foundation for all API clients with:
 * - Request timeout handling
 * - Retry logic with exponential backoff
 * - Request/response logging (dev mode)
 * - Consistent error handling
 */

import { type Result, ok, err } from '../../domain/types'
// NOTE: Logger is a cross-cutting concern — this import from services is an accepted exception
// to the strict layered architecture. Moving logger to infrastructure would break the
// convention that services/logger.ts is the canonical logging module.
import { apiLogger } from '../../services/logger'

/**
 * HTTP client configuration options
 */
export interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl: string
  /** Request timeout in milliseconds */
  timeout: number
  /** Maximum retry attempts for failed requests */
  maxRetries: number
  /** Initial retry delay in milliseconds */
  retryDelayMs: number
  /** Enable request/response logging */
  enableLogging: boolean
}

/**
 * HTTP error with status code and response details
 */
export interface HttpError {
  code: string
  message: string
  status?: number
  url?: string
  retryable: boolean
}

/**
 * Request options for HTTP calls
 */
export interface RequestOptions extends Omit<RequestInit, 'signal'> {
  /** Override timeout for this request */
  timeout?: number
  /** Override max retries for this request */
  maxRetries?: number
  /** Skip retry logic for this request */
  noRetry?: boolean
  /** External AbortSignal to cancel the request (e.g. from sync cancellation) */
  signal?: AbortSignal
}

/**
 * Default configuration values
 */
export const DEFAULT_HTTP_CONFIG: HttpClientConfig = {
  baseUrl: '',
  timeout: 30000,
  maxRetries: 3,
  retryDelayMs: 100,
  enableLogging: import.meta.env?.DEV ?? false
}

/**
 * HTTP status codes that should trigger a retry
 */
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504]

/**
 * Maximum response body size in bytes (10 MB).
 * Prevents OOM from malicious or oversized API responses (S-18).
 */
const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024

/**
 * Create an HTTP error object
 */
function createHttpError(
  code: string,
  message: string,
  status?: number,
  url?: string,
  retryable = false
): HttpError {
  return { code, message, status, url, retryable }
}

/**
 * Check if an error is retryable
 */
function isRetryable(status?: number, error?: Error): boolean {
  if (status && RETRYABLE_STATUS_CODES.includes(status)) {
    return true
  }
  // Network errors are retryable
  if (error?.name === 'TypeError' || error?.name === 'AbortError') {
    return true
  }
  return false
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(attempt: number, baseDelay: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelay * Math.pow(2, attempt)
  // Add jitter (random 0-50% of delay)
  const jitter = exponentialDelay * Math.random() * 0.5
  return exponentialDelay + jitter
}

/**
 * HTTP Client interface
 */
export interface HttpClient {
  /**
   * Make a GET request
   */
  get<T>(path: string, options?: RequestOptions): Promise<Result<T, HttpError>>

  /**
   * Make a POST request with JSON body
   */
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<Result<T, HttpError>>

  /**
   * Make a raw fetch request with full control
   */
  fetch(path: string, options?: RequestOptions): Promise<Result<Response, HttpError>>
}

/**
 * Create an HTTP client instance
 */
export function createHttpClient(config: Partial<HttpClientConfig> = {}): HttpClient {
  const cfg: HttpClientConfig = { ...DEFAULT_HTTP_CONFIG, ...config }

  /**
   * Internal fetch with timeout and optional external abort signal
   */
  async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    // If an external signal is provided, abort our controller when it fires
    let onExternalAbort: (() => void) | undefined
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId)
        controller.abort()
      } else {
        onExternalAbort = () => controller.abort()
        externalSignal.addEventListener('abort', onExternalAbort, { once: true })
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      return response
    } finally {
      clearTimeout(timeoutId)
      if (onExternalAbort && externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort)
      }
    }
  }

  /**
   * Log request if logging is enabled
   */
  function logRequest(method: string, url: string, body?: unknown): void {
    if (cfg.enableLogging) {
      apiLogger.debug(`[HTTP] ${method} ${url}`, body ? { body } : undefined)
    }
  }

  /**
   * Log response if logging is enabled
   */
  function logResponse(method: string, url: string, status: number, duration: number): void {
    if (cfg.enableLogging) {
      apiLogger.debug(`[HTTP] ${method} ${url} -> ${status} (${duration}ms)`)
    }
  }

  /**
   * Log error if logging is enabled
   */
  function logError(method: string, url: string, error: HttpError, attempt: number): void {
    if (cfg.enableLogging) {
      apiLogger.error(`[HTTP] ${method} ${url} failed (attempt ${attempt}):`, error.message)
    }
  }

  /**
   * Execute request with retry logic
   */
  async function executeWithRetry(
    method: string,
    url: string,
    options: RequestInit,
    requestTimeout: number,
    maxRetries: number,
    noRetry: boolean,
    externalSignal?: AbortSignal
  ): Promise<Result<Response, HttpError>> {
    const fullUrl = cfg.baseUrl ? `${cfg.baseUrl}${url}` : url
    let lastError: HttpError | null = null

    const attempts = noRetry ? 1 : maxRetries
    for (let attempt = 0; attempt < attempts; attempt++) {
      // If the external signal is already aborted, bail immediately
      if (externalSignal?.aborted) {
        return err(createHttpError('ABORTED', 'Request aborted', undefined, fullUrl))
      }

      const startTime = Date.now()

      try {
        logRequest(method, fullUrl, options.body)

        const response = await fetchWithTimeout(fullUrl, options, requestTimeout, externalSignal)
        const duration = Date.now() - startTime

        logResponse(method, fullUrl, response.status, duration)

        // Check if we should retry based on status code
        if (!response.ok && isRetryable(response.status) && !noRetry && attempt < attempts - 1) {
          lastError = createHttpError(
            'HTTP_ERROR',
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            fullUrl,
            true
          )
          logError(method, fullUrl, lastError, attempt + 1)

          await sleep(calculateBackoff(attempt, cfg.retryDelayMs))
          continue
        }

        return ok(response)
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        const duration = Date.now() - startTime

        lastError = createHttpError(
          error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR',
          error.message,
          undefined,
          fullUrl,
          isRetryable(undefined, error)
        )

        if (cfg.enableLogging) {
          apiLogger.error(`[HTTP] ${method} ${fullUrl} error after ${duration}ms:`, error.message)
        }

        // Only retry if it's a retryable error and we have attempts left
        if (lastError.retryable && !noRetry && attempt < attempts - 1) {
          logError(method, fullUrl, lastError, attempt + 1)
          await sleep(calculateBackoff(attempt, cfg.retryDelayMs))
          continue
        }

        return err(lastError)
      }
    }

    // Should not reach here, but return last error if we do
    return err(lastError ?? createHttpError('UNKNOWN_ERROR', 'Request failed', undefined, fullUrl))
  }

  return {
    async get<T>(path: string, options: RequestOptions = {}): Promise<Result<T, HttpError>> {
      const { timeout = cfg.timeout, maxRetries = cfg.maxRetries, noRetry = false, signal, ...fetchOptions } = options

      const result = await executeWithRetry(
        'GET',
        path,
        {
          method: 'GET',
          ...fetchOptions
        },
        timeout,
        maxRetries,
        noRetry,
        signal
      )

      if (!result.ok) {
        return result
      }

      const response = result.value
      if (!response.ok) {
        return err(createHttpError(
          'HTTP_ERROR',
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          path,
          isRetryable(response.status)
        ))
      }

      // S-18: Guard against oversized responses before reading body
      const contentLength = Number(response.headers?.get?.('content-length'))
      if (contentLength > MAX_RESPONSE_BODY_BYTES) {
        return err(createHttpError('RESPONSE_TOO_LARGE', `Response body too large: ${contentLength} bytes`, undefined, path))
      }

      try {
        const data = await response.json() as T
        return ok(data)
      } catch {
        return err(createHttpError('PARSE_ERROR', 'Failed to parse JSON response', undefined, path))
      }
    },

    async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<Result<T, HttpError>> {
      const { timeout = cfg.timeout, maxRetries = cfg.maxRetries, noRetry = false, signal, ...fetchOptions } = options

      const result = await executeWithRetry(
        'POST',
        path,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...fetchOptions.headers
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          ...fetchOptions
        },
        timeout,
        maxRetries,
        noRetry,
        signal
      )

      if (!result.ok) {
        return result
      }

      const response = result.value
      if (!response.ok) {
        // Try to get error message from response body
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        try {
          const errorBody = await response.text()
          if (errorBody) {
            errorMessage = errorBody
          }
        } catch {
          // Ignore parse errors for error body
        }

        return err(createHttpError(
          'HTTP_ERROR',
          errorMessage,
          response.status,
          path,
          isRetryable(response.status)
        ))
      }

      // S-18: Guard against oversized responses before reading body
      const postContentLength = Number(response.headers?.get?.('content-length'))
      if (postContentLength > MAX_RESPONSE_BODY_BYTES) {
        return err(createHttpError('RESPONSE_TOO_LARGE', `Response body too large: ${postContentLength} bytes`, undefined, path))
      }

      try {
        const data = await response.json() as T
        return ok(data)
      } catch {
        return err(createHttpError('PARSE_ERROR', 'Failed to parse JSON response', undefined, path))
      }
    },

    async fetch(path: string, options: RequestOptions = {}): Promise<Result<Response, HttpError>> {
      const { timeout = cfg.timeout, maxRetries = cfg.maxRetries, noRetry = false, signal, ...fetchOptions } = options

      return executeWithRetry(
        fetchOptions.method || 'GET',
        path,
        fetchOptions,
        timeout,
        maxRetries,
        noRetry,
        signal
      )
    }
  }
}

/**
 * Create a pre-configured client for a specific API
 */
export function createApiClient(baseUrl: string, config: Partial<Omit<HttpClientConfig, 'baseUrl'>> = {}): HttpClient {
  return createHttpClient({ ...config, baseUrl })
}
