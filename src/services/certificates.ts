/**
 * BRC-100 Certificate Service
 *
 * Manages digital certificates for identity verification.
 * Certificates are signed attestations from certifiers about subjects.
 *
 * This implements the BRC-100 certificate specification for:
 * - acquireCertificate: Get a certificate from a certifier
 * - proveCertificate: Prove you hold a certificate to a verifier
 * - listCertificates: List certificates you hold
 */

import { getDatabase } from './database'
import { PrivateKey, Hash, PublicKey, Signature } from '@bsv/sdk'
import type { WalletKeys } from './wallet'
import type { CertificateRow, SqlParams } from './database-types'
import { brc100Logger } from './logger'

/**
 * Certificate types that can be issued
 */
export type CertificateType =
  | 'identity'      // Basic identity verification
  | 'email'         // Email verification
  | 'phone'         // Phone verification
  | 'age'           // Age verification (over 18, over 21, etc.)
  | 'kyc'           // Know Your Customer verification
  | 'membership'    // Membership in an organization
  | string          // Custom types

/**
 * A BRC-100 certificate
 */
export interface Certificate {
  id?: number
  // Certificate type (e.g., "identity", "email")
  type: CertificateType
  // Public key of the certificate subject (the holder)
  subject: string
  // Public key of the certifier who issued this
  certifier: string
  // Unique serial number for this certificate
  serialNumber: string
  // Key-value fields of the certificate
  fields: Record<string, string>
  // Certifier's signature over the certificate data
  signature: string
  // When the certificate was issued (timestamp)
  issuedAt: number
  // When the certificate expires (timestamp, optional)
  expiresAt?: number
  // Revocation txid if revoked (optional)
  revocationTxid?: string
}

/**
 * Certificate acquisition request
 */
export interface AcquireCertificateArgs {
  // Type of certificate to acquire
  type: CertificateType
  // Public key of the certifier to request from
  certifier: string
  // Acquisition protocol: 'direct' for immediate, 'issuance' for async
  acquisitionProtocol: 'direct' | 'issuance'
  // Fields to include in the certificate
  fields?: Record<string, string>
  // Specific serial number to request (for renewals)
  serialNumber?: string
}

/**
 * Certificate proof for selective disclosure
 */
export interface CertificateProof {
  // The certificate being proven
  certificate: Certificate
  // Fields being revealed (subset of certificate fields)
  revealedFields: Record<string, string>
  // Verifier's public key (who we're proving to)
  verifier: string
  // Encrypted field keys for selective disclosure
  encryptedFieldKeys?: Record<string, string>
}

/**
 * Ensure certificates table exists
 */
export async function ensureCertificatesTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        certifier TEXT NOT NULL,
        serial_number TEXT NOT NULL UNIQUE,
        fields TEXT NOT NULL,
        signature TEXT NOT NULL,
        issued_at INTEGER NOT NULL,
        expires_at INTEGER,
        revocation_txid TEXT,
        created_at INTEGER NOT NULL
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_certificates_subject ON certificates(subject)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_certificates_certifier ON certificates(certifier)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(type)')
  } catch (e) {
    brc100Logger.error('Failed to ensure certificates table:', e)
  }
}

/**
 * Store a certificate in the database
 */
