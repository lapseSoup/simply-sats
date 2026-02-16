/**
 * Tests for Auto-Lock Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initAutoLock,
  stopAutoLock,
  resetInactivityTimer,
  isAutoLockEnabled,
  getTimeUntilLock,
  setInactivityLimit,
  getInactivityLimit,
  pauseAutoLock,
  resumeAutoLock,
  minutesToMs,
  DEFAULT_INACTIVITY_LIMIT,
  TIMEOUT_OPTIONS
} from './autoLock'

describe('autoLock', () => {
  beforeEach(() => {
    // Reset auto-lock state before each test
    stopAutoLock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    stopAutoLock()
    vi.useRealTimers()
  })

  describe('initAutoLock', () => {
    it('should initialize auto-lock with default timeout', () => {
      const onLock = vi.fn()
      initAutoLock(onLock)

      expect(isAutoLockEnabled()).toBe(true)
      expect(getInactivityLimit()).toBe(DEFAULT_INACTIVITY_LIMIT)
    })

    it('should initialize auto-lock with custom timeout', () => {
      const onLock = vi.fn()
      const customTimeout = minutesToMs(5)
      initAutoLock(onLock, customTimeout)

      expect(isAutoLockEnabled()).toBe(true)
      expect(getInactivityLimit()).toBe(customTimeout)
    })

    it('should return cleanup function', () => {
      const onLock = vi.fn()
      const cleanup = initAutoLock(onLock)

      expect(typeof cleanup).toBe('function')
      cleanup()
      expect(isAutoLockEnabled()).toBe(false)
    })

    it('should trigger lock callback after inactivity timeout', () => {
      const onLock = vi.fn()
      const timeout = minutesToMs(2) // 2 minutes
      initAutoLock(onLock, timeout)

      // Fast-forward to first check (60 seconds)
      // At this point, only 60 seconds have passed, less than 2 minute timeout
      vi.advanceTimersByTime(60000)
      expect(onLock).not.toHaveBeenCalled()

      // Fast-forward to second check (another 60 seconds, total 120 seconds = 2 minutes)
      // Now 120 seconds have passed, >= 2 minute timeout, should lock
      vi.advanceTimersByTime(60000)
      expect(onLock).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopAutoLock', () => {
    it('should stop auto-lock and cleanup', () => {
      const onLock = vi.fn()
      initAutoLock(onLock)

      expect(isAutoLockEnabled()).toBe(true)

      stopAutoLock()

      expect(isAutoLockEnabled()).toBe(false)
    })

    it('should not trigger callback after stop', () => {
      const onLock = vi.fn()
      const timeout = minutesToMs(1)
      initAutoLock(onLock, timeout)

      stopAutoLock()

      // Fast-forward well past timeout
      vi.advanceTimersByTime(300000)

      expect(onLock).not.toHaveBeenCalled()
    })
  })

  describe('resetInactivityTimer', () => {
    it('should reset the inactivity timer', () => {
      const onLock = vi.fn()
      const timeout = minutesToMs(2) // 2 minutes
      initAutoLock(onLock, timeout)

      // Advance 1 minute
      vi.advanceTimersByTime(60000)
      resetInactivityTimer()

      // Advance another 1.5 minutes (would be 2.5 total without reset)
      vi.advanceTimersByTime(90000)

      // Should not have locked because we reset the timer
      expect(onLock).not.toHaveBeenCalled()
    })
  })

  describe('getTimeUntilLock', () => {
    it('should return -1 when auto-lock is disabled', () => {
      expect(getTimeUntilLock()).toBe(-1)
    })

    it('should return remaining time when enabled', () => {
      const onLock = vi.fn()
      const timeout = minutesToMs(5)
      initAutoLock(onLock, timeout)

      const remaining = getTimeUntilLock()
      expect(remaining).toBeGreaterThan(0)
      expect(remaining).toBeLessThanOrEqual(timeout)
    })
  })

  describe('setInactivityLimit', () => {
    it('should update the inactivity limit', () => {
      const onLock = vi.fn()
      initAutoLock(onLock, minutesToMs(5))

      const newLimit = minutesToMs(15)
      setInactivityLimit(newLimit)

      expect(getInactivityLimit()).toBe(newLimit)
    })
  })

  describe('pauseAutoLock and resumeAutoLock', () => {
    it('should pause and resume auto-lock', () => {
      const onLock = vi.fn()
      const timeout = minutesToMs(2) // 2 minutes
      initAutoLock(onLock, timeout)

      // Pause before first check
      pauseAutoLock()

      // Advance past timeout - should NOT lock because paused
      vi.advanceTimersByTime(180000) // 3 minutes
      expect(onLock).not.toHaveBeenCalled()

      // Resume - this resets the timer
      resumeAutoLock(onLock)

      // Advance to first check (60s) - still under 2 min timeout
      vi.advanceTimersByTime(60000)
      expect(onLock).not.toHaveBeenCalled()

      // Advance to second check (another 60s, total 120s = 2 min) - should lock
      vi.advanceTimersByTime(60000)
      expect(onLock).toHaveBeenCalledTimes(1)
    })
  })

  describe('minutesToMs', () => {
    it('should convert minutes to milliseconds', () => {
      expect(minutesToMs(1)).toBe(60000)
      expect(minutesToMs(5)).toBe(300000)
      expect(minutesToMs(60)).toBe(3600000)
    })
  })

  describe('TIMEOUT_OPTIONS', () => {
    it('should have valid timeout options', () => {
      expect(TIMEOUT_OPTIONS.length).toBe(5)

      for (const option of TIMEOUT_OPTIONS) {
        expect(typeof option.label).toBe('string')
        expect(typeof option.value).toBe('number')
        expect(option.value).toBeGreaterThan(0)
      }
    })

    it('should not include a "Never" option', () => {
      const neverOption = TIMEOUT_OPTIONS.find(o => o.value === 0)
      expect(neverOption).toBeUndefined()
    })
  })
})
