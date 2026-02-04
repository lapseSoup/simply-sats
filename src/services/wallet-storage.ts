/**
 * Wallet Storage Service for Simply Sats
 *
 * Handles secure storage and retrieval of wallet keys.
 * Uses AES-GCM encryption with PBKDF2 key derivation.
 */

import type { WalletKeys } from './wallet'
import { encrypt, decrypt, isEncryptedData, isLegacyEncrypted, migrateLegacyData } from './crypto'

// Storage key in localStorage
const STORAGE_KEY = 'simply_sats_wallet'

/**
 * Save wallet keys with proper AES-GCM encryption
 *
 * @param keys - Wallet keys to save
 * @param password - Password for encryption
 */
export async function saveWallet(keys: WalletKeys, password: string): Promise<void> {
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters')
  }

  const encryptedData = await encrypt(keys, password)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
}

/**
 * Load wallet keys with decryption
 *
 * Handles both new encrypted format and legacy base64 format.
 * If legacy format is detected, it will be migrated to the new format.
 *
 * @param password - Password for decryption
 * @returns WalletKeys or null if not found
 * @throws Error if password is wrong or data is corrupted
 */
export async function loadWallet(password: string): Promise<WalletKeys | null> {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    // Try to parse as JSON (new format)
    const parsed = JSON.parse(stored)

    if (isEncryptedData(parsed)) {
      // New encrypted format - decrypt it
      const decrypted = await decrypt(parsed, password)
      return JSON.parse(decrypted)
    }

    // If it's a plain object with wallet keys (shouldn't happen, but handle it)
    if (parsed.mnemonic && parsed.walletWif) {
      console.warn('Found unencrypted wallet data - this should not happen')
      // Re-save with encryption
      await saveWallet(parsed, password)
      return parsed
    }
  } catch {
    // Not valid JSON - might be legacy format
  }

  // Try legacy base64 format
  if (isLegacyEncrypted(stored)) {
    console.log('Migrating legacy wallet format to secure encryption...')
    try {
      // Decode the old format
      const decoded = atob(stored)
      const keys = JSON.parse(decoded) as WalletKeys

      // Migrate to new encrypted format
      const encryptedData = await migrateLegacyData(stored, password)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))

      console.log('Wallet migrated to secure encryption successfully')
      return keys
    } catch {
      // Legacy decoding failed
      throw new Error('Failed to load wallet - data may be corrupted')
    }
  }

  return null
}

/**
 * Check if a wallet exists in storage
 */
export function hasWallet(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

/**
 * Clear wallet from storage
 */
export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Change the wallet password
 *
 * @param oldPassword - Current password
 * @param newPassword - New password
 * @returns true if successful
 * @throws Error if old password is wrong
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
  if (!newPassword || newPassword.length < 4) {
    throw new Error('New password must be at least 4 characters')
  }

  const keys = await loadWallet(oldPassword)
  if (!keys) {
    throw new Error('Wrong password or wallet not found')
  }

  await saveWallet(keys, newPassword)
  return true
}
