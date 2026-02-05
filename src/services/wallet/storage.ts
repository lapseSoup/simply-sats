/**
 * Wallet storage operations
 * Save, load, and manage wallet persistence
 *
 * Security: Uses Tauri secure storage when available (desktop app),
 * falls back to localStorage for web builds.
 */

import { invoke } from '@tauri-apps/api/core'
import type { WalletKeys } from './types'
import { encrypt, decrypt, isEncryptedData, isLegacyEncrypted, migrateLegacyData, type EncryptedData } from '../crypto'
import { walletLogger } from '../logger'
import { SECURITY } from '../../config'

const STORAGE_KEY = 'simply_sats_wallet'

/**
 * Check if we're running in Tauri environment
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Save encrypted data to Tauri secure storage
 */
async function saveToSecureStorage(data: EncryptedData): Promise<boolean> {
  if (!isTauri()) return false

  try {
    await invoke('secure_storage_save', { data })
    return true
  } catch (error) {
    walletLogger.error('Failed to save to secure storage', { error })
    return false
  }
}

/**
 * Load encrypted data from Tauri secure storage
 */
async function loadFromSecureStorage(): Promise<EncryptedData | null> {
  if (!isTauri()) return null

  try {
    const data = await invoke<EncryptedData | null>('secure_storage_load')
    return data
  } catch (error) {
    walletLogger.error('Failed to load from secure storage', { error })
    return null
  }
}

/**
 * Check if wallet exists in Tauri secure storage
 */
async function existsInSecureStorage(): Promise<boolean> {
  if (!isTauri()) return false

  try {
    return await invoke<boolean>('secure_storage_exists')
  } catch (error) {
    walletLogger.error('Failed to check secure storage', { error })
    return false
  }
}

/**
 * Clear wallet from Tauri secure storage
 */
async function clearSecureStorage(): Promise<boolean> {
  if (!isTauri()) return false

  try {
    await invoke('secure_storage_clear')
    return true
  } catch (error) {
    walletLogger.error('Failed to clear secure storage', { error })
    return false
  }
}

/**
 * Migrate data from localStorage to secure storage
 */
async function migrateToSecureStorage(data: string): Promise<boolean> {
  if (!isTauri()) return false

  try {
    const migrated = await invoke<boolean>('secure_storage_migrate', { legacyData: data })
    return migrated
  } catch (error) {
    walletLogger.error('Failed to migrate to secure storage', { error })
    return false
  }
}

/**
 * Save wallet keys with proper AES-GCM encryption
 *
 * @param keys - Wallet keys to save
 * @param password - Password for encryption
 */
export async function saveWallet(keys: WalletKeys, password: string): Promise<void> {
  if (!password || password.length < SECURITY.MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
  }

  const encryptedData = await encrypt(keys, password)

  // Try to save to secure storage first (Tauri desktop)
  const savedSecurely = await saveToSecureStorage(encryptedData)

  if (savedSecurely) {
    // Also remove from localStorage if it was there (migration complete)
    localStorage.removeItem(STORAGE_KEY)
    walletLogger.info('Wallet saved to secure storage')
  } else {
    // Fallback to localStorage (web build)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
    walletLogger.info('Wallet saved to localStorage')
  }
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
  // Try secure storage first (Tauri desktop)
  const secureData = await loadFromSecureStorage()
  if (secureData) {
    const decrypted = await decrypt(secureData, password)
    return JSON.parse(decrypted)
  }

  // Fall back to localStorage
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  try {
    // Try to parse as JSON (new format)
    const parsed = JSON.parse(stored)

    if (isEncryptedData(parsed)) {
      // New encrypted format - decrypt it
      const decrypted = await decrypt(parsed, password)
      const keys = JSON.parse(decrypted) as WalletKeys

      // Migrate to secure storage if available
      const migrated = await migrateToSecureStorage(stored)
      if (migrated) {
        localStorage.removeItem(STORAGE_KEY)
        walletLogger.info('Wallet migrated from localStorage to secure storage')
      }

      return keys
    }

    // If it's a plain object with wallet keys (shouldn't happen, but handle it)
    if (parsed.mnemonic && parsed.walletWif) {
      walletLogger.warn('Found unencrypted wallet data - this should not happen')
      // Re-save with encryption
      await saveWallet(parsed, password)
      return parsed
    }
  } catch (_e) {
    // Not valid JSON - might be legacy format
  }

  // Try legacy base64 format
  if (isLegacyEncrypted(stored)) {
    walletLogger.info('Migrating legacy wallet format to secure encryption...')
    try {
      // Decode the old format
      const decoded = atob(stored)
      const keys = JSON.parse(decoded) as WalletKeys

      // Migrate to new encrypted format
      const encryptedData = await migrateLegacyData(stored, password)

      // Try to save to secure storage
      const savedSecurely = await saveToSecureStorage(encryptedData)
      if (savedSecurely) {
        localStorage.removeItem(STORAGE_KEY)
        walletLogger.info('Wallet migrated to secure storage')
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
        walletLogger.info('Wallet migrated to new encrypted format')
      }

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
export async function hasWallet(): Promise<boolean> {
  // Check secure storage first
  const existsSecure = await existsInSecureStorage()
  if (existsSecure) return true

  // Fall back to localStorage
  return localStorage.getItem(STORAGE_KEY) !== null
}

/**
 * Synchronous version for backward compatibility
 * Note: This only checks localStorage, not secure storage
 * @deprecated Use hasWallet() async version instead
 */
export function hasWalletSync(): boolean {
  // This can only check localStorage - secure storage requires async
  return localStorage.getItem(STORAGE_KEY) !== null
}

/**
 * Clear wallet from storage
 */
export async function clearWallet(): Promise<void> {
  // Clear from both storages
  await clearSecureStorage()
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Synchronous version for backward compatibility
 * @deprecated Use clearWallet() async version instead
 */
export function clearWalletSync(): void {
  // This can only clear localStorage - secure storage requires async
  localStorage.removeItem(STORAGE_KEY)
  // Also try to clear secure storage in background
  clearSecureStorage().catch(() => {
    // Ignore errors - best effort
  })
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
  if (!newPassword || newPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
  }

  const keys = await loadWallet(oldPassword)
  if (!keys) {
    throw new Error('Wrong password or wallet not found')
  }

  await saveWallet(keys, newPassword)
  return true
}
