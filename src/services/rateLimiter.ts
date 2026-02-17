/**
 * Rate Limiter Service
 *
 * Implements exponential backoff for security-sensitive operations
 * like password unlock attempts to prevent brute-force attacks.
 *
 * State is stored in the Rust backend (not localStorage) to prevent
 * bypass through browser storage clearing.
 *
 * @module services/rateLimiter
 */

import { invoke } from '@tauri-apps/api/core'
import { walletLogger } from './logger'

// Rate limit configuration (matches Rust backend)
const MAX_ATTEMPTS = 5
const FALLBACK_LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes

// In-memory fallback state for when Rust backend is unavailable.
// Intentionally NOT persisted to localStorage to prevent XSS exfiltration.
// Resets on page refresh — acceptable tradeoff for security.
const fallbackState = {
  attempts: 0,
  lockoutUntil: 0
}

/** Reset fallback state (for testing) */
export function _resetFallbackState(): void {
  fallbackState.attempts = 0
  fallbackState.lockoutUntil = 0
}

interface CheckRateLimitResponse {
  is_limited: boolean
  remaining_ms: number
}

interface RecordFailedResponse {
  is_locked: boolean
  lockout_ms: number
  attempts_remaining: number
}

/**
 * Check if unlock attempts are currently rate limited
 * @returns Object with isLimited flag and remainingMs if limited
 */
export async function checkUnlockRateLimit(): Promise<{ isLimited: boolean; remainingMs: number }> {
  try {
    const response = await invoke<CheckRateLimitResponse>('check_unlock_rate_limit')
    if (response.is_limited) {
      walletLogger.debug('Unlock rate limited', { remainingMs: response.remaining_ms })
    }
    return {
      isLimited: response.is_limited,
      remainingMs: response.remaining_ms
    }
  } catch (error) {
    walletLogger.error('SECURITY: Rust rate limiter unavailable, using in-memory fallback', { error })
    // Fallback: use in-memory rate limiter instead of blocking indefinitely
    const now = Date.now()
    if (now > fallbackState.lockoutUntil && fallbackState.lockoutUntil !== 0) {
      fallbackState.attempts = 0
      fallbackState.lockoutUntil = 0
    }
    const isLimited = fallbackState.attempts >= MAX_ATTEMPTS
    const remainingMs = isLimited ? Math.max(0, fallbackState.lockoutUntil - now) : 0
    return { isLimited, remainingMs }
  }
}

/**
 * Record a failed unlock attempt
 * Increments counter and may trigger lockout
 */
export async function recordFailedUnlockAttempt(): Promise<{ isLocked: boolean; lockoutMs: number; attemptsRemaining: number }> {
  try {
    const response = await invoke<RecordFailedResponse>('record_failed_unlock')
    walletLogger.warn('Failed unlock attempt', {
      isLocked: response.is_locked,
      attemptsRemaining: response.attempts_remaining
    })

    if (response.is_locked) {
      walletLogger.warn('Unlock locked out due to too many attempts', {
        lockoutMs: response.lockout_ms
      })
    }

    return {
      isLocked: response.is_locked,
      lockoutMs: response.lockout_ms,
      attemptsRemaining: response.attempts_remaining
    }
  } catch (error) {
    walletLogger.error('SECURITY: Rust rate limiter unavailable, using in-memory fallback', { error })
    // Fallback: use in-memory rate limiter
    fallbackState.attempts++
    const isLocked = fallbackState.attempts >= MAX_ATTEMPTS
    if (isLocked) {
      fallbackState.lockoutUntil = Date.now() + FALLBACK_LOCKOUT_MS
    }
    return {
      isLocked,
      lockoutMs: isLocked ? FALLBACK_LOCKOUT_MS : 0,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - fallbackState.attempts)
    }
  }
}

/**
 * Record a successful unlock attempt
 * Resets the rate limit counter
 */
export async function recordSuccessfulUnlock(): Promise<void> {
  fallbackState.attempts = 0
  fallbackState.lockoutUntil = 0
  try {
    await invoke('record_successful_unlock')
    walletLogger.debug('Unlock rate limit reset on success')
  } catch (error) {
    walletLogger.error('Failed to record successful unlock', { error })
  }
}

/**
 * Get the number of remaining unlock attempts before lockout
 */
export async function getRemainingAttempts(): Promise<number> {
  try {
    const remaining = await invoke<number>('get_remaining_unlock_attempts')
    return remaining
  } catch (error) {
    walletLogger.error('Failed to get remaining attempts', { error })
    return MAX_ATTEMPTS
  }
}

/**
 * Format remaining lockout time for display
 */
export function formatLockoutTime(ms: number): string {
  if (ms <= 0) return ''

  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`
  }

  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}
