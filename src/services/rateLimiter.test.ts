/**
 * Rate Limiter Tests
 *
 * Tests for security-critical rate limiting logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  recordSuccessfulUnlock,
  getRemainingAttempts,
  formatLockoutTime
} from './rateLimiter'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} }
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })

describe('Rate Limiter', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('checkUnlockRateLimit', () => {
    it('allows attempts when no previous failures', () => {
      const result = checkUnlockRateLimit()
      expect(result.isLimited).toBe(false)
      expect(result.remainingMs).toBe(0)
    })

    it('allows attempts after rate limit expires', () => {
      // Record failures to trigger lockout
      for (let i = 0; i < 5; i++) {
        recordFailedUnlockAttempt()
      }

      // Advance time past lockout
      vi.advanceTimersByTime(60000) // 1 minute

      const result = checkUnlockRateLimit()
      expect(result.isLimited).toBe(false)
    })

    it('resets after 15 minutes of inactivity', () => {
      // Record some failures
      recordFailedUnlockAttempt()
      recordFailedUnlockAttempt()

      // Advance time past reset window
      vi.advanceTimersByTime(16 * 60 * 1000) // 16 minutes

      const remaining = getRemainingAttempts()
      expect(remaining).toBe(5) // Reset to max
    })
  })

  describe('recordFailedUnlockAttempt', () => {
    it('decrements remaining attempts', () => {
      expect(getRemainingAttempts()).toBe(5)

      recordFailedUnlockAttempt()
      expect(getRemainingAttempts()).toBe(4)

      recordFailedUnlockAttempt()
      expect(getRemainingAttempts()).toBe(3)
    })

    it('triggers lockout after max attempts', () => {
      for (let i = 0; i < 4; i++) {
        const result = recordFailedUnlockAttempt()
        expect(result.isLocked).toBe(false)
      }

      const result = recordFailedUnlockAttempt()
      expect(result.isLocked).toBe(true)
      expect(result.lockoutMs).toBeGreaterThan(0)
      expect(result.attemptsRemaining).toBe(0)
    })

    it('increases lockout duration with more failures (exponential backoff)', () => {
      // First lockout
      for (let i = 0; i < 5; i++) {
        recordFailedUnlockAttempt()
      }
      const firstLockout = checkUnlockRateLimit()

      // Wait for lockout to expire
      vi.advanceTimersByTime(firstLockout.remainingMs + 1000)

      // Trigger second lockout
      const result = recordFailedUnlockAttempt()
      expect(result.isLocked).toBe(true)
      expect(result.lockoutMs).toBeGreaterThan(firstLockout.remainingMs)
    })
  })

  describe('recordSuccessfulUnlock', () => {
    it('resets all counters on success', () => {
      // Record some failures
      recordFailedUnlockAttempt()
      recordFailedUnlockAttempt()
      recordFailedUnlockAttempt()

      expect(getRemainingAttempts()).toBe(2)

      recordSuccessfulUnlock()

      expect(getRemainingAttempts()).toBe(5)
      expect(checkUnlockRateLimit().isLimited).toBe(false)
    })
  })

  describe('formatLockoutTime', () => {
    it('formats seconds correctly', () => {
      expect(formatLockoutTime(1000)).toBe('1 second')
      expect(formatLockoutTime(5000)).toBe('5 seconds')
      expect(formatLockoutTime(30000)).toBe('30 seconds')
    })

    it('formats minutes correctly', () => {
      expect(formatLockoutTime(60000)).toBe('1 minute')
      expect(formatLockoutTime(120000)).toBe('2 minutes')
      expect(formatLockoutTime(300000)).toBe('5 minutes')
    })

    it('returns empty string for zero or negative', () => {
      expect(formatLockoutTime(0)).toBe('')
      expect(formatLockoutTime(-1000)).toBe('')
    })
  })
})
