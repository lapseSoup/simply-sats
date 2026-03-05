// @vitest-environment node
/**
 * Tests for PaymentService -- BRC-29 authenticated payments and BRC-105 micropayments.
 *
 * All Tauri IPC calls are mocked -- no desktop runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke and config before importing
// ---------------------------------------------------------------------------
const { mockTauriInvoke, mockBRC } = vi.hoisted(() => ({
  mockTauriInvoke: vi.fn(),
  mockBRC: {
    MICROPAYMENT_AUTO_PAY_THRESHOLD: 100,
    MICROPAYMENT_REQUIRE_CONFIRMATION: true,
  },
}))

vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

vi.mock('../../config', () => ({
  BRC: mockBRC,
}))

// Import after mocks are set up
import { PaymentService } from './payments'
import { TauriProtoWallet } from './adapter'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY_PUB_KEY =
  '02c0f5fa7a67133e3e2b4780b23b44d0e9b6ddad88729a076880e74e6a3c9e2f92'
const MOCK_DERIVED_PUB_KEY =
  '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const MOCK_SENDER_PUB_KEY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'

const MOCK_PUBLIC_KEYS = {
  walletType: 'bip44',
  walletAddress: '1MockWalletAddress',
  walletPubKey: '03aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888cc',
  ordAddress: '1MockOrdAddress',
  ordPubKey: '03bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777cccc8888dd',
  identityAddress: '1MockIdentityAddress',
  identityPubKey: MOCK_IDENTITY_PUB_KEY,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route tauriInvoke mocks by command name */
function routeInvoke(routes: Record<string, unknown>) {
  mockTauriInvoke.mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd]
      return typeof val === 'function'
        ? (val as (...args: unknown[]) => unknown)()
        : Promise.resolve(val)
    }
    return Promise.reject(new Error(`Unmocked Tauri command: ${cmd}`))
  })
}

