/**
 * Wallet storage operations
 * Save, load, and manage wallet persistence
 *
 * Security: Uses Tauri secure storage when available (desktop app),
 * falls back to localStorage for web builds.
 */

import { invoke } from '@tauri-apps/api/core'
import { isUnprotectedData, type UnprotectedWalletData, type WalletKeys } from './types'
import { encrypt, decrypt, isEncryptedData, isLegacyEncrypted, migrateLegacyData, type EncryptedData } from '../crypto'
import { walletLogger } from '../logger'
import { STORAGE_KEYS } from '../../infrastructure/storage/localStorage'
import { type Result, ok, err } from '../../domain/types'
import { validatePassword } from '../../utils/passwordValidation'

const STORAGE_KEY = STORAGE_KEYS.WALLET

/**
 * Check if wallet has password protection.
 * Reads from localStorage flag — synchronous, no async needed.
 * Defaults to true (safe for existing wallets without the flag).
 */
export function hasPassword(): boolean {
  return localStorage.getItem(STORAGE_KEYS.HAS_PASSWORD) !== 'false'
}

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

    // Read-back verification: confirm the data was actually persisted.
    // A silent save failure would leave the only copy in localStorage (plaintext).
    const exists = await invoke<boolean>('secure_storage_exists')
    if (!exists) {
      walletLogger.error('SECURITY: Secure storage save reported success but read-back check failed')
      return false
    }

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
 * Save wallet keys WITHOUT encryption — plaintext in OS keychain.
 * Used when user skips password during setup.
 */
export async function saveWalletUnprotected(keys: WalletKeys): Promise<void> {
  const data: UnprotectedWalletData = {
    version: 0,
    mode: 'unprotected',
    keys
  }

  const savedSecurely = await saveToSecureStorage(data as unknown as EncryptedData)

  if (savedSecurely) {
    localStorage.removeItem(STORAGE_KEY)
    walletLogger.info('Wallet saved to secure storage (unprotected mode)')
  } else {
    // S-39 SECURITY WARNING: In web/dev builds, wallet keys are stored as plaintext
    // JSON in localStorage. This is intentional for development convenience but means
    // keys are readable by any script on the same origin and persist unencrypted on
    // disk. Desktop builds use Tauri secure storage (OS keychain) instead.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    walletLogger.info('Wallet saved to localStorage (unprotected mode)')
  }

  localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'false')
}

/**
 * Save wallet keys with proper AES-GCM encryption
 *
 * @param keys - Wallet keys to save
 * @param password - Password for encryption
 */
export async function saveWallet(keys: WalletKeys, password: string): Promise<Result<void, string>> {
  const validation = validatePassword(password)
  if (!validation.isValid) {
    return err(validation.errors.join('. '))
  }

  try {
    const encryptedData = await encrypt(keys, password)

    // Try to save to secure storage first (Tauri desktop)
    const savedSecurely = await saveToSecureStorage(encryptedData)

    if (savedSecurely) {
      // Also remove from localStorage if it was there (migration complete)
      localStorage.removeItem(STORAGE_KEY)
      walletLogger.info('Wallet saved to secure storage')
    } else {
      // S-39 SECURITY WARNING: In web/dev builds, encrypted wallet data is stored in
      // localStorage. While the keys themselves are AES-GCM encrypted, the ciphertext
      // is accessible to any script on the same origin. Desktop builds use Tauri
      // secure storage (OS keychain) instead.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
      walletLogger.info('Wallet saved to localStorage')
    }

    localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'true')
    return ok(undefined)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

/**
 * Load wallet keys with decryption
 *
 * Handles both new encrypted format and legacy base64 format.
 * If legacy format is detected, it will be migrated to the new format.
 *
 * @param password - Password for decryption (null for unprotected wallets)
 * @returns WalletKeys or null if not found
 * @throws Error if password is wrong or data is corrupted
 */
export async function loadWallet(password: string | null): Promise<Result<WalletKeys | null, string>> {
  try {
    // Try secure storage first (Tauri desktop)
    const secureData = await loadFromSecureStorage()
    if (secureData) {
      // Check for unprotected format (version 0)
      if (isUnprotectedData(secureData)) {
        return ok(secureData.keys)
      }
      // Encrypted format — need password
      if (!password) {
        return err('Password required for encrypted wallet')
      }
      const decrypted = await decrypt(secureData, password)
      return ok(JSON.parse(decrypted))
    }

    // Fall back to localStorage
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return ok(null)

    try {
      // Try to parse as JSON (new format)
      const parsed = JSON.parse(stored)

      // Check for unprotected format (version 0)
      if (isUnprotectedData(parsed)) {
        return ok(parsed.keys)
      }

      if (isEncryptedData(parsed)) {
        // Encrypted format — need password
        if (!password) {
          return err('Password required for encrypted wallet')
        }
        // New encrypted format - decrypt it
        const decrypted = await decrypt(parsed, password)
        const keys = JSON.parse(decrypted) as WalletKeys

        // Migrate to secure storage if available
        const migrated = await migrateToSecureStorage(stored)
        if (migrated) {
          localStorage.removeItem(STORAGE_KEY)
          walletLogger.info('Wallet migrated from localStorage to secure storage')
        }

        return ok(keys)
      }

      // If it's a plain object with wallet keys — this is a security violation
      // (raw plaintext keys without the version 0 wrapper)
      if (parsed.mnemonic && parsed.walletWif) {
        walletLogger.error('SECURITY: Unencrypted wallet data found in localStorage. Removing.')
        localStorage.removeItem(STORAGE_KEY)
        return err('Wallet data was stored without encryption. Please restore using your mnemonic.')
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

        // SECURITY: Remove plaintext base64 from localStorage immediately,
        // before attempting re-encryption. Even if re-encryption fails,
        // the plaintext must not remain on disk.
        localStorage.removeItem(STORAGE_KEY)
        walletLogger.warn('Removed legacy base64 wallet data from localStorage')

        // Migrate to new encrypted format (legacy wallets always had passwords)
        if (!password) {
          return err('Password required for legacy wallet migration')
        }
        const encryptedData = await migrateLegacyData(stored, password)

        // Try to save to secure storage
        const savedSecurely = await saveToSecureStorage(encryptedData)
        if (savedSecurely) {
          walletLogger.info('Wallet migrated to secure storage')
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(encryptedData))
          walletLogger.info('Wallet migrated to new encrypted format')
        }

        return ok(keys)
      } catch {
        // Legacy decoding failed
        return err('Failed to load wallet - data may be corrupted')
      }
    }

    return ok(null)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
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
 * Clear wallet from storage
 */
export async function clearWallet(): Promise<void> {
  // Clear from both storages
  await clearSecureStorage()
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
export async function changePassword(oldPassword: string, newPassword: string): Promise<Result<boolean, string>> {
  const validation = validatePassword(newPassword)
  if (!validation.isValid) {
    return err(validation.errors.join('. '))
  }

  const loadResult = await loadWallet(oldPassword)
  if (!loadResult.ok) {
    return err(loadResult.error)
  }
  const keys = loadResult.value
  if (!keys) {
    return err('Wrong password or wallet not found')
  }

  const saveResult = await saveWallet(keys, newPassword)
  if (!saveResult.ok) {
    return err(saveResult.error)
  }

  // S-12: Rotate the session key so that any cached BRC-100 session tokens
  // derived from the old password are invalidated.
  try {
    await invoke('rotate_session_for_account', { accountId: 0 })
  } catch (e) {
    walletLogger.warn('Failed to rotate session key after password change', { error: String(e) })
  }

  return ok(true)
}
