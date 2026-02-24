/**
 * BRC-100 Signing Operations
 *
 * Message signing and verification using BSV SDK (JS fallback)
 * or Rust Tauri commands (desktop app).
 */

import { PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import type { WalletKeys } from '../wallet'
import { isTauri, tauriInvoke } from '../../utils/tauri'

/**
 * Sign a message with the identity key.
 * In Tauri, uses the key store (WIF never leaves Rust).
 */
export async function signMessage(keys: WalletKeys, message: string): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>('sign_message_from_store', { message, keyType: 'identity' })
  }

  // JS fallback (browser dev mode only)
  const privateKey = PrivateKey.fromWif(keys.identityWif)
  const messageBytes = new TextEncoder().encode(message)
  const signature = privateKey.sign(Array.from(messageBytes))
  return signature.toDER('hex') as string
}

/**
 * Sign arbitrary data with specified key type
 */
export async function signData(
  keys: WalletKeys,
  data: number[],
  keyType: 'identity' | 'wallet' | 'ordinals' = 'identity'
): Promise<string> {
  if (isTauri()) {
    // Use key store — WIF never leaves Rust
    return tauriInvoke<string>('sign_data_from_store', { data: new Uint8Array(data), keyType })
  }

  // JS fallback (browser dev mode only)
  let wif: string
  switch (keyType) {
    case 'wallet':
      wif = keys.walletWif
      break
    case 'ordinals':
      wif = keys.ordWif
      break
    case 'identity':
      wif = keys.identityWif
      break
    default:
      throw new Error(`Invalid keyType: ${keyType as string}`)
  }

  const privateKey = PrivateKey.fromWif(wif)
  const signature = privateKey.sign(data)
  return signature.toDER('hex') as string
}

/**
 * Verify a signature over raw byte data (matching signData format)
 */
export async function verifyDataSignature(
  publicKeyHex: string,
  data: number[],
  signatureHex: string
): Promise<boolean> {
  if (isTauri()) {
    return tauriInvoke<boolean>('verify_data_signature', {
      publicKeyHex,
      data: new Uint8Array(data),
      signatureHex
    })
  }

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
export async function verifySignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): Promise<boolean> {
  if (isTauri()) {
    return tauriInvoke<boolean>('verify_signature', { publicKeyHex, message, signatureHex })
  }

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
