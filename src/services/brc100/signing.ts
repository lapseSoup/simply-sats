/**
 * BRC-100 Signing Operations
 *
 * Message signing and verification using BSV SDK.
 */

import { PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import type { WalletKeys } from '../wallet'

/**
 * Sign a message with the identity key
 */
export function signMessage(keys: WalletKeys, message: string): string {
  const privateKey = PrivateKey.fromWif(keys.identityWif)
  const messageBytes = new TextEncoder().encode(message)
  const signature = privateKey.sign(Array.from(messageBytes))
  // Convert signature to DER-encoded hex string
  const sigDER = signature.toDER() as number[]
  return Buffer.from(sigDER).toString('hex')
}

/**
 * Sign arbitrary data with specified key type
 */
export function signData(
  keys: WalletKeys,
  data: number[],
  keyType: 'identity' | 'wallet' | 'ordinals' = 'identity'
): string {
  let wif: string
  switch (keyType) {
    case 'wallet':
      wif = keys.walletWif
      break
    case 'ordinals':
      wif = keys.ordWif
      break
    default:
      wif = keys.identityWif
  }

  const privateKey = PrivateKey.fromWif(wif)
  const signature = privateKey.sign(data)
  // Convert signature to DER-encoded hex string
  const sigDER = signature.toDER() as number[]
  return Buffer.from(sigDER).toString('hex')
}

/**
 * Verify a signature over raw byte data (matching signData format)
 */
export function verifyDataSignature(
  publicKeyHex: string,
  data: number[],
  signatureHex: string
): boolean {
  try {
    if (!signatureHex || signatureHex.length === 0) return false
    if (!/^[0-9a-fA-F]+$/.test(signatureHex)) return false

    const publicKey = PublicKey.fromString(publicKeyHex)
    const sigBytes = Buffer.from(signatureHex, 'hex')
    const signature = Signature.fromDER(Array.from(sigBytes))

    return publicKey.verify(data, signature)
  } catch {
    return false
  }
}

/**
 * Verify a signature
 */
export function verifySignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): boolean {
  try {
    // Reject empty signatures
    if (!signatureHex || signatureHex.length === 0) {
      return false
    }

    // Validate hex format
    if (!/^[0-9a-fA-F]+$/.test(signatureHex)) {
      return false
    }

    // Parse the public key
    const publicKey = PublicKey.fromString(publicKeyHex)

    // Parse the DER-encoded signature
    const sigBytes = Buffer.from(signatureHex, 'hex')
    const signature = Signature.fromDER(Array.from(sigBytes))

    // Convert message to bytes (must match how it was signed)
    const messageBytes = Array.from(new TextEncoder().encode(message))

    // Verify the signature
    return publicKey.verify(messageBytes, signature)
  } catch {
    // Any parsing or verification error means invalid signature
    return false
  }
}
