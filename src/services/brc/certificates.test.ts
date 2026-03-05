// @vitest-environment node
/**
 * Tests for CertificateService (BRC-52)
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 * WoC client is also mocked for revocation checks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Result } from '../../domain/types'
import type { ApiError, WocClient } from '../../infrastructure/api/wocClient'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Mock getWocClient so the service doesn't use the real one
vi.mock('../../infrastructure/api/wocClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../infrastructure/api/wocClient')>()
  return {
    ...actual,
    getWocClient: vi.fn(() => mockWocClient),
  }
})

// Import after mocks
import { TauriProtoWallet } from './adapter'
import { CertificateService } from './certificates'

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

const MOCK_VERIFIER_PUB_KEY =
  '03deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefde'

// ---------------------------------------------------------------------------
// Mock WoC client
// ---------------------------------------------------------------------------
const mockIsOutputSpentSafe = vi.fn<
  (txid: string, vout: number) => Promise<Result<string | null, ApiError>>
>()

const mockWocClient = {
  isOutputSpentSafe: mockIsOutputSpentSafe,
} as unknown as WocClient

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a base64 string to bytes and back — helper to verify encode/decode.
 */
function base64ToBytes(b64: string): number[] {
  const binary = atob(b64)
  return Array.from(binary, (c) => c.charCodeAt(0))
}

function bytesToBase64(bytes: number[]): string {
  const binary = bytes.map((b) => String.fromCharCode(b)).join('')
  return btoa(binary)
}

/**
 * Set up Tauri IPC mocks for encrypt/decrypt/sign operations.
 *
 * The TauriProtoWallet delegates crypto to the Tauri backend. For tests we
 * need to simulate the encrypt → decrypt round-trip so the SDK's
 * MasterCertificate field encryption works end-to-end.
 *
 * Strategy: encrypt stores the plaintext base64 + a tag; decrypt recovers it.
 */
