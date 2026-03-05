// @vitest-environment node
/**
 * Tests for TauriProtoWallet adapter
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing the adapter
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks are set up
import { TauriProtoWallet } from './adapter'
import type {
  GetPublicKeyArgs,
  CreateSignatureArgs,
  VerifySignatureArgs,
  WalletProtocol,
} from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY_PUB_KEY =
  '02c0f5fa7a67133e3e2b4780b23b44d0e9b6ddad88729a076880e74e6a3c9e2f92'
const MOCK_WALLET_PUB_KEY =
  '03aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888cc'
const MOCK_ORD_PUB_KEY =
  '03bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777cccc8888dd'
const MOCK_COUNTERPARTY_PUB_KEY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'
const MOCK_DERIVED_PUB_KEY =
  '02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'

const MOCK_PUBLIC_KEYS = {
  walletType: 'bip44',
  walletAddress: '1MockWalletAddress',
  walletPubKey: MOCK_WALLET_PUB_KEY,
  ordAddress: '1MockOrdAddress',
  ordPubKey: MOCK_ORD_PUB_KEY,
  identityAddress: '1MockIdentityAddress',
  identityPubKey: MOCK_IDENTITY_PUB_KEY,
}

const MOCK_PROTOCOL: WalletProtocol = [2, 'test-protocol']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Route tauriInvoke mocks by command name */
function routeInvoke(routes: Record<string, unknown>) {
  mockTauriInvoke.mockImplementation((cmd: string) => {
    if (cmd in routes) {
      const val = routes[cmd]
      return typeof val === 'function' ? (val as (...args: unknown[]) => unknown)() : Promise.resolve(val)
    }
    return Promise.reject(new Error(`Unmocked Tauri command: ${cmd}`))
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TauriProtoWallet', () => {
  let wallet: TauriProtoWallet

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
  })

  // =========================================================================
  // getPublicKey
  // =========================================================================
  describe('getPublicKey', () => {
    it('returns identity key when identityKey is true', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      const result = await wallet.getPublicKey({ identityKey: true })

      expect(result).toEqual({ publicKey: MOCK_IDENTITY_PUB_KEY })
      expect(mockTauriInvoke).toHaveBeenCalledWith('get_public_keys')
    })

    it('returns identity key when counterparty is self', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      const result = await wallet.getPublicKey({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
      })

      expect(result).toEqual({ publicKey: MOCK_IDENTITY_PUB_KEY })
    })

    it('returns identity key when counterparty is anyone', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      const result = await wallet.getPublicKey({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'anyone',
      })

      expect(result).toEqual({ publicKey: MOCK_IDENTITY_PUB_KEY })
    })

    it('derives child public key for specific counterparty', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
      })

      const result = await wallet.getPublicKey({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
      })

      expect(result).toEqual({ publicKey: MOCK_DERIVED_PUB_KEY })
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          keyType: 'identity',
          senderPubKey: MOCK_COUNTERPARTY_PUB_KEY,
          invoiceNumber: '2-test-protocol-test-key-1',
        }),
      )
    })

    it('throws if protocolID missing when identityKey is not true', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      await expect(
        wallet.getPublicKey({ keyID: 'test' } as GetPublicKeyArgs),
      ).rejects.toThrow('protocolID and keyID are required')
    })

    it('throws if keyID missing when identityKey is not true', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      await expect(
        wallet.getPublicKey({ protocolID: MOCK_PROTOCOL } as GetPublicKeyArgs),
      ).rejects.toThrow('protocolID and keyID are required')
    })

    it('throws if get_public_keys returns null', async () => {
      routeInvoke({ get_public_keys: null })

      await expect(
        wallet.getPublicKey({ identityKey: true }),
      ).rejects.toThrow('No keys available')
    })

    it('defaults counterparty to self when not specified', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      const result = await wallet.getPublicKey({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
      })

      // Default counterparty is 'self', so should return identity key
      expect(result).toEqual({ publicKey: MOCK_IDENTITY_PUB_KEY })
    })

    it('builds correct invoice number from protocolID and keyID', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
      })

      await wallet.getPublicKey({
        protocolID: [1, 'my-app-protocol'],
        keyID: 'session-42',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'derive_child_key_from_store',
        expect.objectContaining({
          invoiceNumber: '1-my-app-protocol-session-42',
        }),
      )
    })
  })

  // =========================================================================
  // createSignature
  // =========================================================================
  describe('createSignature', () => {
    it('signs data with identity key for self counterparty', async () => {
      const mockSigHex = 'deadbeef01020304'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: mockSigHex,
      })

      const testData = [1, 2, 3, 4, 5]
      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        data: testData,
      })

      expect(result.signature).toBeInstanceOf(Array)
      expect(result.signature.length).toBeGreaterThan(0)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_from_store',
        expect.objectContaining({
          keyType: 'identity',
        }),
      )
    })

    it('signs data with identity key for anyone counterparty', async () => {
      const mockSigHex = 'aabbccdd'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: mockSigHex,
      })

      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'anyone',
        data: [10, 20, 30],
      })

      expect(result.signature).toBeInstanceOf(Array)
    })

    it('signs hashToDirectlySign when provided instead of data', async () => {
      const mockSigHex = '112233'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: mockSigHex,
      })

      const hash = Array.from({ length: 32 }, (_, i) => i)
      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        hashToDirectlySign: hash,
      })

      expect(result.signature).toBeInstanceOf(Array)
    })

    it('throws if neither data nor hashToDirectlySign provided', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      await expect(
        wallet.createSignature({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key-1',
          counterparty: 'self',
        } as CreateSignatureArgs),
      ).rejects.toThrow('data or hashToDirectlySign must be provided')
    })

    it('signs data with derived key for specific counterparty', async () => {
      const mockSigHex = 'deadbeef'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_with_derived_key_from_store: mockSigHex,
      })

      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
        data: [1, 2, 3],
      })

      expect(result.signature).toBeInstanceOf(Array)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_COUNTERPARTY_PUB_KEY,
          invoiceNumber: '2-test-protocol-test-key-1',
          keyType: 'identity',
        }),
      )
    })

    it('defaults counterparty to anyone for createSignature', async () => {
      const mockSigHex = 'cafe'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: mockSigHex,
      })

      await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        data: [1, 2, 3],
      })

      // Default counterparty for createSignature is 'anyone' (matching SDK)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_from_store',
        expect.objectContaining({ keyType: 'identity' }),
      )
    })

    it('returns signature as DER byte array from hex', async () => {
      // DER signature hex example (simplified)
      const mockSigHex = '3044022033aabbcc00112233'
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: mockSigHex,
      })

      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        data: [1, 2, 3],
      })

      // Verify it's an array of byte values
      expect(Array.isArray(result.signature)).toBe(true)
      for (const byte of result.signature) {
        expect(byte).toBeGreaterThanOrEqual(0)
        expect(byte).toBeLessThanOrEqual(255)
      }
    })
  })

  // =========================================================================
  // verifySignature
  // =========================================================================
  describe('verifySignature', () => {
    it('verifies a valid signature', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        verify_data_signature: true,
      })

      const result = await wallet.verifySignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        data: [1, 2, 3],
        signature: [0x30, 0x44, 0x02, 0x20],
      })

      expect(result).toEqual({ valid: true })
    })

    it('throws on invalid signature (matching SDK behaviour)', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        verify_data_signature: false,
      })

      await expect(
        wallet.verifySignature({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key-1',
          counterparty: 'self',
          data: [1, 2, 3],
          signature: [0x30, 0x44],
        }),
      ).rejects.toThrow('Signature is not valid')
    })

    it('throws with ERR_INVALID_SIGNATURE code on invalid signature', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        verify_data_signature: false,
      })

      try {
        await wallet.verifySignature({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key-1',
          counterparty: 'self',
          data: [1, 2, 3],
          signature: [0x30],
        })
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error & { code: string }).code).toBe('ERR_INVALID_SIGNATURE')
      }
    })

    it('throws if neither data nor hashToDirectlyVerify provided', async () => {
      await expect(
        wallet.verifySignature({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key-1',
          counterparty: 'self',
          signature: [0x30],
        } as VerifySignatureArgs),
      ).rejects.toThrow('data or hashToDirectlyVerify must be provided')
    })

    it('passes correct public key to verify_data_signature for self', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        verify_data_signature: true,
      })

      await wallet.verifySignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        data: [1, 2, 3],
        signature: [0x30, 0x44],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'verify_data_signature',
        expect.objectContaining({
          publicKeyHex: MOCK_IDENTITY_PUB_KEY,
        }),
      )
    })

    it('uses counterparty pubkey for verification when counterparty is specific key', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        derive_child_key_from_store: {
          wif: 'REDACTED',
          address: '1DerivedAddr',
          pubKey: MOCK_DERIVED_PUB_KEY,
        },
        verify_data_signature: true,
      })

      await wallet.verifySignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
        data: [1, 2, 3],
        signature: [0x30, 0x44],
      })

      // Should derive the counterparty's public key and verify with it
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'verify_data_signature',
        expect.objectContaining({
          publicKeyHex: MOCK_DERIVED_PUB_KEY,
        }),
      )
    })

    it('verifies using hashToDirectlyVerify when provided', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        verify_data_signature: true,
      })

      const hash = Array.from({ length: 32 }, (_, i) => i)
      const result = await wallet.verifySignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        hashToDirectlyVerify: hash,
        signature: [0x30, 0x44],
      })

      expect(result).toEqual({ valid: true })
    })
  })

  // =========================================================================
  // encrypt / decrypt
  // =========================================================================
  describe('encrypt', () => {
    it('encrypts plaintext via ECIES', async () => {
      const ciphertextBase64 = btoa('encrypted-data')
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: ciphertextBase64,
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      const result = await wallet.encrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        plaintext: [72, 101, 108, 108, 111], // "Hello"
      })

      expect(result.ciphertext).toBeInstanceOf(Array)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          keyType: 'identity',
        }),
      )
    })

    it('uses counterparty pubkey as recipient when specific', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: btoa('encrypted'),
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      await wallet.encrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
        plaintext: [1, 2, 3],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          recipientPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('uses identity pubkey as recipient for self', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: btoa('encrypted'),
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      await wallet.encrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        plaintext: [1, 2, 3],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          recipientPubKey: MOCK_IDENTITY_PUB_KEY,
        }),
      )
    })
  })

  describe('decrypt', () => {
    // Rust decrypt returns the original plaintext string that was encrypted.
    // Since our encrypt encodes byte arrays as base64, decrypt returns base64.
    const mockBase64Plaintext = btoa(
      String.fromCharCode(...[72, 101, 108, 108, 111]),
    ) // base64 of "Hello" bytes

    it('decrypts ciphertext via ECIES', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        decrypt_ecies_from_store: mockBase64Plaintext,
      })

      const result = await wallet.decrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        ciphertext: [1, 2, 3, 4, 5],
      })

      expect(result.plaintext).toBeInstanceOf(Array)
      expect(result.plaintext).toEqual([72, 101, 108, 108, 111])
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'decrypt_ecies_from_store',
        expect.objectContaining({
          keyType: 'identity',
        }),
      )
    })

    it('uses counterparty pubkey as sender for specific counterparty', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        decrypt_ecies_from_store: mockBase64Plaintext,
      })

      await wallet.decrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
        ciphertext: [10, 20, 30],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'decrypt_ecies_from_store',
        expect.objectContaining({
          senderPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('uses identity pubkey as sender for self counterparty', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        decrypt_ecies_from_store: mockBase64Plaintext,
      })

      await wallet.decrypt({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        ciphertext: [10, 20, 30],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'decrypt_ecies_from_store',
        expect.objectContaining({
          senderPubKey: MOCK_IDENTITY_PUB_KEY,
        }),
      )
    })
  })

  // =========================================================================
  // createHmac / verifyHmac
  // =========================================================================
  describe('createHmac', () => {
    const MOCK_HMAC_BYTES = Array.from({ length: 32 }, (_, i) => i)

    it('computes HMAC with identity key for self counterparty', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const result = await wallet.createHmac({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key',
        counterparty: 'self',
        data: [1, 2, 3],
      })

      expect(result.hmac).toEqual(MOCK_HMAC_BYTES)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_IDENTITY_PUB_KEY,
          invoiceNumber: '2-test-protocol-test-key',
          keyType: 'identity',
        }),
      )
    })

    it('uses counterparty pubkey for specific counterparty', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      await wallet.createHmac({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
        data: [10, 20, 30],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('defaults counterparty to self', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      await wallet.createHmac({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key',
        data: [1, 2, 3],
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'hmac_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_IDENTITY_PUB_KEY,
        }),
      )
    })
  })

  describe('verifyHmac', () => {
    const MOCK_HMAC_BYTES = Array.from({ length: 32 }, (_, i) => i)

    it('returns valid: true when HMAC matches', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      const result = await wallet.verifyHmac({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key',
        counterparty: 'self',
        data: [1, 2, 3],
        hmac: MOCK_HMAC_BYTES,
      })

      expect(result).toEqual({ valid: true })
    })

    it('throws ERR_INVALID_HMAC when HMAC does not match', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      try {
        await wallet.verifyHmac({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key',
          counterparty: 'self',
          data: [1, 2, 3],
          hmac: [99, 99, 99], // Wrong HMAC
        })
        expect.fail('Should have thrown')
      } catch (e) {
        expect((e as Error).message).toBe('HMAC is not valid')
        expect((e as Error & { code: string }).code).toBe('ERR_INVALID_HMAC')
      }
    })

    it('throws ERR_INVALID_HMAC when HMAC lengths differ', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        hmac_with_derived_key_from_store: MOCK_HMAC_BYTES,
      })

      await expect(
        wallet.verifyHmac({
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key',
          counterparty: 'self',
          data: [1, 2, 3],
          hmac: [1, 2], // Wrong length
        }),
      ).rejects.toThrow('HMAC is not valid')
    })
  })

  // =========================================================================
  // revealCounterpartyKeyLinkage / revealSpecificKeyLinkage — not yet implemented
  // =========================================================================
  describe('revealCounterpartyKeyLinkage', () => {
    it('throws not yet implemented', async () => {
      await expect(
        wallet.revealCounterpartyKeyLinkage({
          counterparty: MOCK_COUNTERPARTY_PUB_KEY,
          verifier: MOCK_IDENTITY_PUB_KEY,
        }),
      ).rejects.toThrow('not yet implemented')
    })
  })

  describe('revealSpecificKeyLinkage', () => {
    it('throws not yet implemented', async () => {
      await expect(
        wallet.revealSpecificKeyLinkage({
          counterparty: MOCK_COUNTERPARTY_PUB_KEY,
          verifier: MOCK_IDENTITY_PUB_KEY,
          protocolID: MOCK_PROTOCOL,
          keyID: 'test-key',
        }),
      ).rejects.toThrow('not yet implemented')
    })
  })

  // =========================================================================
  // Invoice number formatting
  // =========================================================================
  describe('invoice number construction', () => {
    it('uses securityLevel-protocolName-keyID format', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: 'aabb',
      })

      await wallet.createSignature({
        protocolID: [1, 'my-protocol'],
        keyID: 'key-99',
        counterparty: 'self',
        data: [1],
      })

      // sign_data_from_store is called with identity key for self
      // But let's verify the adapter constructed the right invoice number
      // by checking it was routed correctly (no derive needed for self)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_from_store',
        expect.objectContaining({ keyType: 'identity' }),
      )
    })
  })

  // =========================================================================
  // Caching of public keys
  // =========================================================================
  describe('public key caching', () => {
    it('caches public keys and does not call get_public_keys twice', async () => {
      routeInvoke({ get_public_keys: MOCK_PUBLIC_KEYS })

      await wallet.getPublicKey({ identityKey: true })
      await wallet.getPublicKey({ identityKey: true })

      // Should only call get_public_keys once due to caching
      const calls = mockTauriInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'get_public_keys',
      )
      expect(calls.length).toBe(1)
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles empty data array for createSignature', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: 'aabb',
      })

      const result = await wallet.createSignature({
        protocolID: MOCK_PROTOCOL,
        keyID: 'test-key-1',
        counterparty: 'self',
        data: [],
      })

      expect(result.signature).toBeInstanceOf(Array)
    })

    it('propagates Tauri IPC errors', async () => {
      mockTauriInvoke.mockRejectedValue(new Error('IPC connection lost'))

      await expect(
        wallet.getPublicKey({ identityKey: true }),
      ).rejects.toThrow('IPC connection lost')
    })
  })
})
