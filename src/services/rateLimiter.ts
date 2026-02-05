/**
 * Rate Limiter Service
 *
 * Implements exponential backoff for security-sensitive operations
 * like password unlock attempts to prevent brute-force attacks.
 *
 * @module services/rateLimiter
 */

import { walletLogger } from './logger'

interface RateLimitState {
  attempts: number
  lastAttempt: number
  lockedUntil: number
}

// Rate limit configuration
const MAX_ATTEMPTS = 5
const BASE_LOCKOUT_MS = 1000 // 1 second
const MAX_LOCKOUT_MS = 300000 // 5 minutes

// Storage key for persistence across page reloads
const RATE_LIMIT_KEY = 'simply_sats_rate_limit'

/**
 * Get current rate limit state from storage
 */
function getState(): RateLimitState {
  try {
    const stored = localStorage.getItem(RATE_LIMIT_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return { attempts: 0, lastAttempt: 0, lockedUntil: 0 }
}

/**
 * Save rate limit state to storage
 */
function setState(state: RateLimitState): void {
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(state))
}

/**
 * Calculate exponential backoff duration
 * Doubles each time: 1s, 2s, 4s, 8s, 16s, up to max
 */
function calculateLockoutDuration(attempts: number): number {
  const duration = BASE_LOCKOUT_MS * Math.pow(2, attempts - MAX_ATTEMPTS)
  return Math.min(duration, MAX_LOCKOUT_MS)
}

/**
 * Check if unlock attempts are currently rate limited
 * @returns Object with isLimited flag and remainingMs if limited
 */
export function checkUnlockRateLimit(): { isLimited: boolean; remainingMs: number } {
  const state = getState()
  const now = Date.now()

  // Reset if last attempt was more than 15 minutes ago
  if (now - state.lastAttempt > 900000) {
    setState({ attempts: 0, lastAttempt: 0, lockedUntil: 0 })
    return { isLimited: false, remainingMs: 0 }
  }

  if (state.lockedUntil > now) {
    const remainingMs = state.lockedUntil - now
    walletLogger.debug('Unlock rate limited', { remainingMs })
    return { isLimited: true, remainingMs }
  }

  return { isLimited: false, remainingMs: 0 }
}

/**
 * Record a failed unlock attempt
 * Increments counter and may trigger lockout
 */
export function recordFailedUnlockAttempt(): { isLocked: boolean; lockoutMs: number; attemptsRemaining: number } {
  const state = getState()
  const now = Date.now()

  // Reset if last attempt was more than 15 minutes ago
  if (now - state.lastAttempt > 900000) {
    state.attempts = 0
    state.lockedUntil = 0
  }

  state.attempts++
  state.lastAttempt = now

  walletLogger.warn('Failed unlock attempt', { attempts: state.attempts })

  if (state.attempts >= MAX_ATTEMPTS) {
    const lockoutMs = calculateLockoutDuration(state.attempts)
    state.lockedUntil = now + lockoutMs
    setState(state)
    walletLogger.warn('Unlock locked out due to too many attempts', { lockoutMs })
    return {
      isLocked: true,
      lockoutMs,
      attemptsRemaining: 0
    }
  }

  setState(state)
  return {
    isLocked: false,
    lockoutMs: 0,
    attemptsRemaining: MAX_ATTEMPTS - state.attempts
  }
}

/**
 * Record a successful unlock attempt
 * Resets the rate limit counter
 */
export function recordSuccessfulUnlock(): void {
  setState({ attempts: 0, lastAttempt: 0, lockedUntil: 0 })
  walletLogger.debug('Unlock rate limit reset on success')
}

/**
 * Get the number of remaining unlock attempts before lockout
 */
export function getRemainingAttempts(): number {
  const state = getState()
  const now = Date.now()

  // Reset if last attempt was more than 15 minutes ago
  if (now - state.lastAttempt > 900000) {
    return MAX_ATTEMPTS
  }

  return Math.max(0, MAX_ATTEMPTS - state.attempts)
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