function setupCryptoMocks() {
  // Track encrypted values so decrypt can recover them
  const encryptedStore = new Map<string, string>()
  let encryptCounter = 0

  mockTauriInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'get_public_keys':
        return Promise.resolve(MOCK_PUBLIC_KEYS)

      case 'sign_data_from_store': {
        // Return a valid-looking DER signature hex
        // This needs to be a valid DER-encoded signature for Certificate.verify() to work,
        // but since we're testing the service layer (not signature verification), a
        // deterministic hex is fine.
        return Promise.resolve(
          '3044022020bde81e0c08eb2b2e5240f108ef4e5e77c42fb2a8a9a19a76715b05b5dd8d5e02202c2c3a987ef6a' +
          '83ccf92a0eb30e0b5693e1b51b4f6a6309e22de99487a43a0c',
        )
      }

      case 'encrypt_ecies_from_store': {
        // Simulate ECIES: store the plaintext, return a tag
        const plaintext = args?.plaintext as string
        const tag = `enc_${encryptCounter++}`
        encryptedStore.set(tag, plaintext)
        return Promise.resolve({
          ciphertext: bytesToBase64(Array.from(tag, (c) => c.charCodeAt(0))),
          senderPublicKey: MOCK_IDENTITY_PUB_KEY,
        })
      }

      case 'decrypt_ecies_from_store': {
        // Recover the original plaintext from our tag
        const ciphertextBytes = args?.ciphertextBytes as Uint8Array
        const tag = Array.from(ciphertextBytes, (b) => String.fromCharCode(b)).join('')
        const plaintext = encryptedStore.get(tag)
        if (plaintext === undefined) {
          return Promise.reject(new Error(`Cannot decrypt: unknown tag "${tag}"`))
        }
        return Promise.resolve(plaintext)
      }

      default:
        return Promise.reject(new Error(`Unmocked Tauri command: ${cmd}`))
    }
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CertificateService', () => {
  let wallet: TauriProtoWallet
  let service: CertificateService

  beforeEach(() => {
    vi.clearAllMocks()
    wallet = new TauriProtoWallet()
    service = new CertificateService(wallet, mockWocClient)
  })

  // =========================================================================
  // createSelfSignedCert
  // =========================================================================
  describe('createSelfSignedCert', () => {
    it('creates a valid certificate with all required fields', async () => {
      setupCryptoMocks()

      const result = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice', email: 'alice@example.com' },
      })

      const cert = result.certificate
      expect(cert.type).toBeTruthy()
      expect(cert.serialNumber).toBeTruthy()
      expect(cert.subject).toBe(MOCK_IDENTITY_PUB_KEY)
      expect(cert.certifier).toBe(MOCK_IDENTITY_PUB_KEY) // self-signed
      expect(cert.revocationOutpoint).toContain('.')
      expect(cert.signature).toBeTruthy()

      // Encrypted fields should exist for both 'name' and 'email'
      expect(Object.keys(cert.fields)).toHaveLength(2)
      expect(cert.fields).toHaveProperty('name')
      expect(cert.fields).toHaveProperty('email')

      // Master keyring should have keys for both fields
      expect(Object.keys(cert.masterKeyring)).toHaveLength(2)
      expect(cert.masterKeyring).toHaveProperty('name')
      expect(cert.masterKeyring).toHaveProperty('email')
    })

    it('generates unique serial numbers', async () => {
      setupCryptoMocks()

      const result1 = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice' },
      })
      const result2 = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Bob' },
      })

      expect(result1.certificate.serialNumber).not.toBe(
        result2.certificate.serialNumber,
      )
    })

    it('encodes type as base64 from UTF-8 bytes padded to 32 bytes', async () => {
      setupCryptoMocks()

      const result = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Test' },
      })

      // Decode the type and verify it starts with 'identity' bytes
      const typeBytes = base64ToBytes(result.certificate.type)
      expect(typeBytes).toHaveLength(32)

      // First bytes should spell 'identity'
      const typeStr = String.fromCharCode(...typeBytes.slice(0, 8))
      expect(typeStr).toBe('identity')

      // Remaining bytes should be zero-padded
      for (let i = 8; i < 32; i++) {
        expect(typeBytes[i]).toBe(0)
      }
    })

    it('stores the certificate in the in-memory store', async () => {
      setupCryptoMocks()

      await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice' },
      })

      const certs = await service.listCertificates()
      expect(certs).toHaveLength(1)
    })
  })

  // =========================================================================
  // listCertificates
  // =========================================================================
  describe('listCertificates', () => {
    it('returns all certificates when no filter is provided', async () => {
      setupCryptoMocks()

      await service.createSelfSignedCert({ type: 'identity', fields: { name: 'Alice' } })
      await service.createSelfSignedCert({ type: 'credential', fields: { org: 'ACME' } })

      const all = await service.listCertificates()
      expect(all).toHaveLength(2)
    })

    it('filters by type', async () => {
      setupCryptoMocks()

      await service.createSelfSignedCert({ type: 'identity', fields: { name: 'Alice' } })
      await service.createSelfSignedCert({ type: 'credential', fields: { org: 'ACME' } })

      const filtered = await service.listCertificates({ type: 'identity' })
      expect(filtered).toHaveLength(1)

      // Verify it's the identity cert by checking it has a 'name' field
      expect(filtered[0].fields).toHaveProperty('name')
    })

    it('filters by certifier', async () => {
      setupCryptoMocks()

      await service.createSelfSignedCert({ type: 'identity', fields: { name: 'Alice' } })

      // Filter with the wallet's own identity key (self-signed certs)
      const match = await service.listCertificates({ certifier: MOCK_IDENTITY_PUB_KEY })
      expect(match).toHaveLength(1)

      // Filter with a different key
      const noMatch = await service.listCertificates({ certifier: MOCK_VERIFIER_PUB_KEY })
      expect(noMatch).toHaveLength(0)
    })

    it('returns empty array when store is empty', async () => {
      const certs = await service.listCertificates()
      expect(certs).toHaveLength(0)
    })
  })

  // =========================================================================
  // proveCertificate
  // =========================================================================
  describe('proveCertificate', () => {
    it('creates a keyring with only the requested fields', async () => {
      setupCryptoMocks()

      const { certificate } = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice', email: 'alice@example.com', phone: '555-1234' },
      })

      const proof = await service.proveCertificate({
        certificate,
        verifierPublicKey: MOCK_VERIFIER_PUB_KEY,
        fieldsToReveal: ['name', 'email'],
      })

      // Keyring should only contain the two requested fields
      expect(Object.keys(proof.keyring)).toHaveLength(2)
      expect(proof.keyring).toHaveProperty('name')
      expect(proof.keyring).toHaveProperty('email')
      expect(proof.keyring).not.toHaveProperty('phone')
    })

    it('creates a keyring for a single field', async () => {
      setupCryptoMocks()

      const { certificate } = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice', email: 'alice@example.com' },
      })

      const proof = await service.proveCertificate({
        certificate,
        verifierPublicKey: MOCK_VERIFIER_PUB_KEY,
        fieldsToReveal: ['email'],
      })

      expect(Object.keys(proof.keyring)).toHaveLength(1)
      expect(proof.keyring).toHaveProperty('email')
    })

    it('throws when revealing a field that does not exist', async () => {
      setupCryptoMocks()

      const { certificate } = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice' },
      })

      await expect(
        service.proveCertificate({
          certificate,
          verifierPublicKey: MOCK_VERIFIER_PUB_KEY,
          fieldsToReveal: ['nonexistent'],
        }),
      ).rejects.toThrow()
    })
  })

  // =========================================================================
  // relinquishCertificate
  // =========================================================================
  describe('relinquishCertificate', () => {
    it('removes certificate from storage', async () => {
      setupCryptoMocks()

      const { certificate } = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice' },
      })

      expect(await service.listCertificates()).toHaveLength(1)

      await service.relinquishCertificate(certificate.serialNumber)

      expect(await service.listCertificates()).toHaveLength(0)
    })

    it('is a no-op for unknown serial numbers', async () => {
      // Should not throw
      await service.relinquishCertificate('nonexistent-serial')
      expect(await service.listCertificates()).toHaveLength(0)
    })
  })

  // =========================================================================
  // checkRevocation
  // =========================================================================
  describe('checkRevocation', () => {
    const REAL_TXID = 'a'.repeat(64)
    const REAL_OUTPOINT = `${REAL_TXID}.0`

    it('returns false for unspent outpoint (not revoked)', async () => {
      mockIsOutputSpentSafe.mockResolvedValue({ ok: true, value: null })

      const revoked = await service.checkRevocation(REAL_OUTPOINT)
      expect(revoked).toBe(false)
      expect(mockIsOutputSpentSafe).toHaveBeenCalledWith(REAL_TXID, 0)
    })

    it('returns true for spent outpoint (revoked)', async () => {
      mockIsOutputSpentSafe.mockResolvedValue({
        ok: true,
        value: 'b'.repeat(64), // spending txid
      })

      const revoked = await service.checkRevocation(REAL_OUTPOINT)
      expect(revoked).toBe(true)
    })

    it('returns false for placeholder outpoint (all zeros)', async () => {
      const placeholder = `${'00'.repeat(32)}.0`
      const revoked = await service.checkRevocation(placeholder)
      expect(revoked).toBe(false)

      // Should not even call the API
      expect(mockIsOutputSpentSafe).not.toHaveBeenCalled()
    })

    it('returns false on API error (safe default)', async () => {
      mockIsOutputSpentSafe.mockResolvedValue({
        ok: false,
        error: { code: 'FETCH_ERROR', message: 'Network timeout' },
      })

      const revoked = await service.checkRevocation(REAL_OUTPOINT)
      expect(revoked).toBe(false)
    })

    it('parses outpoint vout correctly', async () => {
      mockIsOutputSpentSafe.mockResolvedValue({ ok: true, value: null })

      await service.checkRevocation(`${REAL_TXID}.42`)
      expect(mockIsOutputSpentSafe).toHaveBeenCalledWith(REAL_TXID, 42)
    })
  })

  // =========================================================================
  // verifyCertificate
  // =========================================================================
  describe('verifyCertificate', () => {
    it('rejects invalid certificates (mock keys are not real EC points)', async () => {
      setupCryptoMocks()

      const { certificate } = await service.createSelfSignedCert({
        type: 'identity',
        fields: { name: 'Alice' },
      })

      // Certificate.verify() internally creates a ProtoWallet('anyone') and
      // parses the certifier pubkey as an EC point. Our mock keys are not on
      // the secp256k1 curve, so verify() throws "Invalid point".
      // This validates that verifyCertificate correctly delegates to the SDK.
      await expect(service.verifyCertificate(certificate)).rejects.toThrow(
        'Invalid point',
      )
    })
  })

  // =========================================================================
  // Integration-style: create → prove round-trip
  // =========================================================================
  describe('create → prove round-trip', () => {
    it('can create a cert and then produce a selective disclosure proof', async () => {
      setupCryptoMocks()

      // Create
      const { certificate } = await service.createSelfSignedCert({
        type: 'employee-badge',
        fields: {
          name: 'Alice',
          department: 'Engineering',
          clearanceLevel: 'Top Secret',
        },
      })

      // List and verify it exists
      const certs = await service.listCertificates()
      expect(certs).toHaveLength(1)

      // Prove — reveal only name and department
      const proof = await service.proveCertificate({
        certificate,
        verifierPublicKey: MOCK_VERIFIER_PUB_KEY,
        fieldsToReveal: ['name', 'department'],
      })

      // Keyring should have exactly the two revealed fields
      const revealedFields = Object.keys(proof.keyring)
      expect(revealedFields).toHaveLength(2)
      expect(revealedFields).toContain('name')
      expect(revealedFields).toContain('department')
      expect(revealedFields).not.toContain('clearanceLevel')

      // Each keyring entry should be a non-empty base64 string
      for (const value of Object.values(proof.keyring)) {
        expect(value).toBeTruthy()
        expect(typeof value).toBe('string')
      }
    })
  })
})
