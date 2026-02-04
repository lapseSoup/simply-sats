/**
 * Pure validation functions for wallet operations
 * No side effects, no external API calls
 */

import * as bip39 from 'bip39'

export interface MnemonicValidationResult {
  isValid: boolean
  normalizedMnemonic?: string
  error?: string
}

/**
 * Normalize mnemonic: lowercase, trim, collapse multiple spaces
 * Pure function
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Validate a mnemonic phrase
 * Returns normalized mnemonic if valid, error message if not
 * Pure function
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
 * Validate a BSV address (basic format check)
 * Pure function - does not verify on-chain
 */
export function isValidBSVAddress(address: string): boolean {
  if (!address || address.length < 26 || address.length > 35) {
    return false
  }

  // BSV addresses start with 1 (P2PKH) or 3 (P2SH)
  if (!address.startsWith('1') && !address.startsWith('3')) {
    return false
  }

  // Base58 character set (no 0, O, I, l)
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/
  return base58Regex.test(address)
}

/**
 * Validate a transaction ID (64 hex characters)
 * Pure function
 */
export function isValidTxid(txid: string): boolean {
  if (!txid || txid.length !== 64) {
    return false
  }
  return /^[0-9a-fA-F]{64}$/.test(txid)
}

/**
 * Validate satoshi amount
 * Pure function
 */
export function isValidSatoshiAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= 21_000_000_00_000_000
}
