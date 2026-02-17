// @vitest-environment node

/**
 * Tests for Deep Link Service (deeplink.ts)
 *
 * Covers: parseDeepLink, generateConnectUrl, handleDeepLink, setupDeepLinkListener
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockHandleBRC100Request,
  mockGenerateRequestId,
  mockOnOpenUrl,
} = vi.hoisted(() => ({
  mockHandleBRC100Request: vi.fn(),
  mockGenerateRequestId: vi.fn(),
  mockOnOpenUrl: vi.fn(),
}))

vi.mock('./brc100', () => ({
  handleBRC100Request: (...args: unknown[]) => mockHandleBRC100Request(...args),
  generateRequestId: () => mockGenerateRequestId(),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: (...args: unknown[]) => mockOnOpenUrl(...args),
}))

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  parseDeepLink,
  generateConnectUrl,
  handleDeepLink,
  setupDeepLinkListener,
} from './deeplink'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Deep Link Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGenerateRequestId.mockReturnValue('test-req-id')
  })

  // =========================================================================
  // parseDeepLink
  // =========================================================================

  describe('parseDeepLink', () => {
    it('should parse connect action', () => {
      const result = parseDeepLink('simplysats://connect?origin=MyApp')

      expect(result).not.toBeNull()
      expect(result!.type).toBe('getPublicKey')
      expect(result!.params).toEqual({ identityKey: true })
      expect(result!.origin).toBe('MyApp')
      expect(result!.id).toBe('test-req-id')
    })

    it('should use app param as origin fallback for connect', () => {
      const result = parseDeepLink('simplysats://connect?app=TestApp')

      expect(result!.origin).toBe('TestApp')
    })

    it('should default origin to Unknown App for connect', () => {
      const result = parseDeepLink('simplysats://connect')

      expect(result!.origin).toBe('Unknown App')
    })

    it('should parse sign action', () => {
      const data = JSON.stringify([1, 2, 3])
      const result = parseDeepLink(
        `simplysats://sign?data=${encodeURIComponent(data)}&protocol=myproto&keyId=key1&origin=SignApp`
      )

      expect(result).not.toBeNull()
      expect(result!.type).toBe('createSignature')
      expect(result!.params).toEqual({
        data: [1, 2, 3],
        protocolID: [1, 'myproto'],
        keyID: 'key1',
      })
      expect(result!.origin).toBe('SignApp')
    })

    it('should use defaults for sign when params missing', () => {
      const result = parseDeepLink('simplysats://sign')

      expect(result!.params).toEqual({
        data: [],
        protocolID: [1, 'unknown'],
        keyID: 'default',
      })
    })

    it('should parse action (tx) action', () => {
      const outputs = JSON.stringify([{ to: 'addr', amount: 1000 }])
      const result = parseDeepLink(
        `simplysats://action?outputs=${encodeURIComponent(outputs)}&description=Pay+rent&origin=PayApp`
      )

      expect(result).not.toBeNull()
      expect(result!.type).toBe('createAction')
      expect(result!.params).toEqual({
        description: 'Pay rent',
        outputs: [{ to: 'addr', amount: 1000 }],
      })
      expect(result!.origin).toBe('PayApp')
    })

    it('should parse tx action as alias for action', () => {
      const result = parseDeepLink('simplysats://tx?description=Send+money')

      expect(result!.type).toBe('createAction')
      expect(result!.params).toEqual({
        description: 'Send money',
        outputs: [],
      })
    })

    it('should parse auth action', () => {
      const result = parseDeepLink('simplysats://auth?origin=AuthApp')

      expect(result).not.toBeNull()
      expect(result!.type).toBe('isAuthenticated')
      expect(result!.origin).toBe('AuthApp')
    })

    it('should return null for unknown action', () => {
      const result = parseDeepLink('simplysats://unknown-action')

      expect(result).toBeNull()
    })

    it('should return null for non-simplysats protocol', () => {
      const result = parseDeepLink('https://example.com/connect')

      expect(result).toBeNull()
    })

    it('should return null for invalid URL', () => {
      const result = parseDeepLink('not a url at all')

      expect(result).toBeNull()
    })

    it('should sanitize origin with control characters', () => {
      const result = parseDeepLink('simplysats://connect?origin=Bad\x00App\x1F')

      expect(result!.origin).toBe('BadApp')
    })

    it('should truncate overly long origin', () => {
      const longOrigin = 'A'.repeat(200)
      const result = parseDeepLink(`simplysats://connect?origin=${longOrigin}`)

      expect(result).toBeDefined()
      expect(result!.origin).toHaveLength(101) // 100 + ellipsis character
      expect((result!.origin as string).endsWith('\u2026')).toBe(true)
    })

    it('should replace empty sanitized origin with Unknown App', () => {
      // Origin that is only control characters => empty after sanitization
      const result = parseDeepLink('simplysats://connect?origin=%00%01%1F')

      expect(result!.origin).toBe('Unknown App')
    })

    it('should handle invalid JSON in data param for sign', () => {
      const result = parseDeepLink('simplysats://sign?data=not-json')

      // safeJsonParse returns undefined => falls back to []
      expect(result!.params).toEqual({
        data: [],
        protocolID: [1, 'unknown'],
        keyID: 'default',
      })
    })

    it('should handle non-object JSON in data param for sign', () => {
      // safeJsonParse rejects primitives (non-object, non-array)
      const result = parseDeepLink(`simplysats://sign?data=${encodeURIComponent('"just a string"')}`)

      expect(result!.params).toEqual({
        data: [],
        protocolID: [1, 'unknown'],
        keyID: 'default',
      })
    })
  })

  // =========================================================================
  // generateConnectUrl
  // =========================================================================

  describe('generateConnectUrl', () => {
    it('should generate a connect URL with encoded pubkey', () => {
      const url = generateConnectUrl('02abc123')

      expect(url).toBe('simplysats://connected?pubkey=02abc123')
    })

    it('should encode special characters in pubkey', () => {
      const url = generateConnectUrl('key with spaces')

      expect(url).toBe('simplysats://connected?pubkey=key%20with%20spaces')
    })
  })

  // =========================================================================
  // handleDeepLink
  // =========================================================================

  describe('handleDeepLink', () => {
    const mockWallet = { walletAddress: '1TestAddr' } as never

    it('should parse deep link and call handleBRC100Request', async () => {
      const mockResponse = { id: 'test-req-id', result: { authenticated: true } }
      mockHandleBRC100Request.mockResolvedValue(mockResponse)

      const result = await handleDeepLink('simplysats://auth?origin=TestApp', mockWallet)

      expect(result).toEqual(mockResponse)
      expect(mockHandleBRC100Request).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'isAuthenticated', origin: 'TestApp' }),
        mockWallet,
        false
      )
    })

    it('should pass autoApprove flag', async () => {
      const mockResponse = { id: 'test-req-id', result: { authenticated: true } }
      mockHandleBRC100Request.mockResolvedValue(mockResponse)

      await handleDeepLink('simplysats://auth?origin=App', mockWallet, true)

      expect(mockHandleBRC100Request).toHaveBeenCalledWith(
        expect.anything(),
        mockWallet,
        true
      )
    })

    it('should throw for invalid deep link', async () => {
      await expect(handleDeepLink('https://invalid.com', mockWallet))
        .rejects.toThrow('Invalid deep link')
    })
  })

  // =========================================================================
  // setupDeepLinkListener
  // =========================================================================

  describe('setupDeepLinkListener', () => {
    it('should register listener and return unlisten function', async () => {
      const mockUnlisten = vi.fn()
      mockOnOpenUrl.mockResolvedValue(mockUnlisten)

      const onRequest = vi.fn()
      const unlisten = await setupDeepLinkListener(onRequest)

      expect(mockOnOpenUrl).toHaveBeenCalledOnce()
      expect(unlisten).toBe(mockUnlisten)
    })

    it('should call onRequest for valid deep links received', async () => {
      // Capture the callback passed to onOpenUrl
      let capturedCallback: ((urls: string[]) => void) | undefined
      mockOnOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        capturedCallback = cb
        return vi.fn()
      })

      const onRequest = vi.fn()
      await setupDeepLinkListener(onRequest)

      // Simulate receiving deep links
      capturedCallback!(['simplysats://auth?origin=TestApp'])

      expect(onRequest).toHaveBeenCalledOnce()
      expect(onRequest).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'isAuthenticated', origin: 'TestApp' })
      )
    })

    it('should skip invalid deep links', async () => {
      let capturedCallback: ((urls: string[]) => void) | undefined
      mockOnOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
        capturedCallback = cb
        return vi.fn()
      })

      const onRequest = vi.fn()
      await setupDeepLinkListener(onRequest)

      capturedCallback!(['https://not-a-deep-link.com'])

      expect(onRequest).not.toHaveBeenCalled()
    })

    it('should return noop cleanup on error', async () => {
      mockOnOpenUrl.mockRejectedValue(new Error('Platform not supported'))

      const onRequest = vi.fn()
      const unlisten = await setupDeepLinkListener(onRequest)

      // Should not throw, should return a function
      expect(typeof unlisten).toBe('function')
      expect(() => unlisten()).not.toThrow()
    })
  })
})
