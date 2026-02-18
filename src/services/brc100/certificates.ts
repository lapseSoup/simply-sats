/**
 * BRC-100 Certificate Operations
 *
 * Delegates certificate operations to the certificate service.
 * WalletKeys is accepted as an explicit first parameter — callers
 * (HTTP handlers) are responsible for resolving keys at the boundary.
 */

import {
  acquireCertificate as acquireCertificateService,
  listCertificates as listCertificatesService,
  proveCertificate as proveCertificateService,
  type Certificate,
  type CertificateType,
  type AcquireCertificateArgs
} from '../certificates'
import type { WalletKeys } from '../wallet'

// Re-export needed certificate types for convenience
export type { Certificate, CertificateType, AcquireCertificateArgs }

// BRC-100 acquireCertificate - delegates to certificate service
export async function acquireCertificate(keys: WalletKeys | null, args: AcquireCertificateArgs): Promise<Certificate> {
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return acquireCertificateService(args, keys)
}

// BRC-100 listCertificates - delegates to certificate service
export async function listCertificates(keys: WalletKeys | null, args: {
  certifiers?: string[]
  types?: CertificateType[]
  limit?: number
  offset?: number
}): Promise<{
  certificates: Certificate[]
  totalCertificates: number
}> {
  if (!keys) {
    return { certificates: [], totalCertificates: 0 }
  }
  return listCertificatesService(args, keys)
}

// BRC-100 proveCertificate - creates a proof of certificate ownership
export async function proveCertificate(keys: WalletKeys | null, args: {
  certificate: Certificate
  fieldsToReveal: string[]
  verifier: string
}): Promise<{
  certificate: Certificate
  revealedFields: Record<string, string>
  verifier: string
}> {
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return proveCertificateService(args, keys)
}
