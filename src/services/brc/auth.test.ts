// @vitest-environment node
/**
 * Tests for AuthService (BRC-103/104 mutual authentication)
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 * globalThis.fetch is also mocked to test authenticatedFetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing anything that depends on it
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks
import { TauriProtoWallet } from './adapter'
import { AuthService } from './auth'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY_PUB_KEY =
  '02c0f5fa7a67133e3e2b4780b23b44d0e9b6ddad88729a076880e74e6a3c9e2f92'

const MOCK_PUBLIC_KEYS = {
  walletType: 'bip44',
  walletAddress: '1MockWalletAddress',
  walletPubKey:
    '03aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888cc',
  ordAddress: '1MockOrdAddress',
  ordPubKey:
    '03bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777cccc8888dd',
  identityAddress: '1MockIdentityAddress',
  identityPubKey: MOCK_IDENTITY_PUB_KEY,
}

// A deterministic fake signature (64 bytes hex)
const MOCK_SIGNATURE_HEX = 'aabbccdd' + '00'.repeat(60)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route tauriInvoke mocks by command name */
function routeInvoke(routes: Record<string, unknown>) {
  mockTauriInvoke.mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd]
      return typeof val === 'function'
        ? (val as (...a: unknown[]) => unknown)()
        : Promise.resolve(val)
    }
    return Promise.reject(new Error(`Unmocked Tauri command: ${cmd}`))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AuthService', () => {
  let wallet: TauriProtoWallet
  let auth: AuthService
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
    auth = new AuthService(wallet)

    // Save original fetch and install mock
    originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // =========================================================================
  // getIdentityKey
  // =========================================================================
  describe('getIdentityKey', () => {
    it('returns the identity public key from the wallet', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      const key = await auth.getIdentityKey()
      expect(key).toBe(MOCK_IDENTITY_PUB_KEY)
    })

    it('propagates wallet errors', async () => {
      routeInvoke({
        get_public_keys: () =>
          Promise.reject(new Error('No keys available in key store — is the wallet unlocked?')),
      })

      await expect(auth.getIdentityKey()).rejects.toThrow('No keys available')
    })
  })

  // =========================================================================
  // authenticatedFetch
  // =========================================================================
  describe('authenticatedFetch', () => {
    const TEST_URL = 'https://example.com/api/resource'
    const mockResponse = new Response('ok', { status: 200 })

    beforeEach(() => {
      // Mock crypto.randomUUID for deterministic nonce
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      )

      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIGNATURE_HEX,
      })

      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse)
    })

    it('includes x-bsv-auth-identity-key header', async () => {
      await auth.authenticatedFetch(TEST_URL)

      expect(globalThis.fetch).toHaveBeenCalledOnce()
      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!
      const headers = opts?.headers as Headers
      expect(headers.get('x-bsv-auth-identity-key')).toBe(
        MOCK_IDENTITY_PUB_KEY,
      )
    })

    it('includes x-bsv-auth-nonce header', async () => {
      await auth.authenticatedFetch(TEST_URL)

      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!
      const headers = opts?.headers as Headers
      expect(headers.get('x-bsv-auth-nonce')).toBe(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      )
    })

    it('includes x-bsv-auth-signature header from wallet signing', async () => {
      await auth.authenticatedFetch(TEST_URL)

      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!
      const headers = opts?.headers as Headers
      const sig = headers.get('x-bsv-auth-signature')
      expect(sig).toBe(MOCK_SIGNATURE_HEX)
    })

    it('passes through the URL and other request options', async () => {
      await auth.authenticatedFetch(TEST_URL, {
        method: 'POST',
        body: '{"hello":"world"}',
      })

      const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!
      expect(url).toBe(TEST_URL)
      expect(opts?.method).toBe('POST')
      expect(opts?.body).toBe('{"hello":"world"}')
    })

    it('preserves existing headers from options', async () => {
      await auth.authenticatedFetch(TEST_URL, {
        headers: { 'content-type': 'application/json' },
      })

      const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!
      const headers = opts?.headers as Headers
      expect(headers.get('content-type')).toBe('application/json')
      // Auth headers should also be present
      expect(headers.get('x-bsv-auth-identity-key')).toBe(
        MOCK_IDENTITY_PUB_KEY,
      )
    })

    it('returns the fetch response', async () => {
      const result = await auth.authenticatedFetch(TEST_URL)
      expect(result).toBe(mockResponse)
    })

    it('propagates fetch errors', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(
        new Error('Network error'),
      )

      await expect(auth.authenticatedFetch(TEST_URL)).rejects.toThrow(
        'Network error',
      )
    })

    it('propagates wallet signing errors', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: () =>
          Promise.reject(new Error('Signing failed')),
      })

      await expect(auth.authenticatedFetch(TEST_URL)).rejects.toThrow(
        'Signing failed',
      )
    })

    it('signs the nonce with BRC-103 protocol parameters', async () => {
      await auth.authenticatedFetch(TEST_URL)

      // The wallet.createSignature should be called via sign_data_from_store
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_from_store',
        expect.objectContaining({
          keyType: 'identity',
        }),
      )
    })
  })

  // =========================================================================
  // verifyAuthRequest
  // =========================================================================
  describe('verifyAuthRequest', () => {
    const MOCK_NONCE = 'test-nonce-12345'
    const MOCK_SENDER_KEY =
      '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'
    const MOCK_DERIVED_PUB_KEY =
      '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'

    // verifySignature with a specific counterparty (not 'self'/'anyone')
    // first derives the child public key, then calls verify_data_signature.
    const VERIFY_ROUTES_VALID = {
      get_public_keys: MOCK_PUBLIC_KEYS,
      derive_child_key_from_store: {
        wif: 'mock-wif',
        address: 'mock-address',
        pubKey: MOCK_DERIVED_PUB_KEY,
      },
      verify_data_signature: true,
    }

    it('returns true when signature is valid', async () => {
      routeInvoke(VERIFY_ROUTES_VALID)

      const result = await auth.verifyAuthRequest({
        identityKey: MOCK_SENDER_KEY,
        nonce: MOCK_NONCE,
        signature: MOCK_SIGNATURE_HEX,
      })

      expect(result).toBe(true)
    })

    it('delegates verification to wallet.verifySignature', async () => {
      routeInvoke(VERIFY_ROUTES_VALID)

      await auth.verifyAuthRequest({
        identityKey: MOCK_SENDER_KEY,
        nonce: MOCK_NONCE,
        signature: MOCK_SIGNATURE_HEX,
      })

      // Should call derive_child_key_from_store for the counterparty,
      // then verify_data_signature with the derived key
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          senderPubKey: MOCK_SENDER_KEY,
          keyType: 'identity',
        }),
      )
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'verify_data_signature',
        expect.objectContaining({
          publicKeyHex: MOCK_DERIVED_PUB_KEY,
          signatureHex: MOCK_SIGNATURE_HEX,
        }),
      )
    })

    it('returns false when signature is invalid (wallet throws)', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'mock-wif',
          address: 'mock-address',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
        verify_data_signature: false,
      })

      const result = await auth.verifyAuthRequest({
        identityKey: MOCK_SENDER_KEY,
        nonce: MOCK_NONCE,
        signature: MOCK_SIGNATURE_HEX,
      })

      // TauriProtoWallet.verifySignature throws on invalid signature,
      // which AuthService catches and returns false
      expect(result).toBe(false)
    })

    it('returns false on unexpected errors', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: () =>
          Promise.reject(new Error('IPC failure')),
      })

      const result = await auth.verifyAuthRequest({
        identityKey: MOCK_SENDER_KEY,
        nonce: MOCK_NONCE,
        signature: MOCK_SIGNATURE_HEX,
      })

      expect(result).toBe(false)
    })

    it('converts nonce string to bytes for verification', async () => {
      routeInvoke(VERIFY_ROUTES_VALID)

      await auth.verifyAuthRequest({
        identityKey: MOCK_SENDER_KEY,
        nonce: MOCK_NONCE,
        signature: MOCK_SIGNATURE_HEX,
      })

      // The data argument should be the UTF-8 encoded nonce bytes
      const expectedBytes = Array.from(new TextEncoder().encode(MOCK_NONCE))
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'verify_data_signature',
        expect.objectContaining({
          data: new Uint8Array(expectedBytes),
        }),
      )
    })
  })
})