/** Create a minimal Headers object from a plain record. */
function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PaymentService', () => {
  let wallet: TauriProtoWallet
  let service: PaymentService

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset config defaults
    mockBRC.MICROPAYMENT_AUTO_PAY_THRESHOLD = 100
    mockBRC.MICROPAYMENT_REQUIRE_CONFIRMATION = true
    wallet = new TauriProtoWallet()
    service = new PaymentService(wallet)
  })

  // =========================================================================
  // generateDerivationPrefix
  // =========================================================================
  describe('generateDerivationPrefix', () => {
    it('returns a 32-character hex string', () => {
      const prefix = service.generateDerivationPrefix()
      expect(prefix).toMatch(/^[0-9a-f]{32}$/)
    })

    it('generates unique values on consecutive calls', () => {
      const a = service.generateDerivationPrefix()
      const b = service.generateDerivationPrefix()
      expect(a).not.toBe(b)
    })

    it('contains only lowercase hex characters', () => {
      for (let i = 0; i < 10; i++) {
        const prefix = service.generateDerivationPrefix()
        expect(prefix).toMatch(/^[0-9a-f]+$/)
      }
    })
  })

  // =========================================================================
  // derivePaymentKey
  // =========================================================================
  describe('derivePaymentKey', () => {
    it('calls wallet.getPublicKey with correct keyID format (space-separated)', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
      })

      const result = await service.derivePaymentKey({
        senderPublicKey: MOCK_SENDER_PUB_KEY,
        derivationPrefix: 'abc123',
        derivationSuffix: 'def456',
      })

      expect(result).toEqual({ publicKey: MOCK_DERIVED_PUB_KEY })
      // Verify the keyID uses space separator matching SDK convention
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          invoiceNumber: '2-3241645161d8-abc123 def456',
          senderPubKey: MOCK_SENDER_PUB_KEY,
        }),
      )
    })

    it('uses default BRC-29 protocol ID', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
      })

      await service.derivePaymentKey({
        senderPublicKey: MOCK_SENDER_PUB_KEY,
        derivationPrefix: 'prefix',
        derivationSuffix: 'suffix',
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          invoiceNumber: '2-3241645161d8-prefix suffix',
        }),
      )
    })

    it('respects custom protocolID override', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
      })

      await service.derivePaymentKey({
        senderPublicKey: MOCK_SENDER_PUB_KEY,
        derivationPrefix: 'prefix',
        derivationSuffix: 'suffix',
        protocolID: [1, 'custom-proto'],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          invoiceNumber: '1-custom-proto-prefix suffix',
        }),
      )
    })
  })

  // =========================================================================
  // shouldAutoPayMicropayment
  // =========================================================================
  describe('shouldAutoPayMicropayment', () => {
    it('returns false when MICROPAYMENT_REQUIRE_CONFIRMATION is true (default)', () => {
      expect(service.shouldAutoPayMicropayment(50)).toBe(false)
      expect(service.shouldAutoPayMicropayment(1)).toBe(false)
    })

    it('returns true when confirmation is disabled and below threshold', () => {
      // Disable confirmation and create new service to pick up config
      mockBRC.MICROPAYMENT_REQUIRE_CONFIRMATION = false
      const svc = new PaymentService(wallet)
      expect(svc.shouldAutoPayMicropayment(50)).toBe(true)
      expect(svc.shouldAutoPayMicropayment(100)).toBe(true)
    })

    it('returns false when confirmation is disabled but above threshold', () => {
      mockBRC.MICROPAYMENT_REQUIRE_CONFIRMATION = false
      const svc = new PaymentService(wallet)
      expect(svc.shouldAutoPayMicropayment(101)).toBe(false)
      expect(svc.shouldAutoPayMicropayment(10000)).toBe(false)
    })

    it('returns true at exactly the threshold', () => {
      mockBRC.MICROPAYMENT_REQUIRE_CONFIRMATION = false
      const svc = new PaymentService(wallet)
      expect(svc.shouldAutoPayMicropayment(100)).toBe(true)
    })

    it('returns false for zero satoshis when confirmation required', () => {
      expect(service.shouldAutoPayMicropayment(0)).toBe(false)
    })
  })

  // =========================================================================
  // parse402Response
  // =========================================================================
  describe('parse402Response', () => {
    it('extracts satoshis and prefix from valid headers', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': '500',
        'x-bsv-payment-derivation-prefix': 'abc123def456',
      })

      const result = service.parse402Response(headers)

      expect(result).toEqual({
        satoshisRequired: 500,
        derivationPrefix: 'abc123def456',
      })
    })

    it('returns null when satoshis header is missing', () => {
      const headers = makeHeaders({
        'x-bsv-payment-derivation-prefix': 'abc123',
      })

      expect(service.parse402Response(headers)).toBeNull()
    })

    it('returns null when prefix header is missing', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': '500',
      })

      expect(service.parse402Response(headers)).toBeNull()
    })

    it('returns null when both headers are missing', () => {
      const headers = makeHeaders({})
      expect(service.parse402Response(headers)).toBeNull()
    })

    it('returns null for non-numeric satoshis value', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': 'not-a-number',
        'x-bsv-payment-derivation-prefix': 'abc123',
      })

      expect(service.parse402Response(headers)).toBeNull()
    })

    it('returns null for zero satoshis', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': '0',
        'x-bsv-payment-derivation-prefix': 'abc123',
      })

      expect(service.parse402Response(headers)).toBeNull()
    })

    it('returns null for negative satoshis', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': '-100',
        'x-bsv-payment-derivation-prefix': 'abc123',
      })

      expect(service.parse402Response(headers)).toBeNull()
    })

    it('parses integer satoshis correctly', () => {
      const headers = makeHeaders({
        'x-bsv-payment-satoshis-required': '1000000',
        'x-bsv-payment-derivation-prefix': 'longprefix',
      })

      const result = service.parse402Response(headers)
      expect(result?.satoshisRequired).toBe(1000000)
    })
  })

  // =========================================================================
  // createPaymentHeaders
  // =========================================================================
  describe('createPaymentHeaders', () => {
    it('produces correct JSON structure in x-bsv-payment header', () => {
      const headers = service.createPaymentHeaders({
        derivationPrefix: 'prefix123',
        derivationSuffix: 'suffix456',
        transaction: 'deadbeefcafe',
      })

      expect(headers).toHaveProperty('x-bsv-payment')
      const parsed = JSON.parse(headers['x-bsv-payment'])
      expect(parsed).toEqual({
        derivationPrefix: 'prefix123',
        derivationSuffix: 'suffix456',
        transaction: 'deadbeefcafe',
      })
    })

    it('returns a single header entry', () => {
      const headers = service.createPaymentHeaders({
        derivationPrefix: 'p',
        derivationSuffix: 's',
        transaction: 'tx',
      })

      expect(Object.keys(headers)).toEqual(['x-bsv-payment'])
    })

    it('preserves transaction data exactly as provided', () => {
      const txData = 'AQAAAAFfZW50cnk='  // base64 example
      const headers = service.createPaymentHeaders({
        derivationPrefix: 'a',
        derivationSuffix: 'b',
        transaction: txData,
      })

      const parsed = JSON.parse(headers['x-bsv-payment'])
      expect(parsed.transaction).toBe(txData)
    })
  })
})
