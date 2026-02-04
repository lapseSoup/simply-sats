/**
 * Account Management Service for Simply Sats
 *
 * Provides multi-account support with separate encrypted keys per account.
 * Each account has its own identity address, wallet keys, and settings.
 */

import { getDatabase } from './database'
import { encrypt, decrypt, type EncryptedData } from './crypto'
import type { WalletKeys } from './wallet'
import type { AccountRow, AccountSettingRow, IdCheckRow } from './database-types'
import { validatePassword, DEFAULT_PASSWORD_REQUIREMENTS, LEGACY_PASSWORD_REQUIREMENTS } from './password-validation'

// Account type
export interface Account {
  id?: number
  name: string
  identityAddress: string
  encryptedKeys: string
  isActive: boolean
  createdAt: number
  lastAccessedAt?: number
}

// Account settings type
export interface AccountSettings {
  displayInSats: boolean
  feeRateKB: number
  autoLockMinutes: number
  trustedOrigins: string[]
}

// Default settings for new accounts
export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  displayInSats: false,
  feeRateKB: 50,
  autoLockMinutes: 10,
  trustedOrigins: []
}

/**
 * Ensure accounts tables exist (run migration check)
 */
export async function ensureAccountsTables(): Promise<void> {
  const database = getDatabase()

  try {
    // Check if accounts table exists
    await database.select<IdCheckRow[]>('SELECT id FROM accounts LIMIT 1')
  } catch {
    // Tables don't exist yet - they'll be created by migration
    console.log('[Accounts] Tables will be created by migration')
  }
}

/**
 * Create a new account
 */
export async function createAccount(
  name: string,
  keys: WalletKeys,
  password: string,
  useLegacyRequirements = false
): Promise<number> {
  // Password is required - no unencrypted storage allowed
  if (!password) {
    throw new Error('Password is required for wallet encryption')
  }

  // Validate password against requirements
  const requirements = useLegacyRequirements ? LEGACY_PASSWORD_REQUIREMENTS : DEFAULT_PASSWORD_REQUIREMENTS
  const validation = validatePassword(password, requirements)
  if (!validation.isValid) {
    throw new Error(validation.errors.join('. '))
  }

  const database = getDatabase()

  // Encrypt the wallet keys
  const keysJson = JSON.stringify({
    mnemonic: keys.mnemonic,
    walletWif: keys.walletWif,
    walletAddress: keys.walletAddress,
    walletPubKey: keys.walletPubKey,
    ordWif: keys.ordWif,
    ordAddress: keys.ordAddress,
    ordPubKey: keys.ordPubKey,
    identityWif: keys.identityWif,
    identityAddress: keys.identityAddress,
    identityPubKey: keys.identityPubKey
  })

  // Always encrypt - password is required (validated above)
  const encryptedData = await encrypt(keysJson, password)
  const encryptedKeysStr = JSON.stringify(encryptedData)

  // Deactivate all existing accounts
  await database.execute('UPDATE accounts SET is_active = 0')

  // Insert new account as active
  const result = await database.execute(
    `INSERT INTO accounts (name, identity_address, encrypted_keys, is_active, created_at, last_accessed_at)
     VALUES ($1, $2, $3, 1, $4, $4)`,
    [name, keys.identityAddress, encryptedKeysStr, Date.now()]
  )

  const accountId = result.lastInsertId as number
  console.log(`[Accounts] Created account "${name}" with ID ${accountId}`)

  // Set default settings for new account
  await setAccountSettings(accountId, DEFAULT_ACCOUNT_SETTINGS)

  return accountId
}

/**
 * Get all accounts
 */
export async function getAllAccounts(): Promise<Account[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountRow[]>(
      'SELECT * FROM accounts ORDER BY last_accessed_at DESC'
    )

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined
    }))
  } catch (_e) {
    // Table may not exist yet
    console.log('[Accounts] No accounts table yet')
    return []
  }
}

/**
 * Get the active account
 */
export async function getActiveAccount(): Promise<Account | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountRow[]>(
      'SELECT * FROM accounts WHERE is_active = 1 LIMIT 1'
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: true,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined
    }
  } catch (_e) {
    return null
  }
}

/**
 * Get an account by ID
 */
export async function getAccountById(accountId: number): Promise<Account | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountRow[]>(
      'SELECT * FROM accounts WHERE id = $1',
      [accountId]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined
    }
  } catch (_e) {
    return null
  }
}

/**
 * Get account by identity address
 */
export async function getAccountByIdentity(identityAddress: string): Promise<Account | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountRow[]>(
      'SELECT * FROM accounts WHERE identity_address = $1',
      [identityAddress]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined
    }
  } catch (_e) {
    return null
  }
}

/**
 * Switch to a different account
 */
export async function switchAccount(accountId: number): Promise<boolean> {
  const database = getDatabase()

  try {
    // Deactivate all accounts
    await database.execute('UPDATE accounts SET is_active = 0')

    // Activate the selected account
    await database.execute(
      'UPDATE accounts SET is_active = 1, last_accessed_at = $1 WHERE id = $2',
      [Date.now(), accountId]
    )

    console.log(`[Accounts] Switched to account ID ${accountId}`)
    return true
  } catch (e) {
    console.error('[Accounts] Failed to switch account:', e)
    return false
  }
}

