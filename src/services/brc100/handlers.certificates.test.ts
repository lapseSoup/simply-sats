// @vitest-environment node
/**
 * Tests for BRC-100 Certificate Handlers
 *
 * Covers the certificate-related BRC-100 request handlers:
 * - acquireCertificate: validates required params, delegates to CertificateService
 * - proveCertificate: validates required params + public key, delegates to CertificateService
 * - listCertificates: works with and without filter params
 * - relinquishCertificate: validates required serialNumber param
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletKeys } from '../wallet/types'
import type { BRC100Request } from './types'

// ---------------------------------------------------------------------------
// Mocks — prevent real service calls
// ---------------------------------------------------------------------------

const mockCreateSelfSignedCert = vi.fn()
const mockProveCertificate = vi.fn()
const mockListCertificates = vi.fn()
const mockRelinquishCertificate = vi.fn()

vi.mock('../brc/certificates', () => {
  return {
    CertificateService: class MockCertificateService {
      createSelfSignedCert = mockCreateSelfSignedCert
      proveCertificate = mockProveCertificate
      listCertificates = mockListCertificates
      relinquishCertificate = mockRelinquishCertificate
    },
  }
})

vi.mock('../brc/adapter', () => {
  return {
    TauriProtoWallet: class MockTauriProtoWallet {},
  }
})

vi.mock('@bsv/sdk', () => ({
  PrivateKey: { fromWif: vi.fn(() => ({ toPublicKey: () => ({ toString: () => '02' + 'a'.repeat(64), toAddress: () => '1Addr' }) })) },
  PublicKey: { fromString: vi.fn(() => ({})) },
}))

vi.mock('./signing', () => ({
  signData: vi.fn(async () => 'aabbccdd'),
  verifyDataSignature: vi.fn(async () => true),
}))

vi.mock('./cryptography', () => ({
  encryptECIES: vi.fn(async () => ({ ciphertext: [1, 2, 3], senderPublicKey: '02' + 'a'.repeat(64) })),
  decryptECIES: vi.fn(async () => 'decrypted'),
}))

vi.mock('./locks', () => ({
  createLockTransaction: vi.fn(async () => ({ ok: true, value: { txid: 'abc', unlockBlock: 100 } })),
}))

vi.mock('./formatting', () => ({
  buildAndBroadcastAction: vi.fn(async () => ({ ok: true, value: { txid: 'abc' } })),
}))

vi.mock('./outputs', () => ({
  resolvePublicKey: vi.fn(() => '02' + 'a'.repeat(64)),
  resolveListOutputs: vi.fn(async () => []),
  discoverByIdentityKey: vi.fn(async () => []),
  discoverByAttributes: vi.fn(async () => []),
}))

vi.mock('./utils', () => ({
  getBlockHeight: vi.fn(async () => 800000),
}))

vi.mock('../accounts', () => ({
  getActiveAccount: vi.fn(async () => ({ id: 1 })),
}))

vi.mock('./RequestManager', () => ({
  getRequestManager: vi.fn(() => ({
    get: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(() => []),
  })),
}))

vi.mock('../wallet', () => ({
  lockBSV: vi.fn(async () => ({ ok: true, value: { txid: 'abc', lockedUtxo: {} } })),
  unlockBSV: vi.fn(async () => ({ ok: true, value: 'txid123' })),
}))

vi.mock('../sync', () => ({
  BASKETS: { wrootz_locks: 'wrootz_locks' },
  getCurrentBlockHeight: vi.fn(async () => 800000),
}))

vi.mock('../logger', () => ({
  walletLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  brc100Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../database', () => ({
  getSpendableUTXOs: vi.fn(async () => ({ ok: true, value: [{ txid: 'abc', vout: 0, satoshis: 100000, lockingScript: '76a914...88ac' }] })),
  getLocks: vi.fn(async () => []),
  markLockUnlocked: vi.fn(async () => {}),
}))

vi.mock('../keyDerivation', () => ({
  deriveTaggedKey: vi.fn(() => ({
    publicKey: '02' + 'a'.repeat(64),
    address: '1TestAddress',
    derivationPath: "m/44'/0'/0'/0/0",
  })),
}))

vi.mock('../../domain/types', () => ({
  toWalletUtxo: vi.fn((u: Record<string, unknown>) => u),
}))

// ---------------------------------------------------------------------------
// Import the function under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { executeApprovedRequest } from './handlers'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'test-wif',
  ordWif: 'test-ord-wif',
  identityWif: 'test-identity-wif',
  walletAddress: '1TestWalletAddress',
  ordAddress: '1TestOrdAddress',
  identityAddress: '1TestIdentityAddress',
  walletPubKey: '02' + 'a'.repeat(64),
  ordPubKey: '02' + 'b'.repeat(64),
  identityPubKey: '02' + 'c'.repeat(64),
}

function makeRequest(type: BRC100Request['type'], params: Record<string, unknown> = {}): BRC100Request {
  return { id: 'test-cert-request-1', type, params }
}

const mockCertificateInfo = {
  type: 'dGVzdC1jZXJ0',
  serialNumber: 'c2VyaWFsLTEyMw==',
  subject: '02' + 'c'.repeat(64),
  certifier: '02' + 'c'.repeat(64),
  revocationOutpoint: '00'.repeat(32) + '.0',
  fields: { name: 'ZW5jcnlwdGVkLW5hbWU=' },
  masterKeyring: { name: 'ZW5jcnlwdGVkLWtleQ==' },
  signature: 'test-signature',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('acquireCertificate handler', () => {
  it('rejects request missing type param', async () => {
    const request = makeRequest('acquireCertificate', {
      certifier: '02' + 'a'.repeat(64),
      fields: { name: 'Alice' },
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required params: type, certifier')
  })

  it('rejects request missing certifier param', async () => {
    const request = makeRequest('acquireCertificate', {
      type: 'identity',
      fields: { name: 'Alice' },
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required params: type, certifier')
  })

  it('delegates to CertificateService.createSelfSignedCert on valid params', async () => {
    mockCreateSelfSignedCert.mockResolvedValue({ certificate: mockCertificateInfo })

    const request = makeRequest('acquireCertificate', {
      type: 'identity',
      certifier: '02' + 'a'.repeat(64),
      fields: { name: 'Alice' },
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ certificate: mockCertificateInfo })
    expect(mockCreateSelfSignedCert).toHaveBeenCalledWith({
      type: 'identity',
      fields: { name: 'Alice' },
    })
  })

  it('defaults fields to empty object when not provided', async () => {
    mockCreateSelfSignedCert.mockResolvedValue({ certificate: mockCertificateInfo })

    const request = makeRequest('acquireCertificate', {
      type: 'identity',
      certifier: '02' + 'a'.repeat(64),
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(mockCreateSelfSignedCert).toHaveBeenCalledWith({
      type: 'identity',
      fields: {},
    })
  })

  it('returns error when CertificateService throws', async () => {
    mockCreateSelfSignedCert.mockRejectedValue(new Error('Wallet not unlocked'))

    const request = makeRequest('acquireCertificate', {
      type: 'identity',
      certifier: '02' + 'a'.repeat(64),
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32000)
    expect(response.error!.message).toBe('Wallet not unlocked')
  })
})

describe('proveCertificate handler', () => {
  it('rejects request missing certificate param', async () => {
    const request = makeRequest('proveCertificate', {
      verifierPublicKey: '02' + 'a'.repeat(64),
      fieldsToReveal: ['name'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required params')
  })

  it('rejects request missing verifierPublicKey param', async () => {
    const request = makeRequest('proveCertificate', {
      certificate: mockCertificateInfo,
      fieldsToReveal: ['name'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required params')
  })

  it('rejects request missing fieldsToReveal param', async () => {
    const request = makeRequest('proveCertificate', {
      certificate: mockCertificateInfo,
      verifierPublicKey: '02' + 'a'.repeat(64),
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required params')
  })

  it('rejects invalid verifier public key', async () => {
    const request = makeRequest('proveCertificate', {
      certificate: mockCertificateInfo,
      verifierPublicKey: 'not-a-valid-pubkey',
      fieldsToReveal: ['name'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid verifier public key format')
  })

  it('delegates to CertificateService.proveCertificate on valid params', async () => {
    const mockProof = { keyring: { name: 'decrypted-key-for-verifier' } }
    mockProveCertificate.mockResolvedValue(mockProof)

    const request = makeRequest('proveCertificate', {
      certificate: mockCertificateInfo,
      verifierPublicKey: '02' + 'a'.repeat(64),
      fieldsToReveal: ['name'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ proof: mockProof })
    expect(mockProveCertificate).toHaveBeenCalledWith({
      certificate: mockCertificateInfo,
      verifierPublicKey: '02' + 'a'.repeat(64),
      fieldsToReveal: ['name'],
    })
  })

  it('returns error when CertificateService throws', async () => {
    mockProveCertificate.mockRejectedValue(new Error('Decryption failed'))

    const request = makeRequest('proveCertificate', {
      certificate: mockCertificateInfo,
      verifierPublicKey: '02' + 'a'.repeat(64),
      fieldsToReveal: ['name'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32000)
    expect(response.error!.message).toBe('Decryption failed')
  })
})

describe('listCertificates handler', () => {
  it('returns certificates without filter', async () => {
    mockListCertificates.mockResolvedValue([mockCertificateInfo])

    const request = makeRequest('listCertificates')

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ certificates: [mockCertificateInfo] })
    expect(mockListCertificates).toHaveBeenCalledWith(undefined)
  })

  it('passes filter to CertificateService', async () => {
    mockListCertificates.mockResolvedValue([])

    const request = makeRequest('listCertificates', {
      filter: { type: 'identity', certifier: '02' + 'a'.repeat(64) },
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ certificates: [] })
    expect(mockListCertificates).toHaveBeenCalledWith({
      type: 'identity',
      certifier: '02' + 'a'.repeat(64),
    })
  })

  it('returns error when CertificateService throws', async () => {
    mockListCertificates.mockRejectedValue(new Error('Store corrupted'))

    const request = makeRequest('listCertificates')

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32000)
    expect(response.error!.message).toBe('Store corrupted')
  })
})

describe('relinquishCertificate handler', () => {
  it('rejects request missing serialNumber param', async () => {
    const request = makeRequest('relinquishCertificate', {})

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Missing required param: serialNumber')
  })

  it('delegates to CertificateService.relinquishCertificate on valid params', async () => {
    mockRelinquishCertificate.mockResolvedValue(undefined)

    const request = makeRequest('relinquishCertificate', {
      serialNumber: 'c2VyaWFsLTEyMw==',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ success: true })
    expect(mockRelinquishCertificate).toHaveBeenCalledWith('c2VyaWFsLTEyMw==')
  })

  it('returns error when CertificateService throws', async () => {
    mockRelinquishCertificate.mockRejectedValue(new Error('Not found'))

    const request = makeRequest('relinquishCertificate', {
      serialNumber: 'nonexistent',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32000)
    expect(response.error!.message).toBe('Not found')
  })
})
