import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CancellationController,
  CancellationError,
  isCancellationError,
  withCancellation,
  cancellableDelay
} from './cancellation'

describe('Cancellation Service', () => {
  describe('CancellationController', () => {
    it('should create a controller with uncancelled state', () => {
      const controller = new CancellationController()
      expect(controller.isCancelled).toBe(false)
    })

    it('should cancel operations', () => {
      const controller = new CancellationController()
      controller.cancel()
      expect(controller.isCancelled).toBe(true)
    })

    it('should provide a valid token', () => {
      const controller = new CancellationController()
      const token = controller.token
      expect(token.signal).toBeInstanceOf(AbortSignal)
      expect(token.isCancelled).toBe(false)
    })

    it('should reset the controller', () => {
      const controller = new CancellationController()
      controller.cancel()
      expect(controller.isCancelled).toBe(true)
      controller.reset()
      expect(controller.isCancelled).toBe(false)
    })

    it('token.throwIfCancelled should throw when cancelled', () => {
      const controller = new CancellationController()
      const token = controller.token
      controller.cancel()
      expect(() => token.throwIfCancelled()).toThrow(CancellationError)
    })
  })

  describe('CancellationError', () => {
    it('should be an instance of Error', () => {
      const error = new CancellationError()
      expect(error).toBeInstanceOf(Error)
    })

    it('should have isCancellation property', () => {
      const error = new CancellationError()
      expect(error.isCancellation).toBe(true)
    })

    it('should have custom message', () => {
      const error = new CancellationError('Custom message')
      expect(error.message).toBe('Custom message')
    })
  })

  describe('isCancellationError', () => {
    it('should return true for CancellationError', () => {
      expect(isCancellationError(new CancellationError())).toBe(true)
    })

    it('should return true for AbortError', () => {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      expect(isCancellationError(error)).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isCancellationError(new Error('Regular error'))).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(isCancellationError('string')).toBe(false)
      expect(isCancellationError(null)).toBe(false)
      expect(isCancellationError(undefined)).toBe(false)
    })
  })

  describe('withCancellation', () => {
    it('should return result when not cancelled', async () => {
      const result = await withCancellation(async () => 'success')
      expect(result).toBe('success')
    })

    it('should return undefined when cancelled', async () => {
      const controller = new CancellationController()
      controller.cancel()

      const result = await withCancellation(async (token) => {
        token.throwIfCancelled()
        return 'success'
      }, controller.token)

      expect(result).toBeUndefined()
    })

    it('should propagate non-cancellation errors', async () => {
      await expect(
        withCancellation(async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')
    })
  })

  describe('cancellableDelay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should resolve after delay when not cancelled', async () => {
      const controller = new CancellationController()
      const promise = cancellableDelay(1000, controller.token)

      vi.advanceTimersByTime(1000)

      await expect(promise).resolves.toBeUndefined()
    })

    it('should reject immediately if already cancelled', async () => {
      const controller = new CancellationController()
      controller.cancel()

      await expect(cancellableDelay(1000, controller.token)).rejects.toThrow(CancellationError)
    })

    it('should reject when cancelled during delay', async () => {
      const controller = new CancellationController()
      const promise = cancellableDelay(1000, controller.token)

      // Cancel before timeout completes
      vi.advanceTimersByTime(500)
      controller.cancel()

      await expect(promise).rejects.toThrow(CancellationError)
    })
  })
})
