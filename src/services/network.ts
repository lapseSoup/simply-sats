/**
 * Network Utilities for Simply Sats
 *
 * Provides robust network request handling with:
 * - Configurable timeouts
 * - Exponential backoff retry logic
 * - Rate limiting support
 * - Proper error handling with AppError
 */

import { TIMEOUTS, RETRY_CONFIG, getWocApiUrl, getGpApiUrl } from './config'
import { NetworkError, TimeoutError, AppError, ErrorCodes } from './errors'
import { apiLogger } from './logger'

/**
 * Options for fetch requests
 */
export interface FetchOptions extends RequestInit {
  timeout?: number
  retries?: number
  retryDelay?: number
}

/**
 * Result of a fetch with retry
 */
export interface FetchResult<T> {
  data: T
  status: number
  retryCount: number
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate delay for exponential backoff
 */
function calculateBackoff(attempt: number, initialDelay: number, maxDelay: number): number {
  const delay = initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt)
  // Add jitter (±20%) to prevent thundering herd
  const jitter = delay * 0.2 * (Math.random() * 2 - 1)
  return Math.min(delay + jitter, maxDelay)
}

/**
 * Check if an HTTP status code is retryable
 */
function isRetryableStatus(status: number): boolean {
  return (RETRY_CONFIG.retryableStatuses as readonly number[]).includes(status)
}

/**
 * Check if an error is a network/fetch error that should be retried
 */
function isNetworkError(error: unknown): boolean {
  if (!RETRY_CONFIG.retryOnNetworkError) return false

  if (error instanceof TypeError) {
    // fetch() throws TypeError for network failures
    return true
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    // Timeout - should retry
    return true
  }

  return false
}

/**
 * Fetch with timeout support
 *
 * @param url - URL to fetch
 * @param options - Fetch options including timeout
 * @returns Response
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { timeout = TIMEOUTS.default, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    })
    return response
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TimeoutError(`Request to ${url}`, timeout)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetch with automatic retry and exponential backoff
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Response
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<Response> {
  const {
    retries = RETRY_CONFIG.maxRetries,
    retryDelay = RETRY_CONFIG.initialDelay,
    timeout = TIMEOUTS.default,
    ...fetchOptions
  } = options

  let lastError: Error | null = null
  let attempt = 0

  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, { ...fetchOptions, timeout })

      // Check if we should retry based on status
      if (!response.ok && isRetryableStatus(response.status) && attempt < retries) {
        const delay = calculateBackoff(attempt, retryDelay, RETRY_CONFIG.maxDelay)
        apiLogger.warn(`[Network] ${url} returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`)
        await sleep(delay)
        attempt++
        continue
      }

      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if we should retry
      if (isNetworkError(error) && attempt < retries) {
        const delay = calculateBackoff(attempt, retryDelay, RETRY_CONFIG.maxDelay)
        apiLogger.warn(`[Network] ${url} failed: ${lastError.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`)
        await sleep(delay)
        attempt++
        continue
      }

      // No more retries
      break
    }
  }

  // All retries exhausted
  if (lastError instanceof TimeoutError) {
    throw lastError
  }

  throw new NetworkError(
    `Request to ${url} failed after ${attempt} attempts: ${lastError?.message || 'Unknown error'}`,
    url
  )
}

/**
 * Fetch JSON with retry and proper error handling
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Parsed JSON data
 */
export async function fetchJson<T>(
  url: string,
  options: FetchOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers
    }
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new NetworkError(
      `HTTP ${response.status}: ${errorText}`,
      url
    )
  }

  try {
    return await response.json()
  } catch {
    throw new AppError(
      `Invalid JSON response from ${url}`,
      ErrorCodes.PARSE_ERROR,
      { url }
    )
  }
}

/**
 * POST JSON with retry and proper error handling
 *
 * @param url - URL to post to
 * @param data - Data to send
 * @param options - Fetch options
 * @returns Parsed JSON response
 */
export async function postJson<T, R = unknown>(
  url: string,
  data: T,
  options: FetchOptions = {}
): Promise<R> {
  const response = await fetchWithRetry(url, {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    },
    body: JSON.stringify(data)
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new NetworkError(
      `HTTP ${response.status}: ${errorText}`,
      url
    )
  }

  // Handle empty response (204 No Content or empty body)
  const text = await response.text()
  if (!text) {
    return undefined as R
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new AppError(
      `Invalid JSON response from ${url}`,
      ErrorCodes.PARSE_ERROR,
      { url }
    )
  }
}

// ============================================
// Specialized API Functions
// ============================================

/**
 * Fetch from WhatsOnChain API with proper timeout and retry
 */
export async function fetchFromWoc<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const baseUrl = getWocApiUrl()
  return fetchJson<T>(`${baseUrl}${endpoint}`, {
    timeout: TIMEOUTS.default,
    ...options
  })
}

/**
 * Fetch from GorillaPool API with proper timeout and retry
 */
export async function fetchFromGp<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const baseUrl = getGpApiUrl()
  return fetchJson<T>(`${baseUrl}${endpoint}`, {
    timeout: TIMEOUTS.default,
    ...options
  })
}

/**
 * Fetch balance for an address from WhatsOnChain
 * Returns 0 on error instead of throwing (for backward compatibility)
 */
export async function fetchBalance(address: string): Promise<{ confirmed: number; unconfirmed: number } | null> {
  try {
    return await fetchFromWoc<{ confirmed: number; unconfirmed: number }>(
      `/address/${address}/balance`,
      { timeout: TIMEOUTS.default }
    )
  } catch (error) {
    apiLogger.warn(`[Network] Failed to fetch balance for ${address}`, { address }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Fetch UTXOs for an address from WhatsOnChain
 * Returns empty array on error (for backward compatibility)
 */
export async function fetchUtxos(address: string): Promise<Array<{
  tx_hash: string
  tx_pos: number
  value: number
  height?: number
}>> {
  try {
    const response = await fetchWithRetry(`${getWocApiUrl()}/address/${address}/unspent`, {
      timeout: TIMEOUTS.sync
    })

    if (response.status === 404) {
      // No UTXOs found is not an error
      return []
    }

    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}`, `address/${address}/unspent`)
    }

    return await response.json()
  } catch (error) {
    apiLogger.warn(`[Network] Failed to fetch UTXOs for ${address}`, { address }, error instanceof Error ? error : undefined)
    return []
  }
}

/**
 * Fetch current block height from WhatsOnChain
 */
export async function fetchBlockHeight(): Promise<number> {
  const data = await fetchFromWoc<{ blocks: number }>('/chain/info', {
    timeout: TIMEOUTS.default
  })
  return data.blocks
}

/**
 * Fetch exchange rate from WhatsOnChain
 */
export async function fetchExchangeRate(): Promise<number | null> {
  try {
    const data = await fetchFromWoc<{ rate?: number }>('/exchangerate', {
      timeout: TIMEOUTS.price
    })
    return data.rate ?? null
  } catch {
    return null
  }
}

/**
 * Broadcast a transaction
 */
export async function broadcastTransaction(txHex: string): Promise<string> {
  const response = await postJson<{ txhex: string }, string>(
    `${getWocApiUrl()}/tx/raw`,
    { txhex: txHex },
    { timeout: TIMEOUTS.broadcast }
  )

  // WoC returns the txid as a string
  if (typeof response === 'string') {
    return response
  }

  throw new AppError('Unexpected broadcast response', ErrorCodes.BROADCAST_FAILED)
}
