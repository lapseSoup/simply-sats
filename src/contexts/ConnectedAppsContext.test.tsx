import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ConnectedAppsProvider, useConnectedApps } from './ConnectedAppsContext'

// Mock secure storage
const mockSecureGetJSON = vi.fn()
const mockSecureSetJSON = vi.fn()
vi.mock('../services/secureStorage', () => ({
  secureGetJSON: (...args: unknown[]) => mockSecureGetJSON(...args),
  secureSetJSON: (...args: unknown[]) => mockSecureSetJSON(...args),
  migrateToSecureStorage: vi.fn().mockResolvedValue(undefined)
}))

// Mock validation
vi.mock('../utils/validation', () => ({
  isValidOrigin: vi.fn((origin: string) => {
    try {
      const url = new URL(origin)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }),
  normalizeOrigin: vi.fn((origin: string) => {
    try {
      const url = new URL(origin)
      return url.origin
    } catch {
      return origin
    }
  }),
  validateOriginWithReason: vi.fn((origin: string) => {
    try {
      const url = new URL(origin)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Invalid protocol'
      }
      return null
    } catch {
      return 'Invalid URL format'
    }
  })
}))

// Mock logger
vi.mock('../services/logger', () => ({
  walletLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

function wrapper({ children }: { children: ReactNode }) {
  return <ConnectedAppsProvider>{children}</ConnectedAppsProvider>
}

describe('ConnectedAppsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSecureGetJSON.mockResolvedValue(null)
    mockSecureSetJSON.mockResolvedValue(undefined)
  })

  describe('useConnectedApps outside provider', () => {
    it('throws when used outside provider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => {
        renderHook(() => useConnectedApps())
      }).toThrow('useConnectedApps must be used within a ConnectedAppsProvider')
      spy.mockRestore()
    })
  })

  describe('initial loading', () => {
    it('starts in loading state', () => {
      // Don't resolve the storage calls immediately
      mockSecureGetJSON.mockReturnValue(new Promise(() => {}))

      const { result } = renderHook(() => useConnectedApps(), { wrapper })
      expect(result.current.loading).toBe(true)
      expect(result.current.trustedOrigins).toEqual([])
      expect(result.current.connectedApps).toEqual([])
    })

    it('loads saved data from secure storage', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'trusted_origins') return Promise.resolve(['https://example.com'])
        if (key === 'connected_apps') return Promise.resolve(['https://app.test'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      expect(result.current.trustedOrigins).toEqual(['https://example.com'])
      expect(result.current.connectedApps).toEqual(['https://app.test'])
    })

    it('handles storage load failure gracefully', async () => {
      mockSecureGetJSON.mockRejectedValue(new Error('storage error'))

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => {
        expect(result.current.loading).toBe(false)
      })

      // Falls back to empty arrays
      expect(result.current.trustedOrigins).toEqual([])
      expect(result.current.connectedApps).toEqual([])
    })
  })

  describe('trusted origins', () => {
    it('adds a valid trusted origin', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const res = result.current.addTrustedOrigin('https://example.com')
        expect(res.success).toBe(true)
      })

      expect(result.current.trustedOrigins).toContain('https://example.com')
      expect(mockSecureSetJSON).toHaveBeenCalledWith('trusted_origins', ['https://example.com'])
    })

    it('rejects invalid origin', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const res = result.current.addTrustedOrigin('not-a-url')
        expect(res.success).toBe(false)
        expect(res.error).toBeDefined()
      })

      expect(result.current.trustedOrigins).toEqual([])
    })

    it('is idempotent for already-trusted origin', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'trusted_origins') return Promise.resolve(['https://example.com'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const res = result.current.addTrustedOrigin('https://example.com')
        expect(res.success).toBe(true) // No-op, still returns success
      })

      // Should not duplicate
      expect(result.current.trustedOrigins).toEqual(['https://example.com'])
      // Should not re-save (no new origin added)
      expect(mockSecureSetJSON).not.toHaveBeenCalledWith('trusted_origins', expect.anything())
    })

    it('removes a trusted origin', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'trusted_origins') return Promise.resolve(['https://example.com', 'https://other.com'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        result.current.removeTrustedOrigin('https://example.com')
      })

      expect(result.current.trustedOrigins).toEqual(['https://other.com'])
      expect(mockSecureSetJSON).toHaveBeenCalledWith('trusted_origins', ['https://other.com'])
    })

    it('removes non-existent origin without error', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Should not throw
      act(() => {
        result.current.removeTrustedOrigin('https://nonexistent.com')
      })

      expect(result.current.trustedOrigins).toEqual([])
    })

    it('checks if origin is trusted', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'trusted_origins') return Promise.resolve(['https://example.com'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isTrustedOrigin('https://example.com')).toBe(true)
      expect(result.current.isTrustedOrigin('https://other.com')).toBe(false)
    })

    it('returns false for invalid origin in isTrustedOrigin', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      // Invalid URL should return false, not throw
      expect(result.current.isTrustedOrigin('')).toBe(false)
    })
  })

  describe('connected apps', () => {
    it('connects an app with valid origin', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const success = result.current.connectApp('https://app.example.com')
        expect(success).toBe(true)
      })

      expect(result.current.connectedApps).toContain('https://app.example.com')
      expect(mockSecureSetJSON).toHaveBeenCalledWith('connected_apps', ['https://app.example.com'])
    })

    it('rejects invalid origin for connect', async () => {
      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const success = result.current.connectApp('invalid')
        expect(success).toBe(false)
      })

      expect(result.current.connectedApps).toEqual([])
    })

    it('is idempotent for already-connected app', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'connected_apps') return Promise.resolve(['https://app.test'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        const success = result.current.connectApp('https://app.test')
        expect(success).toBe(true)
      })

      // Should not duplicate
      expect(result.current.connectedApps).toEqual(['https://app.test'])
    })

    it('disconnects an app', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'connected_apps') return Promise.resolve(['https://app.test', 'https://other.test'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      act(() => {
        result.current.disconnectApp('https://app.test')
      })

      expect(result.current.connectedApps).toEqual(['https://other.test'])
      expect(mockSecureSetJSON).toHaveBeenCalledWith('connected_apps', ['https://other.test'])
    })

    it('checks if app is connected', async () => {
      mockSecureGetJSON.mockImplementation((key: string) => {
        if (key === 'connected_apps') return Promise.resolve(['https://app.test'])
        return Promise.resolve(null)
      })

      const { result } = renderHook(() => useConnectedApps(), { wrapper })

      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.isAppConnected('https://app.test')).toBe(true)
      expect(result.current.isAppConnected('https://other.test')).toBe(false)
    })
  })
})
