/**
 * BRC-42/43 Key Derivation (Pure TypeScript)
 *
 * Implements ECDH-based child key derivation for the BRC-42 protocol
 * and tagged key derivation for BRC-43.
 *
 * Algorithm: ECDH(receiver_priv, sender_pub) → SHA-256 → HMAC-SHA256(invoice) → scalar addition
 *
 * @module platform/crypto/brc42
 */

import * as secp256k1 from '@noble/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { hmac } from '@noble/hashes/hmac'
import {
  wifToPrivateKey,
  privateKeyToWif,
  privateKeyToPublicKey,
  publicKeyToAddress,
  bytesToHex,
  hexToBytes,
} from './keys'

import type { DerivedKeyResult, DerivedAddressResult, TaggedKeyResult, DerivationTag } from '../types'

/** secp256k1 curve order */
const CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n

// ============================================
// ECDH Shared Key
// ============================================

/**
 * Compute ECDH shared key: SHA-256(privKey * pubKeyPoint).
 * Both parties produce the same shared key.
 */
export function ecdhSharedKey(privKey: Uint8Array, pubKeyBytes: Uint8Array): Uint8Array {
  // Scalar multiplication on secp256k1
  const sharedPoint = secp256k1.getSharedSecret(privKey, pubKeyBytes, true) // true = compressed
  // Hash the shared point to get the symmetric key
  return sha256(sharedPoint)
}

// ============================================
// BRC-42 Child Key Derivation
// ============================================

/**
 * Derive a child private key using BRC-42 protocol.
 *
 * Algorithm:
 * 1. ECDH(receiver_priv, sender_pub) → shared_pubkey
 * 2. SHA-256(shared_pubkey) → shared_key
 * 3. HMAC-SHA256(shared_key, invoice_number) → tweak
 * 4. child_privkey = (receiver_privkey + tweak) mod n
 */
function deriveChildPrivateKey(
  receiverPrivKey: Uint8Array,
  senderPubKeyBytes: Uint8Array,
  invoiceNumber: string
): Uint8Array {
  // Step 1-2: ECDH → SHA-256
  const sharedKey = ecdhSharedKey(receiverPrivKey, senderPubKeyBytes)

  // Step 3: HMAC-SHA256(shared_key, invoice_number)
  const invoiceBytes = new TextEncoder().encode(invoiceNumber)
  const tweakBytes = hmac(sha256, sharedKey, invoiceBytes)

  // Step 4: Scalar addition mod n
  const receiverScalar = bytesToBigInt(receiverPrivKey)
  const tweakScalar = bytesToBigInt(tweakBytes)
  const childScalar = (receiverScalar + tweakScalar) % CURVE_ORDER

  return bigIntToBytes(childScalar, 32)
}

/**
 * Derive a BRC-42 child key from WIF + sender pubkey + invoice number.
 */
export function deriveChildKey(
  receiverWif: string,
  senderPubKeyHex: string,
  invoiceNumber: string
): DerivedKeyResult {
  const receiverPrivKey = wifToPrivateKey(receiverWif)
  const senderPubKey = hexToBytes(senderPubKeyHex)

  const childPrivKey = deriveChildPrivateKey(receiverPrivKey, senderPubKey, invoiceNumber)
  const childPubKey = privateKeyToPublicKey(childPrivKey)

  return {
    wif: privateKeyToWif(childPrivKey),
    address: publicKeyToAddress(childPubKey),
    pubKey: bytesToHex(childPubKey),
  }
}

/**
 * Batch-derive addresses from known senders and invoice numbers.
 */
export function getDerivedAddresses(
  receiverWif: string,
  senderPubKeys: string[],
  invoiceNumbers: string[]
): DerivedAddressResult[] {
  const results: DerivedAddressResult[] = []
  const receiverPrivKey = wifToPrivateKey(receiverWif)

  for (const senderPubKeyHex of senderPubKeys) {
    const senderPubKey = hexToBytes(senderPubKeyHex)
    for (const invoiceNumber of invoiceNumbers) {
      const childPrivKey = deriveChildPrivateKey(receiverPrivKey, senderPubKey, invoiceNumber)
      const childPubKey = privateKeyToPublicKey(childPrivKey)

      results.push({
        address: publicKeyToAddress(childPubKey),
        senderPubKey: senderPubKeyHex,
        invoiceNumber,
      })
    }
  }

  return results
}

/**
 * Find the invoice number that produces a target address.
 */
export function findDerivedKeyForAddress(
  receiverWif: string,
  targetAddress: string,
  senderPubKeyHex: string,
  invoiceNumbers: string[],
  maxNumeric: number
): DerivedKeyResult | null {
  const receiverPrivKey = wifToPrivateKey(receiverWif)
  const senderPubKey = hexToBytes(senderPubKeyHex)

  // Check provided invoice numbers
  for (const invoiceNumber of invoiceNumbers) {
    const childPrivKey = deriveChildPrivateKey(receiverPrivKey, senderPubKey, invoiceNumber)
    const childPubKey = privateKeyToPublicKey(childPrivKey)
    const address = publicKeyToAddress(childPubKey)

    if (address === targetAddress) {
      return {
        wif: privateKeyToWif(childPrivKey),
        address,
        pubKey: bytesToHex(childPubKey),
      }
    }
  }

  // Check numeric invoice numbers 0..maxNumeric
  for (let i = 0; i <= maxNumeric; i++) {
    const invoiceNumber = String(i)
    const childPrivKey = deriveChildPrivateKey(receiverPrivKey, senderPubKey, invoiceNumber)
    const childPubKey = privateKeyToPublicKey(childPrivKey)
    const address = publicKeyToAddress(childPubKey)

    if (address === targetAddress) {
      return {
        wif: privateKeyToWif(childPrivKey),
        address,
        pubKey: bytesToHex(childPubKey),
      }
    }
  }

  return null
}

// ============================================
// BRC-43 Tagged Key Derivation
// ============================================

/**
 * Derive a tagged key (BRC-43 compatible).
 *
 * Algorithm:
 * 1. Create length-prefixed tag string to prevent collisions
 * 2. Get receiver's own public key
 * 3. Self-derive using BRC-42 with tag as invoice number
 */
export function deriveTaggedKey(
  rootWif: string,
  tag: DerivationTag
): TaggedKeyResult {
  const domainStr = tag.domain ?? ''

  // Length-prefixed format prevents collision attacks
  const tagString = `${tag.label.length}:${tag.label}|${tag.id.length}:${tag.id}|${domainStr.length}:${domainStr}`

  // Compute derivation path indices from hashes
  const labelHash = sha256(new TextEncoder().encode(tag.label))
  const idHash = sha256(new TextEncoder().encode(tag.id))
  const labelIndex = new DataView(labelHash.buffer).getUint32(0) % (2 ** 31)
  const idIndex = new DataView(idHash.buffer).getUint32(0) % (2 ** 31)
  const derivationPath = `m/44'/236'/218'/${labelIndex}/${idIndex}`

  // Self-derivation: derive using own public key as "sender"
  const rootPrivKey = wifToPrivateKey(rootWif)
  const rootPubKey = privateKeyToPublicKey(rootPrivKey)
  const rootPubKeyHex = bytesToHex(rootPubKey)

  const result = deriveChildKey(rootWif, rootPubKeyHex, tagString)

  return {
    wif: result.wif,
    publicKey: result.pubKey,
    address: result.address,
    derivationPath,
  }
}

// ============================================
// BigInt ↔ Uint8Array Helpers
// ============================================

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]!)
  }
  return result
}

function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let value = n
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 0xFFn)
    value >>= 8n
  }
  return bytes
}
