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
import { Utils } from '@bsv/sdk'

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

/**
 * Validate a BSV address format.
 *
 * Performs basic format validation:
 * - Length between 26-35 characters
 * - Starts with '1' (P2PKH) or '3' (P2SH)
 * - Contains only valid Base58 characters
 *
 * Note: This does NOT verify the address checksum or on-chain validity.
 * For full validation, use the @bsv/sdk Address class.
 *
 * @param address - BSV address to validate
 * @returns True if the address format is valid
 *
 * @example
 * ```typescript
 * isValidBSVAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')  // true
 * isValidBSVAddress('invalid')                              // false
 * isValidBSVAddress('0x1234...')                            // false (ETH format)
 * ```
 */
export function isValidBSVAddress(address: string): boolean {
  if (!address || address.length < 26 || address.length > 35) {
    return false
  }

  // BSV addresses start with 1 (P2PKH) or 3 (P2SH)
  if (!address.startsWith('1') && !address.startsWith('3')) {
    return false
  }

  // Validate checksum using Base58Check decoding
  // This catches single-character typos that would cause permanent fund loss
  try {
    const { prefix } = Utils.fromBase58Check(address)
    // Verify prefix matches expected address type (0 = P2PKH, 5 = P2SH)
    return prefix[0] === 0 || prefix[0] === 5
  } catch {
    return false
  }
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
