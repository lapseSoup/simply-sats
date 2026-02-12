import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { UIProvider, useUI } from './UIContext'

// Mock NetworkContext
vi.mock('./NetworkContext', () => ({
  useNetwork: vi.fn(() => ({
    usdPrice: 100,
    networkInfo: null,
    syncing: false,
    setSyncing: vi.fn()
  }))
}))

// Mock logger
vi.mock('../services/logger', () => ({
  uiLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

// Mock config
vi.mock('../config', () => ({
  UI: { TOAST_DURATION_MS: 3000 }
}))

function wrapper({ children }: { children: ReactNode }) {
  return <UIProvider>{children}</UIProvider>
}

describe('UIContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('useUI outside provider', () => {
    it('throws when used outside provider', () => {
      // Suppress console.error for this test
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => {
        renderHook(() => useUI())
      }).toThrow('useUI must be used within a UIProvider')
      spy.mockRestore()
    })
  })

  describe('display unit', () => {
    it('defaults to sats', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.displayInSats).toBe(true)
    })

    it('reads saved preference from localStorage', () => {
      localStorage.setItem('simply_sats_display_sats', 'false')
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.displayInSats).toBe(false)
    })

    it('toggles display unit and persists', () => {
      const { result } = renderHook(() => useUI(), { wrapper })

      act(() => result.current.toggleDisplayUnit())
      expect(result.current.displayInSats).toBe(false)
      expect(localStorage.setItem).toHaveBeenCalledWith('simply_sats_display_sats', 'false')

      act(() => result.current.toggleDisplayUnit())
      expect(result.current.displayInSats).toBe(true)
      expect(localStorage.setItem).toHaveBeenCalledWith('simply_sats_display_sats', 'true')
    })
  })

  describe('theme', () => {
    it('defaults to dark', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.theme).toBe('dark')
    })

    it('reads saved theme from localStorage', () => {
      localStorage.setItem('simply_sats_theme', 'light')
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.theme).toBe('light')
    })

    it('ignores invalid saved theme', () => {
      localStorage.setItem('simply_sats_theme', 'invalid')
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.theme).toBe('dark')
    })

    it('toggles theme and persists', () => {
      const { result } = renderHook(() => useUI(), { wrapper })

      act(() => result.current.toggleTheme())
      expect(result.current.theme).toBe('light')
      expect(localStorage.setItem).toHaveBeenCalledWith('simply_sats_theme', 'light')

      act(() => result.current.toggleTheme())
      expect(result.current.theme).toBe('dark')
      expect(localStorage.setItem).toHaveBeenCalledWith('simply_sats_theme', 'dark')
    })

    it('applies theme to document element', () => {
      renderHook(() => useUI(), { wrapper })
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    })
  })

  describe('toasts', () => {
    it('starts with no toasts', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.toasts).toEqual([])
      expect(result.current.copyFeedback).toBeNull()
    })

    it('shows a toast', () => {
      const { result } = renderHook(() => useUI(), { wrapper })

      act(() => result.current.showToast('Hello'))
      expect(result.current.toasts).toHaveLength(1)
      expect(result.current.toasts[0]!.message).toBe('Hello')
      expect(result.current.copyFeedback).toBe('Hello')
    })

    it('auto-dismisses toast after duration', () => {
      const { result } = renderHook(() => useUI(), { wrapper })

      act(() => result.current.showToast('Temporary'))
      expect(result.current.toasts).toHaveLength(1)

      act(() => vi.advanceTimersByTime(3000))
      expect(result.current.toasts).toHaveLength(0)
      expect(result.current.copyFeedback).toBeNull()
    })

    it('supports multiple concurrent toasts', () => {
      const { result } = renderHook(() => useUI(), { wrapper })

      act(() => {
        result.current.showToast('First')
        result.current.showToast('Second')
      })
      expect(result.current.toasts).toHaveLength(2)
      // copyFeedback returns latest
      expect(result.current.copyFeedback).toBe('Second')
    })
  })

  describe('copyToClipboard', () => {
    it('copies text and shows feedback toast', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      const { result } = renderHook(() => useUI(), { wrapper })

      await act(async () => {
        await result.current.copyToClipboard('test-text', 'Copied!')
      })

      expect(writeText).toHaveBeenCalledWith('test-text')
      expect(result.current.toasts).toHaveLength(1)
      expect(result.current.toasts[0]!.message).toBe('Copied!')
    })

    it('uses default feedback message', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })

      const { result } = renderHook(() => useUI(), { wrapper })

      await act(async () => {
        await result.current.copyToClipboard('some-text')
      })

      expect(result.current.toasts[0]!.message).toBe('Copied!')
    })

    it('handles clipboard failure gracefully', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'))
      Object.assign(navigator, { clipboard: { writeText } })

      const { result } = renderHook(() => useUI(), { wrapper })

      await act(async () => {
        await result.current.copyToClipboard('test')
      })

      // No toast on failure
      expect(result.current.toasts).toHaveLength(0)
    })
  })

  describe('formatBSVShort', () => {
    it('formats >= 1 BSV with 4 decimals', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.formatBSVShort(100000000)).toBe('1.0000')
      expect(result.current.formatBSVShort(250000000)).toBe('2.5000')
    })

    it('formats 0.01-1 BSV with 6 decimals', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.formatBSVShort(1000000)).toBe('0.010000')
      expect(result.current.formatBSVShort(50000000)).toBe('0.500000')
    })

    it('formats < 0.01 BSV with 8 decimals', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.formatBSVShort(1000)).toBe('0.00001000')
      expect(result.current.formatBSVShort(1)).toBe('0.00000001')
    })
  })

  describe('formatUSD', () => {
    it('formats using usdPrice from NetworkContext', () => {
      // usdPrice is mocked to 100
      const { result } = renderHook(() => useUI(), { wrapper })
      // 100000000 sats = 1 BSV * $100 = $100.00
      expect(result.current.formatUSD(100000000)).toBe('100.00')
    })

    it('formats small amounts', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      // 1000 sats = 0.00001 BSV * $100 = $0.00
      expect(result.current.formatUSD(1000)).toBe('0.00')
    })

    it('formats zero', () => {
      const { result } = renderHook(() => useUI(), { wrapper })
      expect(result.current.formatUSD(0)).toBe('0.00')
    })
  })
})
