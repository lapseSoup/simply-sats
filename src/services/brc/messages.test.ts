// @vitest-environment node
/**
 * Tests for MessageService (BRC-77 signed messages, BRC-78 encrypted messages)
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 * The MessageService delegates all crypto to TauriProtoWallet, which in turn
 * delegates to the Tauri Rust backend. We mock at the tauriInvoke level
 * to verify the correct wire format and round-trip behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks
import { TauriProtoWallet } from './adapter'
import { MessageService, MESSAGE_VERSION } from './messages'
import type { WalletProtocol } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const MOCK_IDENTITY_PUB_KEY =
  '02c0f5fa7a67133e3e2b4780b23b44d0e9b6ddad88729a076880e74e6a3c9e2f92'

const MOCK_PUBLIC_KEYS = {
  walletType: 'bip44',
  walletAddress: '1MockWalletAddress',
  walletPubKey: '03aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888cc',
  ordAddress: '1MockOrdAddress',
  ordPubKey: '03bbbb1111cccc2222dddd3333eeee4444ffff5555aaaa6666bbbb7777cccc8888dd',
  identityAddress: '1MockIdentityAddress',
  identityPubKey: MOCK_IDENTITY_PUB_KEY,
}

const MOCK_COUNTERPARTY_PUB_KEY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'

const MOCK_PROTOCOL: WalletProtocol = [2, 'test']

// A deterministic mock DER signature (simplified)
const MOCK_SIG_HEX = '3044022033aabbcc00112233445566778899aabbccddeeff00112233445566778899aabb022011223344556677889900aabbccddeeff00112233445566778899aabbccddeeff00'

// Base64 helpers matching the adapter
function bytesToBase64(bytes: number[]): string {
  const binary = bytes.map((b) => String.fromCharCode(b)).join('')
  return btoa(binary)
}

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
describe('MessageService', () => {
  let wallet: TauriProtoWallet
  let messageService: MessageService

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
    messageService = new MessageService(wallet)
  })

  // =========================================================================
  // createSignedMessage (BRC-77)
  // =========================================================================
  describe('createSignedMessage (BRC-77)', () => {
    it('creates a signed message with version header and signature appended', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
      })

      const data = new Uint8Array([1, 2, 3])
      const signed = await messageService.createSignedMessage({
        data,
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(signed).toBeInstanceOf(Uint8Array)
      // Wire format: [1 byte version][4 byte payload length][payload][signature]
      expect(signed[0]).toBe(MESSAGE_VERSION)
      // Payload length is 3 (big-endian u32)
      const payloadLen = new DataView(signed.buffer, signed.byteOffset + 1, 4).getUint32(0)
      expect(payloadLen).toBe(3)
      // Payload bytes
      expect(signed.slice(5, 5 + 3)).toEqual(new Uint8Array([1, 2, 3]))
      // Remaining bytes are the signature
      expect(signed.length).toBeGreaterThan(5 + 3)
    })

    it('delegates signing to the wallet createSignature method', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
      })

      await messageService.createSignedMessage({
        data: new Uint8Array([10, 20]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      // Should have called sign_data_from_store (identity key for self)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_from_store',
        expect.objectContaining({ keyType: 'identity' }),
      )
    })

    it('supports specific counterparty for signing', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_with_derived_key_from_store: MOCK_SIG_HEX,
      })

      const signed = await messageService.createSignedMessage({
        data: new Uint8Array([5, 6, 7]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
      })

      expect(signed).toBeInstanceOf(Uint8Array)
      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'sign_data_with_derived_key_from_store',
        expect.objectContaining({
          counterpartyPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('handles empty data payload', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
      })

      const signed = await messageService.createSignedMessage({
        data: new Uint8Array([]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      // Version(1) + PayloadLen(4) + Payload(0) + Signature(>0)
      expect(signed.length).toBeGreaterThan(5)
      const payloadLen = new DataView(signed.buffer, signed.byteOffset + 1, 4).getUint32(0)
      expect(payloadLen).toBe(0)
    })
  })

  // =========================================================================
  // verifySignedMessage (BRC-77)
  // =========================================================================
  describe('verifySignedMessage (BRC-77)', () => {
    it('verifies a message signed by this wallet (round-trip)', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
        verify_data_signature: true,
      })

      const original = new Uint8Array([1, 2, 3])
      const signed = await messageService.createSignedMessage({
        data: original,
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      const result = await messageService.verifySignedMessage(signed, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(result.valid).toBe(true)
      expect(result.data).toEqual(original)
    })

    it('extracts the original data from a signed message', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
        verify_data_signature: true,
      })

      const original = new Uint8Array([42, 43, 44, 45])
      const signed = await messageService.createSignedMessage({
        data: original,
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      const result = await messageService.verifySignedMessage(signed, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(result.data).toEqual(original)
    })

    it('returns valid: false when signature verification fails', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
        verify_data_signature: false,
      })

      const signed = await messageService.createSignedMessage({
        data: new Uint8Array([1, 2, 3]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      const result = await messageService.verifySignedMessage(signed, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(result.valid).toBe(false)
      expect(result.data).toEqual(new Uint8Array([1, 2, 3]))
    })

    it('rejects a message with unsupported version', async () => {
      // Manually craft a message with version 99
      const badMessage = new Uint8Array([99, 0, 0, 0, 1, 42, 0x30])

      await expect(
        messageService.verifySignedMessage(badMessage, {
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('Unsupported message version')
    })

    it('rejects a message that is too short to contain a header', async () => {
      const tooShort = new Uint8Array([1, 0, 0])

      await expect(
        messageService.verifySignedMessage(tooShort, {
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('too short')
    })

    it('rejects a message where payload length exceeds available bytes', async () => {
      // Version 1, payload length = 999 but only 2 bytes follow
      const bad = new Uint8Array([1, 0, 0, 3, 231, 42, 43])

      await expect(
        messageService.verifySignedMessage(bad, {
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('truncated')
    })
  })

  // =========================================================================
  // createEncryptedMessage (BRC-78)
  // =========================================================================
  describe('createEncryptedMessage (BRC-78)', () => {
    it('creates an encrypted message with version header', async () => {
      const mockCiphertext = bytesToBase64([99, 100, 101, 102])
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: mockCiphertext,
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      const encrypted = await messageService.createEncryptedMessage({
        data: new Uint8Array([1, 2, 3]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(encrypted).toBeInstanceOf(Uint8Array)
      // Wire format: [1 byte version][encrypted payload bytes]
      expect(encrypted[0]).toBe(MESSAGE_VERSION)
      expect(encrypted.length).toBeGreaterThan(1)
    })

    it('delegates encryption to the wallet encrypt method', async () => {
      const mockCiphertext = bytesToBase64([10, 20, 30])
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: mockCiphertext,
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      await messageService.createEncryptedMessage({
        data: new Uint8Array([1, 2, 3]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'encrypt_ecies_from_store',
        expect.objectContaining({
          recipientPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('handles empty data for encryption', async () => {
      const mockCiphertext = bytesToBase64([50, 51])
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: mockCiphertext,
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
      })

      const encrypted = await messageService.createEncryptedMessage({
        data: new Uint8Array([]),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(encrypted).toBeInstanceOf(Uint8Array)
      expect(encrypted[0]).toBe(MESSAGE_VERSION)
    })
  })

  // =========================================================================
  // decryptMessage (BRC-78)
  // =========================================================================
  describe('decryptMessage (BRC-78)', () => {
    it('decrypts a message encrypted for this wallet (round-trip)', async () => {
      const originalData = [4, 5, 6]
      const encryptedPayload = [99, 100, 101]
      const mockCiphertext = bytesToBase64(encryptedPayload)
      const mockDecryptedBase64 = bytesToBase64(originalData)

      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        encrypt_ecies_from_store: {
          ciphertext: mockCiphertext,
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        },
        decrypt_ecies_from_store: mockDecryptedBase64,
      })

      const encrypted = await messageService.createEncryptedMessage({
        data: new Uint8Array(originalData),
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      const decrypted = await messageService.decryptMessage(encrypted, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(decrypted).toEqual(new Uint8Array(originalData))
    })

    it('delegates decryption to the wallet decrypt method', async () => {
      const mockDecryptedBase64 = bytesToBase64([1, 2, 3])
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        decrypt_ecies_from_store: mockDecryptedBase64,
      })

      // Manually build an encrypted message: version byte + fake ciphertext
      const fakeEncrypted = new Uint8Array([MESSAGE_VERSION, 10, 20, 30])

      await messageService.decryptMessage(fakeEncrypted, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'decrypt_ecies_from_store',
        expect.objectContaining({
          senderPubKey: MOCK_IDENTITY_PUB_KEY,
          keyType: 'identity',
        }),
      )
    })

    it('passes specific counterparty to decrypt', async () => {
      const mockDecryptedBase64 = bytesToBase64([7, 8, 9])
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        decrypt_ecies_from_store: mockDecryptedBase64,
      })

      const fakeEncrypted = new Uint8Array([MESSAGE_VERSION, 50, 60, 70])

      await messageService.decryptMessage(fakeEncrypted, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: MOCK_COUNTERPARTY_PUB_KEY,
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'decrypt_ecies_from_store',
        expect.objectContaining({
          senderPubKey: MOCK_COUNTERPARTY_PUB_KEY,
        }),
      )
    })

    it('rejects a message with unsupported version', async () => {
      const badMessage = new Uint8Array([99, 1, 2, 3])

      await expect(
        messageService.decryptMessage(badMessage, {
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('Unsupported message version')
    })

    it('rejects an empty message', async () => {
      const empty = new Uint8Array([])

      await expect(
        messageService.decryptMessage(empty, {
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('too short')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('propagates wallet errors from createSignedMessage', async () => {
      mockTauriInvoke.mockRejectedValue(new Error('wallet locked'))

      await expect(
        messageService.createSignedMessage({
          data: new Uint8Array([1]),
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('wallet locked')
    })

    it('propagates wallet errors from createEncryptedMessage', async () => {
      mockTauriInvoke.mockRejectedValue(new Error('wallet locked'))

      await expect(
        messageService.createEncryptedMessage({
          data: new Uint8Array([1]),
          protocolID: MOCK_PROTOCOL,
          keyID: '1',
          counterparty: 'self',
        }),
      ).rejects.toThrow('wallet locked')
    })

    it('handles large payloads in signed messages', async () => {
      routeInvoke({
        get_public_keys: MOCK_PUBLIC_KEYS,
        sign_data_from_store: MOCK_SIG_HEX,
        verify_data_signature: true,
      })

      const largeData = new Uint8Array(10_000)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }

      const signed = await messageService.createSignedMessage({
        data: largeData,
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      const result = await messageService.verifySignedMessage(signed, {
        protocolID: MOCK_PROTOCOL,
        keyID: '1',
        counterparty: 'self',
      })

      expect(result.valid).toBe(true)
      expect(result.data).toEqual(largeData)
    })
  })
})
