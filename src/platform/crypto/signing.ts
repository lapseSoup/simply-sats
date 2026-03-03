/**
 * Pure TypeScript Message/Data Signing
 *
 * Implements ECDSA signing and verification for BRC-100 protocol
 * messages and general-purpose data signing.
 *
 * @module platform/crypto/signing
 */

import * as secp256k1 from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { wifToPrivateKey, privateKeyToPublicKey, bytesToHex, hexToBytes } from './keys'

// ============================================
// Message Signing
// ============================================

/**
 * Sign a UTF-8 message with a private key (WIF).
 *
 * Algorithm: SHA-256(message_bytes) → ECDSA sign → DER hex
 *
 * @returns DER-encoded signature as hex string
 */
export function signMessage(wif: string, message: string): string {
  const privKey = wifToPrivateKey(wif)
  const messageBytes = new TextEncoder().encode(message)
  const hash = sha256(messageBytes)
  const sig = secp256k1.sign(hash, privKey, { lowS: true })
  return bytesToHex(sig.toDERRawBytes())
}

/**
 * Sign raw data (hex-encoded) with a private key (WIF).
 *
 * Algorithm: SHA-256(hex_decoded_data) → ECDSA sign → DER hex
 *
 * @returns DER-encoded signature as hex string
 */
export function signData(wif: string, dataHex: string): string {
  const privKey = wifToPrivateKey(wif)
  const dataBytes = hexToBytes(dataHex)
  const hash = sha256(dataBytes)
  const sig = secp256k1.sign(hash, privKey, { lowS: true })
  return bytesToHex(sig.toDERRawBytes())
}

// ============================================
// Signature Verification
// ============================================

/**
 * Verify a message signature.
 *
 * @param publicKeyHex - Compressed public key (66 hex chars)
 * @param message - Original UTF-8 message
 * @param signatureHex - DER-encoded signature (hex)
 * @returns true if signature is valid
 */
export function verifyMessageSignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): boolean {
  if (!signatureHex || signatureHex.length === 0) return false

  try {
    const messageBytes = new TextEncoder().encode(message)
    const hash = sha256(messageBytes)
    const sig = secp256k1.Signature.fromDER(hexToBytes(signatureHex))
    return secp256k1.verify(sig, hash, hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}

/**
 * Verify a data signature.
 *
 * @param publicKeyHex - Compressed public key (66 hex chars)
 * @param dataHex - Original data (hex)
 * @param signatureHex - DER-encoded signature (hex)
 * @returns true if signature is valid
 */
export function verifyDataSignature(
  publicKeyHex: string,
  dataHex: string,
  signatureHex: string
): boolean {
  if (!signatureHex || signatureHex.length === 0) return false

  try {
    const dataBytes = hexToBytes(dataHex)
    const hash = sha256(dataBytes)
    const sig = secp256k1.Signature.fromDER(hexToBytes(signatureHex))
    return secp256k1.verify(sig, hash, hexToBytes(publicKeyHex))
  } catch {
    return false
  }
}

// ============================================
// ECIES Encryption/Decryption
// ============================================

/**
 * ECIES encrypt using ECDH + AES-256-GCM.
 *
 * Wire format: [nonce(12)] [padding(20)] [ciphertext+authTag]
 */
export async function eciesEncrypt(
  senderWif: string,
  plaintext: string,
  recipientPubKeyHex: string
): Promise<{ ciphertext: string; senderPublicKey: string }> {
  const senderPrivKey = wifToPrivateKey(senderWif)
  const senderPubKey = privateKeyToPublicKey(senderPrivKey)
  const recipientPubKey = hexToBytes(recipientPubKeyHex)

  // ECDH shared key
  const sharedPoint = secp256k1.getSharedSecret(senderPrivKey, recipientPubKey, true)
  const sharedKey = sha256(sharedPoint)

  // Import key for AES-256-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    sharedKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  // Generate 12-byte nonce
  const nonce = crypto.getRandomValues(new Uint8Array(12))

  // Encrypt
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      cryptoKey,
      plaintextBytes
    )
  )

  // Wire format: [nonce(12)] [padding(20)] [ciphertext+authTag]
  const padding = new Uint8Array(20) // all zeros
  const wire = new Uint8Array(32 + encrypted.length)
  wire.set(nonce, 0)
  wire.set(padding, 12)
  wire.set(encrypted, 32)

  return {
    ciphertext: bytesToHex(wire),
    senderPublicKey: bytesToHex(senderPubKey),
  }
}

/**
 * ECIES decrypt using ECDH + AES-256-GCM.
 */
export async function eciesDecrypt(
  recipientWif: string,
  ciphertextHex: string,
  senderPubKeyHex: string
): Promise<string> {
  const recipientPrivKey = wifToPrivateKey(recipientWif)
  const senderPubKey = hexToBytes(senderPubKeyHex)
  const ciphertextBytes = hexToBytes(ciphertextHex)

  if (ciphertextBytes.length < 48) {
    throw new Error('Invalid ECIES ciphertext: too short')
  }

  // Validate padding (bytes 12-32 must be all zeros)
  for (let i = 12; i < 32; i++) {
    if (ciphertextBytes[i] !== 0) {
      throw new Error('Invalid ECIES wire format: non-zero padding')
    }
  }

  // ECDH shared key
  const sharedPoint = secp256k1.getSharedSecret(recipientPrivKey, senderPubKey, true)
  const sharedKey = sha256(sharedPoint)

  // Import key for AES-256-GCM
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    sharedKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  // Extract nonce and encrypted data
  const nonce = ciphertextBytes.slice(0, 12)
  const encryptedData = ciphertextBytes.slice(32)

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    encryptedData
  )

  return new TextDecoder().decode(decrypted)
}
