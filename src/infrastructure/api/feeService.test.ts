import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  FeeService,
  createFeeService,
  getFeeService
} from './feeService'
import { DEFAULT_FEE_RATE, MAX_FEE_RATE, MIN_FEE_RATE } from '../../domain/transaction/fees'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} })
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })

describe('FeeService', () => {
  let service: FeeService

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    service = createFeeService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchDynamicFeeRate', () => {
    it('should fetch fee rate from GorillaPool', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(0.05) // 50/1000
    })

    it('should return default rate on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should return default rate on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should clamp rate to max when too high', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 5000, bytes: 1000 } } // 5 sat/byte, too high
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(MAX_FEE_RATE) // Clamped to max
    })

    it('should clamp rate to min when too low', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 1, bytes: 1000000 } } // 0.000001 sat/byte, too low
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(MIN_FEE_RATE) // Clamped to min
    })

    it('should handle pre-parsed payload object', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: {
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 100, bytes: 1000 } }
            ]
          }
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(0.1) // 100/1000
    })

    it('should return default rate if no standard fee type found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'data', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should return default rate if payload is malformed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({})
        })
      })

      const rate = await service.fetchDynamicFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should use cached rate within TTL', async () => {
      // First fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      const rate1 = await service.fetchDynamicFeeRate()
      expect(rate1).toBe(0.05)

      // Second fetch should use cache (fetch not called again)
      const rate2 = await service.fetchDynamicFeeRate()
      expect(rate2).toBe(0.05)

      // Fetch should only have been called once
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should pass signal to fetch for timeout control', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      await service.fetchDynamicFeeRate()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mapi.gorillapool.io'),
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })
  })

  describe('getFeeRate', () => {
    it('should return user override if set', () => {
      service.setFeeRate(0.1)

      const rate = service.getFeeRate()

      expect(rate).toBe(0.1)
    })

    it('should return default rate if no override and no cache', () => {
      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should return cached rate if no override and cache is available', async () => {
      // Fetch to populate cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 75, bytes: 1000 } }
            ]
          })
        })
      })

      await service.fetchDynamicFeeRate()

      // Now getFeeRate should return cached value
      const rate = service.getFeeRate()

      expect(rate).toBe(0.075)
    })

    it('should return override over cached rate', async () => {
      // Fetch to populate cache
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 75, bytes: 1000 } }
            ]
          })
        })
      })

      await service.fetchDynamicFeeRate()

      // Set an override
      service.setFeeRate(0.2)

      // Override should take precedence
      const rate = service.getFeeRate()

      expect(rate).toBe(0.2)
    })

    it('should ignore invalid stored values', () => {
      localStorageMock.setItem('simply_sats_fee_rate', 'invalid')

      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
    })

    it('should ignore zero or negative stored values', () => {
      localStorageMock.setItem('simply_sats_fee_rate', '0')

      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)

      localStorageMock.setItem('simply_sats_fee_rate', '-1')

      const rate2 = service.getFeeRate()

      expect(rate2).toBe(DEFAULT_FEE_RATE)
    })
  })

  describe('getFeeRateAsync', () => {
    it('should return user override if set', async () => {
      service.setFeeRate(0.15)

      const rate = await service.getFeeRateAsync()

      expect(rate).toBe(0.15)
      // Fetch should not be called when override is set
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should fetch dynamic rate if no override', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 60, bytes: 1000 } }
            ]
          })
        })
      })

      const rate = await service.getFeeRateAsync()

      expect(rate).toBe(0.06)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should ignore invalid stored values and fetch dynamically', async () => {
      localStorageMock.setItem('simply_sats_fee_rate', 'not-a-number')

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      const rate = await service.getFeeRateAsync()

      expect(rate).toBe(0.05)
    })
  })

  describe('setFeeRate / clearFeeRateOverride', () => {
    it('should persist fee rate override', () => {
      service.setFeeRate(0.2)

      const rate = service.getFeeRate()

      expect(rate).toBe(0.2)
      expect(localStorageMock.setItem).toHaveBeenCalledWith('simply_sats_fee_rate', '0.2')
    })

    it('should clear override', () => {
      service.setFeeRate(0.2)
      service.clearFeeRateOverride()

      const rate = service.getFeeRate()

      expect(rate).toBe(DEFAULT_FEE_RATE)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('simply_sats_fee_rate')
    })
  })

  describe('custom config', () => {
    it('should use custom mapi URL', async () => {
      const customService = createFeeService({
        mapiUrl: 'https://custom.mapi.com/feeQuote'
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          payload: JSON.stringify({
            fees: [
              { feeType: 'standard', miningFee: { satoshis: 50, bytes: 1000 } }
            ]
          })
        })
      })

      await customService.fetchDynamicFeeRate()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.mapi.com/feeQuote',
        expect.any(Object)
      )
    })
  })

  describe('getFeeService singleton', () => {
    it('should return the same instance on multiple calls', () => {
      const service1 = getFeeService()
      const service2 = getFeeService()

      expect(service1).toBe(service2)
    })
  })
})
