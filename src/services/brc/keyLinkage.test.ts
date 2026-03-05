// @vitest-environment node
/**
 * Tests for KeyLinkageService (BRC-69 / BRC-72)
 *
 * BRC-69: Counterparty key linkage — reveals ECDH-based linkage to a verifier
 * BRC-72: Specific key linkage — reveals derivation scalar for a (protocolID, keyID) pair
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing anything that uses it
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks are set up
import { KeyLinkageService } from './keyLinkage'
import { TauriProtoWallet } from './adapter'
import type { WalletProtocol } from '@bsv/sdk'

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

const MOCK_COUNTERPARTY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'
const MOCK_VERIFIER =
  '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
const MOCK_PROTOCOL: WalletProtocol = [2, 'test-protocol']
const MOCK_HMAC_BYTES = Array.from({ length: 32 }, (_, i) => i)
const MOCK_CIPHERTEXT_B64 = btoa(
  String.fromCharCode(...Array.from({ length: 48 }, (_, i) => i + 10)),
)

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

function setupStandardRoutes() {
  routeInvoke({
    get_public_keys: MOCK_PUBLIC_KEYS,
    hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
    encrypt_ecies_from_store: {
      ciphertext: MOCK_CIPHERTEXT_B64,
      senderPublicKey: MOCK_IDENTITY_PUB_KEY,
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('KeyLinkageService', () => {
  let service: KeyLinkageService
  let wallet: TauriProtoWallet

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
    service = new KeyLinkageService(wallet)
    setupStandardRoutes()
  })

  // =========================================================================
  // revealCounterpartyKeyLinkage (BRC-69)
  // =========================================================================
  describe('revealCounterpartyKeyLinkage (BRC-69)', () => {
    it('produces encrypted linkage for a verifier', async () => {
      const result = await service.revealCounterpartyKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
      })

      expect(result.encryptedLinkage).toBeInstanceOf(Array)
      expect(result.encryptedLinkage.length).toBeGreaterThan(0)
      expect(result.prover).toBe(MOCK_IDENTITY_PUB_KEY)
      expect(result.verifier).toBe(MOCK_VERIFIER)
      expect(result.counterparty).toBe(MOCK_COUNTERPARTY)
      expect(result.revelationTime).toBeDefined()
      expect(typeof result.revelationTime).toBe('string')
    })

    it('calls HMAC with counterparty-derived key', async () => {
      await service.revealCounterpartyKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
      })

      // Should have called hmac_with_derived_key_from_store
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_COUNTERPARTY,
          keyType: 'identity',
        }),
      )
    })

    it('encrypts the linkage for the verifier', async () => {
      await service.revealCounterpartyKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
      })

      // Should have called encrypt with verifier as the recipient
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          recipientPubKey: MOCK_VERIFIER,
          keyType: 'identity',
        }),
      )
    })

    it('includes encryptedLinkageProof', async () => {
      const result = await service.revealCounterpartyKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
      })

      expect(result.encryptedLinkageProof).toBeInstanceOf(Array)
      expect(result.encryptedLinkageProof.length).toBeGreaterThan(0)
    })

    it('returns a valid ISO timestamp as revelationTime', async () => {
      const result = await service.revealCounterpartyKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
      })

      // Should be a valid ISO date string
      const parsed = new Date(result.revelationTime)
      expect(parsed.getTime()).not.toBeNaN()
    })
  })

  // =========================================================================
  // revealSpecificKeyLinkage (BRC-72)
  // =========================================================================
  describe('revealSpecificKeyLinkage (BRC-72)', () => {
    it('produces encrypted specific linkage for a verifier', async () => {
      const result = await service.revealSpecificKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
        protocolID: MOCK_PROTOCOL,
        keyID: 'specific-key-1',
      })

      expect(result.encryptedLinkage).toBeInstanceOf(Array)
      expect(result.encryptedLinkage.length).toBeGreaterThan(0)
      expect(result.prover).toBe(MOCK_IDENTITY_PUB_KEY)
      expect(result.verifier).toBe(MOCK_VERIFIER)
      expect(result.counterparty).toBe(MOCK_COUNTERPARTY)
    })

    it('includes protocolID, keyID, and proofType in the result', async () => {
      const result = await service.revealSpecificKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
        protocolID: MOCK_PROTOCOL,
        keyID: 'specific-key-1',
      })

      expect(result.protocolID).toEqual(MOCK_PROTOCOL)
      expect(result.keyID).toBe('specific-key-1')
      expect(typeof result.proofType).toBe('number')
    })

    it('calls HMAC with correct counterparty and invoice number', async () => {
      await service.revealSpecificKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
        protocolID: [2, 'test-protocol'],
        keyID: 'my-key',
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_COUNTERPARTY,
          invoiceNumber: '2-test-protocol-my-key',
          keyType: 'identity',
        }),
      )
    })

    it('encrypts the linkage for the verifier', async () => {
      await service.revealSpecificKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
        protocolID: MOCK_PROTOCOL,
        keyID: 'specific-key-1',
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          recipientPubKey: MOCK_VERIFIER,
          keyType: 'identity',
        }),
      )
    })

    it('includes encryptedLinkageProof', async () => {
      const result = await service.revealSpecificKeyLinkage({
        counterparty: MOCK_COUNTERPARTY,
        verifier: MOCK_VERIFIER,
        protocolID: MOCK_PROTOCOL,
        keyID: 'specific-key-1',
      })

      expect(result.encryptedLinkageProof).toBeInstanceOf(Array)
      expect(result.encryptedLinkageProof.length).toBeGreaterThan(0)
    })

    it('handles counterparty as self by using identity pubkey', async () => {
      await service.revealSpecificKeyLinkage({
        counterparty: 'self',
        verifier: MOCK_VERIFIER,
        protocolID: MOCK_PROTOCOL,
        keyID: 'specific-key-1',
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_IDENTITY_PUB_KEY,
        }),
      )
    })
  })

  // =========================================================================
  // Error handling
  // =========================================================================
  describe('error handling', () => {
    it('propagates Tauri IPC errors from HMAC', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: () => {
          throw new Error('IPC error')
        },
      })

      await expect(
        service.revealCounterpartyKeyLinkage({
          counterparty: MOCK_COUNTERPARTY,
          verifier: MOCK_VERIFIER,
        }),
      ).rejects.toThrow('IPC error')
    })

    it('propagates Tauri IPC errors from encrypt', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
        encrypt_ecies_from_store: () => {
          throw new Error('Encryption failed')
        },
      })

      await expect(
        service.revealCounterpartyKeyLinkage({
          counterparty: MOCK_COUNTERPARTY,
          verifier: MOCK_VERIFIER,
        }),
      ).rejects.toThrow('Encryption failed')
    })
  })
})
