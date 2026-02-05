/**
 * RequestManager Tests
 *
 * Tests for the BRC-100 request management class.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RequestManager,
  getRequestManager,
  resetRequestManager
} from './RequestManager'
import type { BRC100Request, BRC100Response } from './types'

describe('RequestManager', () => {
  let manager: RequestManager

  beforeEach(() => {
    // Use short TTL for testing (100ms)
    manager = new RequestManager(100)
  })

  afterEach(() => {
    manager.destroy()
  })

  describe('add and get', () => {
    it('should add and retrieve a pending request', () => {
      const request: BRC100Request = {
        id: 'test-1',
        type: 'getPublicKey',
        params: { identityKey: true },
        origin: 'test.app'
      }
      const resolve = vi.fn()
      const reject = vi.fn()

      manager.add('test-1', request, resolve, reject)

      const pending = manager.get('test-1')
      expect(pending).toBeDefined()
      expect(pending?.request).toEqual(request)
    })

    it('should return undefined for non-existent request', () => {
      expect(manager.get('non-existent')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for existing request', () => {
      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      manager.add('test-1', request, vi.fn(), vi.fn())

      expect(manager.has('test-1')).toBe(true)
    })

    it('should return false for non-existent request', () => {
      expect(manager.has('non-existent')).toBe(false)
    })
  })

  describe('remove', () => {
    it('should remove an existing request', () => {
      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      manager.add('test-1', request, vi.fn(), vi.fn())

      const removed = manager.remove('test-1')
      expect(removed).toBe(true)
      expect(manager.has('test-1')).toBe(false)
    })

    it('should return false for non-existent request', () => {
      expect(manager.remove('non-existent')).toBe(false)
    })
  })

  describe('getAll', () => {
    it('should return all pending requests', () => {
      const request1: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      const request2: BRC100Request = { id: 'test-2', type: 'getNetwork' }
      const request3: BRC100Request = { id: 'test-3', type: 'createSignature' }

      manager.add('test-1', request1, vi.fn(), vi.fn())
      manager.add('test-2', request2, vi.fn(), vi.fn())
      manager.add('test-3', request3, vi.fn(), vi.fn())

      const all = manager.getAll()
      expect(all).toHaveLength(3)
      expect(all).toContainEqual(request1)
      expect(all).toContainEqual(request2)
      expect(all).toContainEqual(request3)
    })

    it('should return empty array when no requests', () => {
      expect(manager.getAll()).toEqual([])
    })
  })

  describe('resolve', () => {
    it('should resolve a pending request and remove it', () => {
      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      const resolve = vi.fn()
      const reject = vi.fn()

      manager.add('test-1', request, resolve, reject)

      const response: BRC100Response = {
        id: 'test-1',
        result: { publicKey: 'abc123' }
      }
      manager.resolve('test-1', response)

      expect(resolve).toHaveBeenCalledWith(response)
      expect(reject).not.toHaveBeenCalled()
      expect(manager.has('test-1')).toBe(false)
    })

    it('should do nothing for non-existent request', () => {
      const response: BRC100Response = { id: 'non-existent' }
      // Should not throw
      manager.resolve('non-existent', response)
    })
  })

  describe('reject', () => {
    it('should reject a pending request and remove it', () => {
      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      const resolve = vi.fn()
      const reject = vi.fn()

      manager.add('test-1', request, resolve, reject)

      const error = new Error('User denied')
      manager.reject('test-1', error)

      expect(reject).toHaveBeenCalledWith(error)
      expect(resolve).not.toHaveBeenCalled()
      expect(manager.has('test-1')).toBe(false)
    })

    it('should do nothing for non-existent request', () => {
      // Should not throw
      manager.reject('non-existent', new Error('Test'))
    })
  })

  describe('size', () => {
    it('should return the number of pending requests', () => {
      expect(manager.size).toBe(0)

      manager.add('test-1', { id: 'test-1', type: 'getPublicKey' }, vi.fn(), vi.fn())
      expect(manager.size).toBe(1)

      manager.add('test-2', { id: 'test-2', type: 'getNetwork' }, vi.fn(), vi.fn())
      expect(manager.size).toBe(2)

      manager.remove('test-1')
      expect(manager.size).toBe(1)
    })
  })

  describe('request handler', () => {
    it('should call request handler when request is added', () => {
      const handler = vi.fn()
      manager.setRequestHandler(handler)

      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      manager.add('test-1', request, vi.fn(), vi.fn())

      expect(handler).toHaveBeenCalledWith(request)
    })

    it('should not throw when no handler is set', () => {
      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      // Should not throw
      manager.add('test-1', request, vi.fn(), vi.fn())
    })

    it('should get and set request handler', () => {
      expect(manager.getRequestHandler()).toBeNull()

      const handler = vi.fn()
      manager.setRequestHandler(handler)
      expect(manager.getRequestHandler()).toBe(handler)
    })
  })

  describe('cleanup', () => {
    it('should reject stale requests', async () => {
      vi.useFakeTimers()

      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      const resolve = vi.fn()
      const reject = vi.fn()

      manager.add('test-1', request, resolve, reject)
      expect(manager.has('test-1')).toBe(true)

      // Advance time past TTL
      vi.advanceTimersByTime(150)

      // Run cleanup manually (normally runs on interval)
      manager.cleanup()

      expect(reject).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Request timed out'
      }))
      expect(manager.has('test-1')).toBe(false)

      vi.useRealTimers()
    })

    it('should not reject fresh requests', () => {
      vi.useFakeTimers()

      const request: BRC100Request = { id: 'test-1', type: 'getPublicKey' }
      const reject = vi.fn()

      manager.add('test-1', request, vi.fn(), reject)

      // Advance time but not past TTL
      vi.advanceTimersByTime(50)
      manager.cleanup()

      expect(reject).not.toHaveBeenCalled()
      expect(manager.has('test-1')).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('destroy', () => {
    it('should reject all pending requests', () => {
      const reject1 = vi.fn()
      const reject2 = vi.fn()

      manager.add('test-1', { id: 'test-1', type: 'getPublicKey' }, vi.fn(), reject1)
      manager.add('test-2', { id: 'test-2', type: 'getNetwork' }, vi.fn(), reject2)

      manager.destroy()

      expect(reject1).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Request manager destroyed'
      }))
      expect(reject2).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Request manager destroyed'
      }))
      expect(manager.size).toBe(0)
    })
  })
})

describe('singleton functions', () => {
  afterEach(() => {
    resetRequestManager()
  })

  describe('getRequestManager', () => {
    it('should return the same instance on multiple calls', () => {
      const manager1 = getRequestManager()
      const manager2 = getRequestManager()
      expect(manager1).toBe(manager2)
    })
  })

  describe('resetRequestManager', () => {
    it('should destroy and reset the singleton', () => {
      const manager1 = getRequestManager()
      const reject = vi.fn()
      manager1.add('test-1', { id: 'test-1', type: 'getPublicKey' }, vi.fn(), reject)

      resetRequestManager()

      // Should have rejected pending requests
      expect(reject).toHaveBeenCalled()

      // New instance should be different
      const manager2 = getRequestManager()
      expect(manager2).not.toBe(manager1)
      expect(manager2.size).toBe(0)
    })
  })
})
