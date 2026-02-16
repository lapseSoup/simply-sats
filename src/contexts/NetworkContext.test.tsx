import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { NetworkProvider, useNetwork } from './NetworkContext'

// Mock brc100 service
const mockGetNetworkStatus = vi.fn()
vi.mock('../services/brc100', () => ({
  getNetworkStatus: (...args: unknown[]) => mockGetNetworkStatus(...args)
}))

// Mock logger
vi.mock('../services/logger', () => ({
  apiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

function wrapper({ children }: { children: ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>
}

describe('NetworkContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Default: network status succeeds, price fetch succeeds
    mockGetNetworkStatus.mockResolvedValue({
      blockHeight: 800000,
      overlayHealthy: true,
      overlayNodeCount: 5
    })

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ rate: 65.50 }),
      ok: true
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('useNetwork outside provider', () => {
    it('throws when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => {
        renderHook(() => useNetwork())
      }).toThrow('useNetwork must be used within a NetworkProvider')
      spy.mockRestore()
    })
  })

  describe('initial state', () => {
    it('starts with null networkInfo, not syncing, zero price', () => {
      // Don't resolve mocks immediately — check state before async completes
      mockGetNetworkStatus.mockReturnValue(new Promise(() => {}))
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      mockFetch.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useNetwork(), { wrapper })
      expect(result.current.networkInfo).toBeNull()
      expect(result.current.syncing).toBe(false)
      expect(result.current.usdPrice).toBe(0)
    })
  })

  describe('network status polling', () => {
    it('fetches network status on mount', async () => {
      const { result } = renderHook(() => useNetwork(), { wrapper })

      // Flush the initial fetch (0ms delay — runs immediately)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(1)
      expect(result.current.networkInfo).toEqual({
        blockHeight: 800000,
        overlayHealthy: true,
        overlayNodeCount: 5
      })
    })

    it('polls again after 60s on success', async () => {
      renderHook(() => useNetwork(), { wrapper })

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(1)

      // Advance 60s — triggers next poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000)
      })
      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(2)
    })

    it('uses exponential backoff on failure', async () => {
      mockGetNetworkStatus.mockRejectedValue(new Error('network error'))

      renderHook(() => useNetwork(), { wrapper })

      // Initial fetch — fails
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(1)

      // After 1st failure: delay = 60s * 2^1 = 120s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120000)
      })
      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(2)

      // After 2nd failure: delay = 60s * 2^2 = 240s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(240000)
      })
      expect(mockGetNetworkStatus).toHaveBeenCalledTimes(3)
    })

    it('caps backoff at 10 minutes', async () => {
      mockGetNetworkStatus.mockRejectedValue(new Error('down'))

      renderHook(() => useNetwork(), { wrapper })

      // Fail 6 times to hit the cap (failures capped at 5, so delay = min(60s*2^5, 600s) = 600s)
      for (let i = 0; i < 6; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(600000)
        })
      }

      // 7th attempt should also be at 600s (10min), not longer
      const callCountBefore = mockGetNetworkStatus.mock.calls.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600000)
      })
      expect(mockGetNetworkStatus.mock.calls.length).toBeGreaterThan(callCountBefore)
    })

    it('resets backoff after success', async () => {
      // First call fails, second succeeds
      mockGetNetworkStatus
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValue({
          blockHeight: 800001,
          overlayHealthy: true,
          overlayNodeCount: 5
        })

      const { result } = renderHook(() => useNetwork(), { wrapper })

      // Initial fetch — fails
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.networkInfo).toBeNull()

      // After failure: delay = 120s, advance to retry
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120000)
      })
      expect(result.current.networkInfo?.blockHeight).toBe(800001)
    })
  })

  describe('USD price polling', () => {
    it('fetches USD price on mount', async () => {
      const { result } = renderHook(() => useNetwork(), { wrapper })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.whatsonchain.com/v1/bsv/main/exchangerate',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
      expect(result.current.usdPrice).toBe(65.50)
    })

    it('handles missing rate in response', async () => {
      const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({}),
        ok: true
      })

      const { result } = renderHook(() => useNetwork(), { wrapper })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      // Price stays at default 0 when no rate in response
      expect(result.current.usdPrice).toBe(0)
    })
  })

  describe('syncing state', () => {
    it('allows setting syncing state', async () => {
      const { result } = renderHook(() => useNetwork(), { wrapper })

      act(() => result.current.setSyncing(true))
      expect(result.current.syncing).toBe(true)

      act(() => result.current.setSyncing(false))
      expect(result.current.syncing).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('cancels polling on unmount', async () => {
      const { unmount } = renderHook(() => useNetwork(), { wrapper })

      // Initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const callCount = mockGetNetworkStatus.mock.calls.length

      // Unmount and advance timers — should not trigger more fetches
      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120000)
      })
      expect(mockGetNetworkStatus.mock.calls.length).toBe(callCount)
    })
  })
})
