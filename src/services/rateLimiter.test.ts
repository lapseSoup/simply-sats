/**
 * Rate Limiter Tests
 *
 * Tests for security-critical rate limiting logic.
 * These tests mock the Tauri invoke calls since the actual
 * rate limiting logic is now in the Rust backend.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  checkUnlockRateLimit,
  recordFailedUnlockAttempt,
  recordSuccessfulUnlock,
  getRemainingAttempts,
  formatLockoutTime
} from './rateLimiter'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('Rate Limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkUnlockRateLimit', () => {
    it('returns not limited when backend says not limited', async () => {
      mockInvoke.mockResolvedValueOnce({ is_limited: false, remaining_ms: 0 })

      const result = await checkUnlockRateLimit()

      expect(result.isLimited).toBe(false)
      expect(result.remainingMs).toBe(0)
      expect(mockInvoke).toHaveBeenCalledWith('check_unlock_rate_limit')
    })

    it('returns limited when backend says limited', async () => {
      mockInvoke.mockResolvedValueOnce({ is_limited: true, remaining_ms: 5000 })

      const result = await checkUnlockRateLimit()

      expect(result.isLimited).toBe(true)
      expect(result.remainingMs).toBe(5000)
    })

    it('fails closed on backend error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backend unavailable'))

      const result = await checkUnlockRateLimit()

      expect(result.isLimited).toBe(true)
      expect(result.remainingMs).toBe(30000)
    })
  })

  describe('recordFailedUnlockAttempt', () => {
    it('returns lockout info from backend', async () => {
      mockInvoke.mockResolvedValueOnce({
        is_locked: true,
        lockout_ms: 2000,
        attempts_remaining: 0
      })

      const result = await recordFailedUnlockAttempt()

      expect(result.isLocked).toBe(true)
      expect(result.lockoutMs).toBe(2000)
      expect(result.attemptsRemaining).toBe(0)
      expect(mockInvoke).toHaveBeenCalledWith('record_failed_unlock')
    })

    it('returns remaining attempts when not locked', async () => {
      mockInvoke.mockResolvedValueOnce({
        is_locked: false,
        lockout_ms: 0,
        attempts_remaining: 3
      })

      const result = await recordFailedUnlockAttempt()

      expect(result.isLocked).toBe(false)
      expect(result.lockoutMs).toBe(0)
      expect(result.attemptsRemaining).toBe(3)
    })

    it('fails closed on backend error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backend unavailable'))

      const result = await recordFailedUnlockAttempt()

      expect(result.isLocked).toBe(true)
      expect(result.lockoutMs).toBe(60000)
      expect(result.attemptsRemaining).toBe(0)
    })
  })

  describe('recordSuccessfulUnlock', () => {
    it('calls backend to reset rate limit', async () => {
      mockInvoke.mockResolvedValueOnce(undefined)

      await recordSuccessfulUnlock()

      expect(mockInvoke).toHaveBeenCalledWith('record_successful_unlock')
    })

    it('handles backend errors gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backend unavailable'))

      // Should not throw
      await expect(recordSuccessfulUnlock()).resolves.toBeUndefined()
    })
  })

  describe('getRemainingAttempts', () => {
    it('returns remaining attempts from backend', async () => {
      mockInvoke.mockResolvedValueOnce(3)

      const result = await getRemainingAttempts()

      expect(result).toBe(3)
      expect(mockInvoke).toHaveBeenCalledWith('get_remaining_unlock_attempts')
    })

    it('returns max attempts on backend error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backend unavailable'))

      const result = await getRemainingAttempts()

      expect(result).toBe(5)
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
