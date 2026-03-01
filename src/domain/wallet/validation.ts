/**
 * Pure Validation Functions
 *
 * This module provides pure validation functions for wallet operations.
 * All functions are deterministic with no side effects or external API calls.
 *
 * These validators check format and structure only - they do not verify
 * data against the blockchain or any external service.
 *
 * @module domain/wallet/validation
 */

import * as bip39 from 'bip39'

/**
 * Result of mnemonic validation.
 */
export interface MnemonicValidationResult {
  /** Whether the mnemonic is valid */
  isValid: boolean
  /** Normalized mnemonic if valid (lowercase, single spaces) */
  normalizedMnemonic?: string
  /** Error message if invalid */
  error?: string
}

/**
 * Normalize a mnemonic phrase for consistent comparison.
 *
 * Normalizes by:
 * - Converting to lowercase
 * - Trimming leading/trailing whitespace
 * - Collapsing multiple spaces to single spaces
 *
 * @param mnemonic - Raw mnemonic phrase
 * @returns Normalized mnemonic string
 *
 * @example
 * ```typescript
 * normalizeMnemonic('  Abandon ABANDON  abandon ')
 * // Returns: 'abandon abandon abandon'
 * ```
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Validate a BIP-39 mnemonic phrase.
 *
 * Checks that the mnemonic:
 * - Has exactly 12 or 24 words
 * - Uses valid BIP-39 wordlist words
 * - Has a valid checksum
 *
 * Returns the normalized mnemonic if valid, or an error message if not.
 *
 * @param mnemonic - Mnemonic phrase to validate
 * @returns Validation result with normalized mnemonic or error
 *
 * @example
 * ```typescript
 * const result = validateMnemonic('abandon abandon abandon ... about')
 * if (result.isValid) {
 *   console.log(result.normalizedMnemonic) // Use normalized version
 * } else {
 *   console.error(result.error)
 * }
 * ```
 */
export function validateMnemonic(mnemonic: string): MnemonicValidationResult {
  const normalized = normalizeMnemonic(mnemonic)
  const words = normalized.split(' ')

  if (words.length !== 12 && words.length !== 24) {
    return {
      isValid: false,
      error: `Invalid mnemonic phrase. Expected 12 or 24 words but got ${words.length}.`
    }
  }

  if (!bip39.validateMnemonic(normalized)) {
    return {
      isValid: false,
      error: 'Invalid mnemonic phrase. Please check your words.'
    }
  }

  return {
    isValid: true,
    normalizedMnemonic: normalized
  }
}

// Base58 alphabet — excludes visually ambiguous chars (0, O, I, l)
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BASE58_REGEX = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

/**
 * Validate a BSV address format.
 *
 * Performs format validation:
 * - Length between 26-35 characters
 * - Starts with '1' (P2PKH) or '3' (P2SH)
 * - Contains only valid Base58 characters
 * - Base58Check checksum verification (catches typos that would cause fund loss)
 *
 * @param address - BSV address to validate
 * @returns True if the address format is valid
 */
export function isValidBSVAddress(address: string): boolean {
  if (!address || address.length < 26 || address.length > 35) {
    return false
  }

  // BSV addresses start with 1 (P2PKH) or 3 (P2SH)
  if (!address.startsWith('1') && !address.startsWith('3')) {
    return false
  }

  // Only valid Base58 characters
  if (!BASE58_REGEX.test(address)) {
    return false
  }

  // Base58Check decode + checksum verification
  try {
    const decoded = base58Decode(address)
    if (decoded.length < 5) return false

    // Checksum = last 4 bytes
    const payload = decoded.slice(0, -4)
    const checksum = decoded.slice(-4)

    // SHA-256d of payload — compute using simple implementation
    const hash = sha256d(payload)
    // First 4 bytes of hash must match checksum
    for (let i = 0; i < 4; i++) {
      if (hash[i] !== checksum[i]) return false
    }

    // Verify prefix: 0 = P2PKH, 5 = P2SH
    return payload[0] === 0 || payload[0] === 5
  } catch {
    return false
  }
}

/** Decode a Base58 string to bytes */
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0]
  for (const char of str) {
    const value = BASE58_CHARS.indexOf(char)
    if (value < 0) throw new Error('Invalid Base58 character')
    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // Leading '1's = leading zero bytes
  for (const char of str) {
    if (char !== '1') break
    bytes.push(0)
  }
  return new Uint8Array(bytes.reverse())
}

/** Double SHA-256 using pure-JS (no dependencies) */
function sha256d(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

/** SHA-256 implementation (FIPS 180-4) */
function sha256(data: Uint8Array): Uint8Array {
  const K: readonly number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  // Padding
  const bitLen = data.length * 8
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, bitLen, false)

  const w = new Int32Array(64)
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i-15]!, 7) ^ rotr(w[i-15]!, 18) ^ (w[i-15]! >>> 3))
      const s1 = (rotr(w[i-2]!, 17) ^ rotr(w[i-2]!, 19) ^ (w[i-2]! >>> 10))
      w[i] = (w[i-16]! + s0 + w[i-7]! + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + temp1) | 0
      d = c; c = b; b = a; a = (temp1 + temp2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }

  const result = new Uint8Array(32)
  const rv = new DataView(result.buffer)
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false)
  rv.setUint32(8, h2, false); rv.setUint32(12, h3, false)
  rv.setUint32(16, h4, false); rv.setUint32(20, h5, false)
  rv.setUint32(24, h6, false); rv.setUint32(28, h7, false)
  return result
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/**
 * Validate a transaction ID format.
 *
 * Transaction IDs (txids) are 32-byte SHA-256 hashes represented as
 * 64 hexadecimal characters.
 *
 * @param txid - Transaction ID to validate
 * @returns True if the txid format is valid
 *
 * @example
 * ```typescript
 * isValidTxid('abc123...')  // true if 64 hex chars
 * isValidTxid('abc')        // false (too short)
 * isValidTxid('xyz...')     // false (invalid hex)
 * ```
 */
export function isValidTxid(txid: string): boolean {
  if (!txid || txid.length !== 64) {
    return false
  }
  return /^[0-9a-fA-F]{64}$/.test(txid)
}

/**
 * Validate a satoshi amount.
 *
 * Valid amounts must be:
 * - A positive integer
 * - Less than or equal to the maximum supply (21 million BSV = 2.1 quadrillion satoshis)
 *
 * @param amount - Amount in satoshis to validate
 * @returns True if the amount is valid
 *
 * @example
 * ```typescript
 * isValidSatoshiAmount(1000)           // true
 * isValidSatoshiAmount(0)              // false (not positive)
 * isValidSatoshiAmount(1.5)            // false (not integer)
 * isValidSatoshiAmount(-100)           // false (negative)
 * ```
 */
export function isValidSatoshiAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= 21_000_000_00_000_000
}
