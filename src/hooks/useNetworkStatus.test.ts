/**
 * useNetworkStatus Hook Tests
 *
 * Tests the network status hook for:
 * - Initial state
 * - Returned interface
 * - Interval cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNetworkStatus } from './useNetworkStatus'

// Mock the brc100 service
vi.mock('../services/brc100', () => ({
  getNetworkStatus: vi.fn().mockResolvedValue({
    blockHeight: 800000,
    overlayHealthy: true,
    overlayNodeCount: 5
  })
}))

// Mock fetch for price API
const mockFetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ rate: 45.50 })
})
global.fetch = mockFetch

describe('useNetworkStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial state with null networkInfo', () => {
    const { result } = renderHook(() => useNetworkStatus())

    // Initially, networkInfo is null (before fetch completes)
    expect(result.current.networkInfo).toBeNull()
    expect(result.current.usdPrice).toBe(0)
    expect(typeof result.current.refreshNetworkStatus).toBe('function')
  })

  it('provides the expected interface', () => {
    const { result } = renderHook(() => useNetworkStatus())

    // Check the returned interface shape
    expect(result.current).toHaveProperty('networkInfo')
    expect(result.current).toHaveProperty('usdPrice')
    expect(result.current).toHaveProperty('refreshNetworkStatus')
  })

  it('refreshNetworkStatus is callable', async () => {
    const { result } = renderHook(() => useNetworkStatus())

    // The function should be callable without throwing
    await expect(result.current.refreshNetworkStatus()).resolves.toBeUndefined()
  })

  it('clears intervals on unmount', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    const { unmount } = renderHook(() => useNetworkStatus())

    unmount()

    // Should clear both intervals (network and price)
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2)

    clearIntervalSpy.mockRestore()
  })

  it('fetches data on mount', () => {
    renderHook(() => useNetworkStatus())

    // Should call fetch for price API
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.whatsonchain.com/v1/bsv/main/exchangerate',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })
})
