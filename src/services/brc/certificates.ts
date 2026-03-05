/**
 * CertificateService — Manages BRC-52 identity certificates with selective
 * field disclosure using the @bsv/sdk Certificate classes.
 *
 * Provides create, list, prove (selective disclosure), revocation check, and
 * delete operations. Certificates are stored in-memory for now; database
 * persistence will be added in Task 11 after the migration (Task 10).
 *
 * @module services/brc/certificates
 */

import {
  Certificate,
  MasterCertificate,
  Random,
  Utils,
} from '@bsv/sdk'
import type {
  Base64String,
  PubKeyHex,
  CertificateFieldNameUnder50Bytes,
  OutpointString,
} from '@bsv/sdk'
import type { TauriProtoWallet } from './adapter'
import { type WocClient, getWocClient } from '../../infrastructure/api/wocClient'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Serialisable certificate data returned by create / list operations. */
export interface CertificateInfo {
  type: Base64String
  serialNumber: Base64String
  subject: PubKeyHex
  certifier: PubKeyHex
  revocationOutpoint: OutpointString
  fields: Record<CertificateFieldNameUnder50Bytes, Base64String>
  masterKeyring: Record<CertificateFieldNameUnder50Bytes, Base64String>
  signature?: string
}

/** Result of a createSelfSignedCert call. */
export interface CertificateResult {
  certificate: CertificateInfo
}

/** Result of a proveCertificate call — keyring for the verifier. */
export interface ProveResult {
  keyring: Record<CertificateFieldNameUnder50Bytes, string>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random 32-byte base64-encoded serial number.
 * Uses the SDK's cryptographic Random() function.
 */
function generateSerialNumber(): Base64String {
  return Utils.toBase64(Random(32))
}

/**
 * Generate a placeholder revocation outpoint (32 zero-bytes txid, vout 0).
 * Real revocation outpoints would be created by an on-chain transaction.
 */
function placeholderRevocationOutpoint(): OutpointString {
  return `${'00'.repeat(32)}.0`
}

/**
 * Parse an outpoint string ("txid.vout") into its components.
 */
function parseOutpoint(outpoint: string): { txid: string; vout: number } {
  const dotIndex = outpoint.lastIndexOf('.')
  if (dotIndex === -1) {
    throw new Error(`Invalid outpoint format: ${outpoint}`)
  }
  return {
    txid: outpoint.substring(0, dotIndex),
    vout: Number(outpoint.substring(dotIndex + 1)),
  }
}

// ---------------------------------------------------------------------------
// CertificateService
// ---------------------------------------------------------------------------

export class CertificateService {
  private wallet: TauriProtoWallet
  private wocClient: WocClient

  /** In-memory certificate store (keyed by serialNumber). */
  private store = new Map<string, CertificateInfo>()

  constructor(wallet: TauriProtoWallet, wocClient?: WocClient) {
    this.wallet = wallet
    this.wocClient = wocClient ?? getWocClient()
  }

  // =========================================================================
  // Create
  // =========================================================================

  /**
   * Create a self-signed certificate with the wallet's identity key.
   *
   * The wallet acts as both subject and certifier. Fields are encrypted with
   * random symmetric keys; the master keyring stores those keys encrypted
   * for the wallet itself (counterparty = 'self').
   */
  async createSelfSignedCert(args: {
    type: string
    fields: Record<string, string>
  }): Promise<CertificateResult> {
    const serialNumber = generateSerialNumber()

    // Encode certificate type as base64 (padded / truncated to 32 bytes)
    const typeBytes = Utils.toArray(args.type, 'utf8')
    const padded = new Array<number>(32).fill(0)
    for (let i = 0; i < Math.min(typeBytes.length, 32); i++) {
      padded[i] = typeBytes[i]
    }
    const certType: Base64String = Utils.toBase64(padded)

    // Encrypt fields and build master keyring (self-signed: counterparty = 'self')
    const { certificateFields, masterKeyring } =
      await MasterCertificate.createCertificateFields(
        this.wallet,
        'self',
        args.fields,
      )

    const revocationOutpoint = placeholderRevocationOutpoint()
    const { publicKey: identityKey } = await this.wallet.getPublicKey({
      identityKey: true,
    })

    // Build and sign the certificate
    const cert = new MasterCertificate(
      certType,
      serialNumber,
      identityKey,
      identityKey, // self-signed: certifier === subject
      revocationOutpoint,
      certificateFields,
      masterKeyring,
    )
    await cert.sign(this.wallet)

    const info: CertificateInfo = {
      type: cert.type,
      serialNumber: cert.serialNumber,
      subject: cert.subject,
      certifier: cert.certifier,
      revocationOutpoint: cert.revocationOutpoint,
      fields: cert.fields,
      masterKeyring: cert.masterKeyring,
      signature: cert.signature,
    }

    // Persist in-memory
    this.store.set(cert.serialNumber, info)

    return { certificate: info }
  }

