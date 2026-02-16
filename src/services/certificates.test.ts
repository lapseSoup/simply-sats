// @vitest-environment node
/**
 * Tests for BRC-100 Certificate Service
 *
 * Tests both pure functions (signing, verification, validation, serial generation)
 * and database-backed operations (CRUD, acquire, list, prove).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PrivateKey } from '@bsv/sdk'

// Hoisted mock state
const { mockExecute, mockSelect } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock('./database', () => ({
  getDatabase: () => ({
    execute: mockExecute,
    select: mockSelect,
  }),
}))

vi.mock('./logger', () => ({
  brc100Logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  generateSerialNumber,
  signCertificate,
  verifyCertificateSignature,
  isCertificateValid,
  ensureCertificatesTable,
  storeCertificate,
  getCertificatesBySubject,
  getCertificatesByCertifier,
  getCertificatesByType,
  getCertificateBySerial,
  revokeCertificate,
  deleteCertificate,
  acquireCertificate,
  listCertificates,
  proveCertificate,
  type Certificate,
} from './certificates'
import type { WalletKeys } from './wallet/types'

// ---------- Test fixtures ----------

const certifierKey = PrivateKey.fromWif('L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi')
const certifierPubKey = certifierKey.toPublicKey().toString()

const subjectKey = PrivateKey.fromWif('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn')
const subjectPubKey = subjectKey.toPublicKey().toString()

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: subjectKey.toWif(),
  walletAddress: subjectKey.toPublicKey().toAddress(),
  walletPubKey: subjectPubKey,
  ordWif: subjectKey.toWif(),
  ordAddress: subjectKey.toPublicKey().toAddress(),
  ordPubKey: subjectPubKey,
  identityWif: certifierKey.toWif(),
  identityAddress: certifierKey.toPublicKey().toAddress(),
  identityPubKey: certifierPubKey,
}

function makeCertData(): Omit<Certificate, 'id' | 'signature'> {
  return {
    type: 'identity',
    subject: subjectPubKey,
    certifier: certifierPubKey,
    serialNumber: 'TEST-SERIAL-001',
    fields: { name: 'Alice', email: 'alice@example.com' },
    issuedAt: 1700000000000,
    expiresAt: 1800000000000,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExecute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 })
  mockSelect.mockResolvedValue([])
})

// ---------- generateSerialNumber ----------

describe('generateSerialNumber', () => {
  it('should return a non-empty uppercase string', () => {
    const serial = generateSerialNumber()
    expect(serial.length).toBeGreaterThan(0)
    expect(serial).toBe(serial.toUpperCase())
  })

  it('should contain a hyphen separator', () => {
    const serial = generateSerialNumber()
    expect(serial).toContain('-')
  })

  it('should generate unique serial numbers', () => {
    const serials = new Set<string>()
    for (let i = 0; i < 50; i++) {
      serials.add(generateSerialNumber())
    }
    expect(serials.size).toBe(50)
  })
})

// ---------- signCertificate ----------

describe('signCertificate', () => {
  it('should produce a hex-encoded signature', () => {
    const certData = makeCertData()
    const sig = signCertificate(certData, certifierKey.toWif())
    expect(sig).toMatch(/^[0-9a-f]+$/i)
  })

  it('should produce deterministic signatures for same input', () => {
    const certData = makeCertData()
    const sig1 = signCertificate(certData, certifierKey.toWif())
    const sig2 = signCertificate(certData, certifierKey.toWif())
    expect(sig1).toBe(sig2)
  })

  it('should produce different signatures for different data', () => {
    const cert1 = makeCertData()
    const cert2 = { ...makeCertData(), serialNumber: 'DIFFERENT-SERIAL' }
    const sig1 = signCertificate(cert1, certifierKey.toWif())
    const sig2 = signCertificate(cert2, certifierKey.toWif())
    expect(sig1).not.toBe(sig2)
  })
})

// ---------- verifyCertificateSignature ----------

describe('verifyCertificateSignature', () => {
  it('should verify a valid certificate signature', () => {
    const certData = makeCertData()
    const sig = signCertificate(certData, certifierKey.toWif())
    const cert: Certificate = { ...certData, signature: sig }

    expect(verifyCertificateSignature(cert)).toBe(true)
  })

  it('should reject a tampered certificate', () => {
    const certData = makeCertData()
    const sig = signCertificate(certData, certifierKey.toWif())
    // Tamper with a top-level field that changes the signing data hash
    const cert: Certificate = {
      ...certData,
      signature: sig,
      serialNumber: 'TAMPERED-SERIAL-999',
    }

    expect(verifyCertificateSignature(cert)).toBe(false)
  })

  it('should reject a certificate signed by a different key', () => {
    const certData = makeCertData()
    // Sign with subject key instead of certifier key
    const sig = signCertificate(certData, subjectKey.toWif())
    const cert: Certificate = { ...certData, signature: sig }

    expect(verifyCertificateSignature(cert)).toBe(false)
  })

  it('should return false for a malformed signature', () => {
    const certData = makeCertData()
    const cert: Certificate = { ...certData, signature: 'not-a-valid-signature' }

    expect(verifyCertificateSignature(cert)).toBe(false)
  })

  it('should return false for an empty signature', () => {
    const certData = makeCertData()
    const cert: Certificate = { ...certData, signature: '' }

    expect(verifyCertificateSignature(cert)).toBe(false)
  })
})

// ---------- isCertificateValid ----------

describe('isCertificateValid', () => {
  it('should return true for a valid, non-expired, non-revoked certificate', () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: 'dummy',
      expiresAt: Date.now() + 86400000, // expires tomorrow
    }
    expect(isCertificateValid(cert)).toBe(true)
  })

  it('should return false for an expired certificate', () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: 'dummy',
      expiresAt: Date.now() - 1000, // expired 1 second ago
    }
    expect(isCertificateValid(cert)).toBe(false)
  })

  it('should return false for a revoked certificate', () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: 'dummy',
      expiresAt: Date.now() + 86400000,
      revocationTxid: 'abc123def456',
    }
    expect(isCertificateValid(cert)).toBe(false)
  })

  it('should return true when expiresAt is undefined', () => {
    const certData = makeCertData()
    const cert: Certificate = {
      ...certData,
      signature: 'dummy',
      expiresAt: undefined,
    }
    expect(isCertificateValid(cert)).toBe(true)
  })
})

// ---------- ensureCertificatesTable ----------

describe('ensureCertificatesTable', () => {
  it('should execute CREATE TABLE and CREATE INDEX statements', async () => {
    await ensureCertificatesTable()

    // 1 CREATE TABLE + 3 CREATE INDEX = 4 calls
    expect(mockExecute).toHaveBeenCalledTimes(4)
    expect(mockExecute.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS certificates')
    expect(mockExecute.mock.calls[1][0]).toContain('CREATE INDEX IF NOT EXISTS idx_certificates_subject')
    expect(mockExecute.mock.calls[2][0]).toContain('CREATE INDEX IF NOT EXISTS idx_certificates_certifier')
    expect(mockExecute.mock.calls[3][0]).toContain('CREATE INDEX IF NOT EXISTS idx_certificates_type')
  })

  it('should not throw on database error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB error'))
    await expect(ensureCertificatesTable()).resolves.not.toThrow()
  })
})

// ---------- storeCertificate ----------

describe('storeCertificate', () => {
  it('should insert certificate and return lastInsertId', async () => {
    mockExecute.mockResolvedValue({ lastInsertId: 42, rowsAffected: 1 })

    const certData = makeCertData()
    const cert = { ...certData, signature: 'abc123' }
    const id = await storeCertificate(cert)

    expect(id).toBe(42)
    // Should have called ensureCertificatesTable (4 calls) + 1 INSERT
    expect(mockExecute).toHaveBeenCalledTimes(5)
    const insertCall = mockExecute.mock.calls[4]
    expect(insertCall[0]).toContain('INSERT OR REPLACE INTO certificates')
    expect(insertCall[1]).toContain('identity')
    expect(insertCall[1]).toContain(subjectPubKey)
  })
})

// ---------- getCertificatesBySubject ----------

describe('getCertificatesBySubject', () => {
  it('should query certificates by subject and map rows correctly', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 1,
        type: 'identity',
        subject: subjectPubKey,
        certifier: certifierPubKey,
        serial_number: 'SN-001',
        fields: '{"name":"Alice"}',
        signature: 'sig123',
        issued_at: 1700000000000,
        expires_at: null,
        revocation_txid: null,
      },
    ])

    const certs = await getCertificatesBySubject(subjectPubKey)

    expect(certs).toHaveLength(1)
    expect(certs[0]!.serialNumber).toBe('SN-001')
    expect(certs[0]!.fields).toEqual({ name: 'Alice' })
    expect(certs[0]!.expiresAt).toBeUndefined()
    expect(certs[0]!.revocationTxid).toBeUndefined()
  })

  it('should return empty array when no certificates found', async () => {
    mockSelect.mockResolvedValueOnce([])
    const certs = await getCertificatesBySubject('unknown-pubkey')
    expect(certs).toEqual([])
  })
})

// ---------- getCertificatesByCertifier ----------

describe('getCertificatesByCertifier', () => {
  it('should query certificates by certifier', async () => {
    mockSelect.mockResolvedValueOnce([])
    const certs = await getCertificatesByCertifier(certifierPubKey)

    expect(certs).toEqual([])
    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('WHERE certifier = $1'),
      [certifierPubKey]
    )
  })
})

// ---------- getCertificatesByType ----------

describe('getCertificatesByType', () => {
  it('should query by type only', async () => {
    mockSelect.mockResolvedValueOnce([])
    await getCertificatesByType('email')

    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('WHERE type = $1'),
      ['email']
    )
  })

  it('should query by type and subject', async () => {
    mockSelect.mockResolvedValueOnce([])
    await getCertificatesByType('identity', subjectPubKey)

    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('AND subject = $2'),
      ['identity', subjectPubKey]
    )
  })
})

// ---------- getCertificateBySerial ----------

describe('getCertificateBySerial', () => {
  it('should return certificate when found', async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: 5,
        type: 'email',
        subject: subjectPubKey,
        certifier: certifierPubKey,
        serial_number: 'SN-005',
        fields: '{"email":"test@example.com"}',
        signature: 'sig',
        issued_at: 1700000000000,
        expires_at: 1800000000000,
        revocation_txid: null,
      },
    ])

    const cert = await getCertificateBySerial('SN-005')
    expect(cert).not.toBeNull()
    expect(cert!.type).toBe('email')
    expect(cert!.expiresAt).toBe(1800000000000)
  })

  it('should return null when not found', async () => {
    mockSelect.mockResolvedValueOnce([])
    const cert = await getCertificateBySerial('NONEXISTENT')
    expect(cert).toBeNull()
  })
})

// ---------- revokeCertificate ----------

describe('revokeCertificate', () => {
  it('should update revocation_txid', async () => {
    await revokeCertificate('SN-001', 'revoke-txid-123')

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE certificates SET revocation_txid'),
      ['revoke-txid-123', 'SN-001']
    )
  })
})

// ---------- deleteCertificate ----------

describe('deleteCertificate', () => {
  it('should delete by serial number', async () => {
    await deleteCertificate('SN-001')

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM certificates WHERE serial_number'),
      ['SN-001']
    )
  })
})

// ---------- acquireCertificate ----------

describe('acquireCertificate', () => {
  it('should create a self-signed certificate with direct protocol', async () => {
    mockExecute.mockResolvedValue({ lastInsertId: 10, rowsAffected: 1 })

    const cert = await acquireCertificate({
      type: 'identity',
      certifier: certifierPubKey,
      acquisitionProtocol: 'direct',
      fields: { name: 'Test' },
    }, testKeys)

    expect(cert.type).toBe('identity')
    expect(cert.subject).toBe(testKeys.identityPubKey)
    expect(cert.certifier).toBe(certifierPubKey)
    expect(cert.fields).toEqual({ name: 'Test' })
    expect(cert.signature).toMatch(/^[0-9a-f]+$/i)
    expect(cert.serialNumber).toBeTruthy()
  })

  it('should use provided serial number', async () => {
    mockExecute.mockResolvedValue({ lastInsertId: 11, rowsAffected: 1 })

    const cert = await acquireCertificate({
      type: 'identity',
      certifier: certifierPubKey,
      acquisitionProtocol: 'direct',
      serialNumber: 'CUSTOM-SERIAL',
    }, testKeys)

    expect(cert.serialNumber).toBe('CUSTOM-SERIAL')
  })

  it('should throw for issuance protocol', async () => {
    await expect(
      acquireCertificate({
        type: 'identity',
        certifier: certifierPubKey,
        acquisitionProtocol: 'issuance',
      }, testKeys)
    ).rejects.toThrow('Issuance protocol not yet implemented')
  })
})

// ---------- listCertificates ----------

describe('listCertificates', () => {
  const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    type: 'identity',
    subject: certifierPubKey,
    certifier: certifierPubKey,
    serial_number: 'SN-001',
    fields: '{}',
    signature: 'sig',
    issued_at: 1700000000000,
    expires_at: null,
    revocation_txid: null,
    ...overrides,
  })

  it('should return all certificates for the identity', async () => {
    mockSelect.mockResolvedValueOnce([makeRow(), makeRow({ id: 2, serial_number: 'SN-002' })])

    const result = await listCertificates({}, testKeys)

    expect(result.totalCertificates).toBe(2)
    expect(result.certificates).toHaveLength(2)
  })

  it('should filter by certifiers', async () => {
    mockSelect.mockResolvedValueOnce([
      makeRow({ certifier: certifierPubKey }),
      makeRow({ id: 2, certifier: 'other-certifier', serial_number: 'SN-002' }),
    ])

    const result = await listCertificates({ certifiers: [certifierPubKey] }, testKeys)
    expect(result.certificates.every(c => c.certifier === certifierPubKey)).toBe(true)
  })

  it('should filter by types', async () => {
    mockSelect.mockResolvedValueOnce([
      makeRow({ type: 'identity' }),
      makeRow({ id: 2, type: 'email', serial_number: 'SN-002' }),
    ])

    const result = await listCertificates({ types: ['email'] }, testKeys)
    expect(result.certificates.every(c => c.type === 'email')).toBe(true)
  })

  it('should apply pagination', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({ id: i + 1, serial_number: `SN-${i + 1}` })
    )
    mockSelect.mockResolvedValueOnce(rows)

    const result = await listCertificates({ offset: 2, limit: 2 }, testKeys)
    expect(result.totalCertificates).toBe(5)
    expect(result.certificates).toHaveLength(2)
  })
})

// ---------- proveCertificate ----------

describe('proveCertificate', () => {
  it('should create a proof with selective field disclosure', async () => {
    const certData = makeCertData()
    const sig = signCertificate(certData, certifierKey.toWif())
    const cert: Certificate = {
      ...certData,
      signature: sig,
      expiresAt: Date.now() + 86400000,
    }

    const proof = await proveCertificate({
      certificate: cert,
      fieldsToReveal: ['name'],
      verifier: 'verifier-pubkey',
    }, testKeys)

    expect(proof.revealedFields).toEqual({ name: 'Alice' })
    expect(proof.revealedFields).not.toHaveProperty('email')
    expect(proof.verifier).toBe('verifier-pubkey')
  })

  it('should throw for expired certificate', async () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: 'sig',
      expiresAt: Date.now() - 1000,
    }

    await expect(
      proveCertificate({
        certificate: cert,
        fieldsToReveal: ['name'],
        verifier: 'verifier',
      }, testKeys)
    ).rejects.toThrow('expired or revoked')
  })

  it('should throw for revoked certificate', async () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: 'sig',
      expiresAt: Date.now() + 86400000,
      revocationTxid: 'revoke-tx',
    }

    await expect(
      proveCertificate({
        certificate: cert,
        fieldsToReveal: ['name'],
        verifier: 'verifier',
      }, testKeys)
    ).rejects.toThrow('expired or revoked')
  })

  it('should handle fields that do not exist in the certificate', async () => {
    const cert: Certificate = {
      ...makeCertData(),
      signature: signCertificate(makeCertData(), certifierKey.toWif()),
      expiresAt: Date.now() + 86400000,
    }

    const proof = await proveCertificate({
      certificate: cert,
      fieldsToReveal: ['nonexistent_field'],
      verifier: 'verifier',
    }, testKeys)

    expect(proof.revealedFields).toEqual({})
  })
})
