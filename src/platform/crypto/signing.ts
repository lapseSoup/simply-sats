/**
 * Pure TypeScript Message/Data Signing
 *
 * Implements ECDSA signing and verification for BRC-100 protocol
 * messages and general-purpose data signing.
 *
 * @module platform/crypto/signing
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { wifToPrivateKey, privateKeyToPublicKey, bytesToHex, hexToBytes } from './keys'

// ============================================
// DER Encoding/Decoding
// ============================================

/** Encode a 64-byte compact signature (r||s) as DER. */
function compactToDER(compact: Uint8Array): Uint8Array {
  const r = compact.slice(0, 32)
  const s = compact.slice(32, 64)

  function encodeInteger(bytes: Uint8Array): Uint8Array {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    const trimmed = bytes.slice(start)
    if (trimmed[0]! >= 0x80) {
      const padded = new Uint8Array(trimmed.length + 1)
      padded[0] = 0x00
      padded.set(trimmed, 1)
      return padded
    }
    return trimmed
  }

  const rEnc = encodeInteger(r)
  const sEnc = encodeInteger(s)
  const totalLen = 2 + rEnc.length + 2 + sEnc.length
  const der = new Uint8Array(2 + totalLen)
  let offset = 0
  der[offset++] = 0x30
  der[offset++] = totalLen
  der[offset++] = 0x02
  der[offset++] = rEnc.length
  der.set(rEnc, offset); offset += rEnc.length
  der[offset++] = 0x02
  der[offset++] = sEnc.length
  der.set(sEnc, offset)
  return der
}

/** Decode a DER signature to 64-byte compact (r||s). */
function derToCompact(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error('Invalid DER signature')
  let offset = 2
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected integer tag for r')
  offset++
  const rLen = der[offset]!
  offset++
  const rBytes = der.slice(offset, offset + rLen)
  offset += rLen

  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected integer tag for s')
  offset++
  const sLen = der[offset]!
  offset++
  const sBytes = der.slice(offset, offset + sLen)

  // Pad or trim to exactly 32 bytes each
  function to32Bytes(bytes: Uint8Array): Uint8Array {
    if (bytes.length === 32) return bytes
    if (bytes.length === 33 && bytes[0] === 0x00) return bytes.slice(1)
    if (bytes.length < 32) {
      const padded = new Uint8Array(32)
      padded.set(bytes, 32 - bytes.length)
      return padded
    }
    return bytes.slice(bytes.length - 32)
  }

  const compact = new Uint8Array(64)
  compact.set(to32Bytes(rBytes), 0)
  compact.set(to32Bytes(sBytes), 32)
  return compact
}

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
  const compact = secp256k1.sign(hash, privKey, { lowS: true })
  return bytesToHex(compactToDER(compact))
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
  const compact = secp256k1.sign(hash, privKey, { lowS: true })
  return bytesToHex(compactToDER(compact))
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
    const compact = derToCompact(hexToBytes(signatureHex))
    return secp256k1.verify(compact, hash, hexToBytes(publicKeyHex))
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
    const compact = derToCompact(hexToBytes(signatureHex))
    return secp256k1.verify(compact, hash, hexToBytes(publicKeyHex))
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
    sharedKey.buffer as ArrayBuffer,
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
    sharedKey.buffer as ArrayBuffer,
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