/**
 * Decrypt and retrieve wallet keys for an account
 */
export async function getAccountKeys(
  account: Account,
  password: string
): Promise<WalletKeys | null> {
  try {
    // Try to decrypt (or parse if not encrypted)
    let keysJson: string

    if (password) {
      // Try to parse as encrypted data
      try {
        const encryptedData = JSON.parse(account.encryptedKeys) as EncryptedData
        keysJson = await decrypt(encryptedData, password)
      } catch {
        // Might not be encrypted, try parsing directly
        keysJson = account.encryptedKeys
      }
    } else {
      // No password, should be unencrypted
      keysJson = account.encryptedKeys
    }

    const keys = JSON.parse(keysJson)
    return keys as WalletKeys
  } catch (e) {
    console.error('[Accounts] Failed to decrypt keys:', e)
    return null
  }
}

/**
 * Update account name
 */
export async function updateAccountName(accountId: number, name: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE accounts SET name = $1 WHERE id = $2',
    [name, accountId]
  )
}

/**
 * Delete an account
 */
export async function deleteAccount(accountId: number): Promise<boolean> {
  const database = getDatabase()

  try {
    // Check if this is the only account
    const accounts = await getAllAccounts()
    if (accounts.length <= 1) {
      console.error('[Accounts] Cannot delete the only account')
      return false
    }

    // Check if this is the active account
    const account = await getAccountById(accountId)
    const wasActive = account?.isActive

    // Delete account-specific data
    await database.execute('DELETE FROM account_settings WHERE account_id = $1', [accountId])

    // Delete the account
    await database.execute('DELETE FROM accounts WHERE id = $1', [accountId])

    // If deleted account was active, activate another one
    if (wasActive) {
      const remaining = await getAllAccounts()
      if (remaining.length > 0) {
        await switchAccount(remaining[0].id!)
      }
    }

    console.log(`[Accounts] Deleted account ID ${accountId}`)
    return true
  } catch (e) {
    console.error('[Accounts] Failed to delete account:', e)
    return false
  }
}

/**
 * Get settings for an account
 */
export async function getAccountSettings(accountId: number): Promise<AccountSettings> {
  const database = getDatabase()

  try {
    const rows = await database.select<AccountSettingRow[]>(
      'SELECT setting_key, setting_value FROM account_settings WHERE account_id = $1',
      [accountId]
    )

    const settings = { ...DEFAULT_ACCOUNT_SETTINGS }

    for (const row of rows) {
      const key = row.setting_key as keyof AccountSettings
      const value = row.setting_value

      if (key === 'displayInSats') {
        settings.displayInSats = value === 'true'
      } else if (key === 'feeRateKB') {
        settings.feeRateKB = parseInt(value, 10)
      } else if (key === 'autoLockMinutes') {
        settings.autoLockMinutes = parseInt(value, 10)
      } else if (key === 'trustedOrigins') {
        settings.trustedOrigins = JSON.parse(value || '[]')
      }
    }

    return settings
  } catch (_e) {
    return DEFAULT_ACCOUNT_SETTINGS
  }
}

/**
 * Set settings for an account
 */
export async function setAccountSettings(
  accountId: number,
  settings: Partial<AccountSettings>
): Promise<void> {
  const database = getDatabase()

  for (const [key, value] of Object.entries(settings)) {
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

    await database.execute(
      `INSERT OR REPLACE INTO account_settings (account_id, setting_key, setting_value)
       VALUES ($1, $2, $3)`,
      [accountId, key, stringValue]
    )
  }
}

/**
 * Update a single setting
 */
export async function updateAccountSetting<K extends keyof AccountSettings>(
  accountId: number,
  key: K,
  value: AccountSettings[K]
): Promise<void> {
  await setAccountSettings(accountId, { [key]: value } as Partial<AccountSettings>)
}

/**
 * Migrate existing single-account wallet to multi-account system
 * Called when upgrading from old version
 */
export async function migrateToMultiAccount(
  existingKeys: WalletKeys,
  password: string
): Promise<number | null> {
  try {
    // Check if already migrated
    const accounts = await getAllAccounts()
    const existingAccount = accounts.find(a => a.identityAddress === existingKeys.identityAddress)

    if (existingAccount) {
      console.log('[Accounts] Account already exists, skipping migration')
      return existingAccount.id!
    }

    // Create account for existing wallet
    const accountId = await createAccount('Account 1', existingKeys, password)
    console.log('[Accounts] Migrated existing wallet to account system')

    return accountId
  } catch (e) {
    console.error('[Accounts] Migration failed:', e)
    return null
  }
}

/**
 * Get next account number for naming
 */
export async function getNextAccountNumber(): Promise<number> {
  const accounts = await getAllAccounts()
  return accounts.length + 1
}

/**
 * Export all accounts (for backup)
 */
export async function exportAllAccounts(): Promise<Account[]> {
  return getAllAccounts()
}

/**
 * Check if account system is initialized
 */
export async function isAccountSystemInitialized(): Promise<boolean> {
  const accounts = await getAllAccounts()
  return accounts.length > 0
}