export async function storeCertificate(cert: Omit<Certificate, 'id'>): Promise<number> {
  await ensureCertificatesTable()
  const database = getDatabase()

  const result = await database.execute(
    `INSERT OR REPLACE INTO certificates
     (type, subject, certifier, serial_number, fields, signature, issued_at, expires_at, revocation_txid, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      cert.type,
      cert.subject,
      cert.certifier,
      cert.serialNumber,
      JSON.stringify(cert.fields),
      cert.signature,
      cert.issuedAt,
      cert.expiresAt || null,
      cert.revocationTxid || null,
      Date.now()
    ]
  )

  return result.lastInsertId as number
}

/**
 * Get certificates by subject (holder)
 */
export async function getCertificatesBySubject(subject: string): Promise<Certificate[]> {
  await ensureCertificatesTable()
  const database = getDatabase()

  const rows = await database.select<CertificateRow[]>(
    'SELECT * FROM certificates WHERE subject = $1 ORDER BY issued_at DESC',
    [subject]
  )

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    subject: row.subject,
    certifier: row.certifier,
    serialNumber: row.serial_number,
    fields: JSON.parse(row.fields),
    signature: row.signature,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    revocationTxid: row.revocation_txid ?? undefined
  }))
}

/**
 * Get certificates by certifier
 */
export async function getCertificatesByCertifier(certifier: string): Promise<Certificate[]> {
  await ensureCertificatesTable()
  const database = getDatabase()

  const rows = await database.select<CertificateRow[]>(
    'SELECT * FROM certificates WHERE certifier = $1 ORDER BY issued_at DESC',
    [certifier]
  )

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    subject: row.subject,
    certifier: row.certifier,
    serialNumber: row.serial_number,
    fields: JSON.parse(row.fields),
    signature: row.signature,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    revocationTxid: row.revocation_txid ?? undefined
  }))
}

/**
 * Get certificates by type
 */
export async function getCertificatesByType(type: CertificateType, subject?: string): Promise<Certificate[]> {
  await ensureCertificatesTable()
  const database = getDatabase()

  let query = 'SELECT * FROM certificates WHERE type = $1'
  const params: SqlParams = [type]

  if (subject) {
    query += ' AND subject = $2'
    params.push(subject)
  }

  query += ' ORDER BY issued_at DESC'

  const rows = await database.select<CertificateRow[]>(query, params)

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    subject: row.subject,
    certifier: row.certifier,
    serialNumber: row.serial_number,
    fields: JSON.parse(row.fields),
    signature: row.signature,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    revocationTxid: row.revocation_txid ?? undefined
  }))
}

/**
 * Get a certificate by serial number
 */
export async function getCertificateBySerial(serialNumber: string): Promise<Certificate | null> {
  await ensureCertificatesTable()
  const database = getDatabase()

  const rows = await database.select<CertificateRow[]>(
    'SELECT * FROM certificates WHERE serial_number = $1',
    [serialNumber]
  )

  if (rows.length === 0) return null

  const row = rows[0]!
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    certifier: row.certifier,
    serialNumber: row.serial_number,
    fields: JSON.parse(row.fields),
    signature: row.signature,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at ?? undefined,
    revocationTxid: row.revocation_txid ?? undefined
  }
}

/**
 * Mark a certificate as revoked
 */
export async function revokeCertificate(serialNumber: string, revocationTxid: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE certificates SET revocation_txid = $1 WHERE serial_number = $2',
    [revocationTxid, serialNumber]
  )
}

/**
 * Delete a certificate
 */
export async function deleteCertificate(serialNumber: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'DELETE FROM certificates WHERE serial_number = $1',
    [serialNumber]
  )
}

/**
 * Generate a unique serial number for a certificate
 */
export function generateSerialNumber(): string {
  const timestamp = Date.now().toString(36)
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  const random = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${timestamp}-${random}`.toUpperCase()
}

/**
 * Create the data to be signed for a certificate
 */
function createCertificateSigningData(cert: Omit<Certificate, 'id' | 'signature'>): string {
  // Deterministic JSON serialization
  const data = {
    type: cert.type,
    subject: cert.subject,
    certifier: cert.certifier,
    serialNumber: cert.serialNumber,
    fields: cert.fields,
    issuedAt: cert.issuedAt,
    expiresAt: cert.expiresAt
  }
  return JSON.stringify(data, Object.keys(data).sort())
}

/**
 * Sign a certificate as a certifier
 */
export function signCertificate(
  cert: Omit<Certificate, 'id' | 'signature'>,
  certifierWif: string
): string {
  const privateKey = PrivateKey.fromWif(certifierWif)
  const data = createCertificateSigningData(cert)
  const hash = Hash.sha256(Array.from(new TextEncoder().encode(data))) as number[]
  const signature = privateKey.sign(hash)
  const sigBytes = signature.toDER() as number[]
  return Buffer.from(sigBytes).toString('hex')
}

/**
 * Verify a certificate signature
 */
export function verifyCertificateSignature(cert: Certificate): boolean {
  try {
    const data = createCertificateSigningData(cert)
    const hash = Hash.sha256(Array.from(new TextEncoder().encode(data))) as number[]

    // Import certifier public key
    const publicKey = PublicKey.fromString(cert.certifier)

    // Import signature
    const sigBytes = Buffer.from(cert.signature, 'hex')
    const signature = Signature.fromDER(Array.from(sigBytes))

    // Verify
    return publicKey.verify(hash, signature)
  } catch (error) {
    brc100Logger.error('Certificate verification failed', error)
    return false
  }
}

/**
 * Check if a certificate is valid (not expired, not revoked)
 */
export function isCertificateValid(cert: Certificate): boolean {
  // Check expiration
  if (cert.expiresAt && cert.expiresAt < Date.now()) {
    return false
  }

  // Check revocation
  if (cert.revocationTxid) {
    return false
  }

  return true
}

/**
 * BRC-100 acquireCertificate implementation
 *
 * For 'direct' protocol: Creates a self-signed certificate (for testing)
 * For 'issuance' protocol: Would contact external certifier (not implemented)
 */
export async function acquireCertificate(
  args: AcquireCertificateArgs,
  keys: WalletKeys
): Promise<Certificate> {
  if (args.acquisitionProtocol === 'issuance') {
    // External certifier protocol - not yet implemented
    throw new Error('Issuance protocol not yet implemented. Use direct protocol for self-signed certificates.')
  }

  // Direct protocol - create self-signed certificate
  const serialNumber = args.serialNumber || generateSerialNumber()

  const certData: Omit<Certificate, 'id' | 'signature'> = {
    type: args.type,
    subject: keys.identityPubKey,
    certifier: args.certifier || keys.identityPubKey, // Self-signed if no certifier
    serialNumber,
    fields: args.fields || {},
    issuedAt: Date.now(),
    expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year default
  }

  // Sign with identity key (self-signed)
  const { getWifForOperation } = await import('./wallet')
  const identityWif = await getWifForOperation('identity', 'acquireCertificate', keys)
  const signature = signCertificate(certData, identityWif)

  const cert: Certificate = {
    ...certData,
    signature
  }

  // Store in database
  await storeCertificate(cert)

  return cert
}

/**
 * BRC-100 listCertificates implementation
 */
export async function listCertificates(args: {
  certifiers?: string[]
  types?: CertificateType[]
  limit?: number
  offset?: number
}, keys: WalletKeys): Promise<{
  certificates: Certificate[]
  totalCertificates: number
}> {
  // Get all certificates for this subject
  let certs = await getCertificatesBySubject(keys.identityPubKey)

  // Filter by certifiers if specified
  if (args.certifiers && args.certifiers.length > 0) {
    certs = certs.filter(c => args.certifiers!.includes(c.certifier))
  }

  // Filter by types if specified
  if (args.types && args.types.length > 0) {
    certs = certs.filter(c => args.types!.includes(c.type))
  }

  const total = certs.length

  // Apply pagination
  const offset = args.offset || 0
  const limit = args.limit || 100
  certs = certs.slice(offset, offset + limit)

  return {
    certificates: certs,
    totalCertificates: total
  }
}

/**
 * BRC-100 proveCertificate implementation
 *
 * Creates a proof of a certificate with selective field disclosure
 */
export async function proveCertificate(args: {
  certificate: Certificate
  fieldsToReveal: string[]
  verifier: string
}, _keys: WalletKeys): Promise<CertificateProof> {
  const { certificate, fieldsToReveal, verifier } = args

  // Verify we hold this certificate
  if (!isCertificateValid(certificate)) {
    throw new Error('Certificate is expired or revoked')
  }

  // Build revealed fields (only those requested)
  const revealedFields: Record<string, string> = {}
  for (const field of fieldsToReveal) {
    if (certificate.fields[field] !== undefined) {
      revealedFields[field] = certificate.fields[field]
    }
  }

  return {
    certificate,
    revealedFields,
    verifier
    // Note: Full BRC-100 implementation would include encrypted field keys
    // for true selective disclosure with encryption
  }
}
