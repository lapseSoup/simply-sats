/**
 * BRC-100 Certificate Operations
 *
 * Delegates certificate operations to the certificate service,
 * using BRC-100 wallet keys for authentication.
 */

import {
  acquireCertificate as acquireCertificateService,
  listCertificates as listCertificatesService,
  proveCertificate as proveCertificateService,
  type Certificate,
  type CertificateType,
  type AcquireCertificateArgs
} from '../certificates'
import { getWalletKeys } from './state'

// Re-export needed certificate types for convenience
export type { Certificate, CertificateType, AcquireCertificateArgs }

// BRC-100 acquireCertificate - delegates to certificate service
export async function acquireCertificate(args: AcquireCertificateArgs): Promise<Certificate> {
  const keys = getWalletKeys()
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return acquireCertificateService(args, keys)
}

// BRC-100 listCertificates - delegates to certificate service
export async function listCertificates(args: {
  certifiers?: string[]
  types?: CertificateType[]
  limit?: number
  offset?: number
}): Promise<{
  certificates: Certificate[]
  totalCertificates: number
}> {
  const keys = getWalletKeys()
  if (!keys) {
    return { certificates: [], totalCertificates: 0 }
  }
  return listCertificatesService(args, keys)
}

// BRC-100 proveCertificate - creates a proof of certificate ownership
export async function proveCertificate(args: {
  certificate: Certificate
  fieldsToReveal: string[]
  verifier: string
}): Promise<{
  certificate: Certificate
  revealedFields: Record<string, string>
  verifier: string
}> {
  const keys = getWalletKeys()
  if (!keys) {
    throw new Error('No wallet loaded')
  }
  return proveCertificateService(args, keys)
}