  // =========================================================================
  // List
  // =========================================================================

  /**
   * List certificates from local storage, optionally filtered by type
   * and/or certifier public key.
   */
  async listCertificates(filter?: {
    type?: string
    certifier?: string
  }): Promise<CertificateInfo[]> {
    let results = Array.from(this.store.values())

    if (filter?.type) {
      // Encode the filter type to base64 the same way we encode on creation,
      // so comparisons are consistent.
      const typeBytes = Utils.toArray(filter.type, 'utf8')
      const padded = new Array<number>(32).fill(0)
      for (let i = 0; i < Math.min(typeBytes.length, 32); i++) {
        padded[i] = typeBytes[i]
      }
      const encoded = Utils.toBase64(padded)
      results = results.filter((c) => c.type === encoded)
    }

    if (filter?.certifier) {
      results = results.filter((c) => c.certifier === filter.certifier)
    }

    return results
  }

  // =========================================================================
  // Prove (selective disclosure)
  // =========================================================================

  /**
   * Create a selective disclosure proof for a verifier.
   *
   * Decrypts the master keys for the requested fields and re-encrypts them
   * for the verifier, producing a keyring that allows the verifier to decrypt
   * only those specific fields.
   */
  async proveCertificate(args: {
    certificate: CertificateInfo
    verifierPublicKey: string
    fieldsToReveal: string[]
  }): Promise<ProveResult> {
    const { certificate, verifierPublicKey, fieldsToReveal } = args

    const keyring = await MasterCertificate.createKeyringForVerifier(
      this.wallet,
      certificate.certifier, // certifier who encrypted the master keyring
      verifierPublicKey, // verifier who will receive the selective keyring
      certificate.fields,
      fieldsToReveal,
      certificate.masterKeyring,
      certificate.serialNumber,
    )

    return { keyring }
  }

  // =========================================================================
  // Delete
  // =========================================================================

  /**
   * Remove a certificate from local storage by serial number.
   */
  async relinquishCertificate(serialNumber: string): Promise<void> {
    this.store.delete(serialNumber)
  }

  // =========================================================================
  // Revocation check
  // =========================================================================

  /**
   * Check if a certificate has been revoked by verifying its revocation
   * outpoint on-chain. A certificate is considered revoked if the outpoint
   * UTXO has been spent.
   *
   * Placeholder outpoints (all zeros) are never considered revoked.
   */
  async checkRevocation(revocationOutpoint: string): Promise<boolean> {
    // Placeholder outpoints are never revoked
    if (revocationOutpoint.startsWith('00'.repeat(32))) {
      return false
    }

    const { txid, vout } = parseOutpoint(revocationOutpoint)
    const result = await this.wocClient.isOutputSpentSafe(txid, vout)

    if (!result.ok) {
      // Network error — cannot determine revocation status; treat as not revoked
      // to avoid false positives. Callers should handle this gracefully.
      return false
    }

    // If result.value is a non-null txid, the output was spent → revoked
    return result.value !== null
  }

  // =========================================================================
  // Verify
  // =========================================================================

  /**
   * Verify the signature on a certificate.
   */
  async verifyCertificate(info: CertificateInfo): Promise<boolean> {
    const cert = Certificate.fromObject({
      type: info.type,
      serialNumber: info.serialNumber,
      subject: info.subject,
      certifier: info.certifier,
      revocationOutpoint: info.revocationOutpoint,
      fields: info.fields,
      signature: info.signature,
    })
    return cert.verify()
  }
}
