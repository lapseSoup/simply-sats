/**
 * Account Management Service for Simply Sats
 *
 * Provides multi-account support with separate encrypted keys per account.
 * Each account has its own identity address, wallet keys, and settings.
 */

import { getDatabase } from './database'
import { withTransaction } from './database'
import { encrypt, decrypt, type EncryptedData } from './crypto'
import type { WalletKeys } from './wallet'
import { isUnprotectedData } from './wallet/types'
import { saveWallet, loadWallet } from './wallet/storage'
import type { AccountRow, AccountSettingRow, IdCheckRow } from '../infrastructure/database/row-types'
import { validatePassword } from '../utils/passwordValidation'
import { accountLogger } from './logger'
import { SECURITY } from '../config'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import { type Result, ok, err } from '../domain/types'
import { DbError } from './errors'

// Account type
export interface Account {
  id?: number
  name: string
  identityAddress: string
  encryptedKeys: string
  isActive: boolean
  createdAt: number
  lastAccessedAt?: number
  derivationIndex?: number
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
  displayInSats: true,
  feeRateKB: 100,
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
    accountLogger.info('Tables will be created by migration')
  }
}

/**
 * Create a new account
 */
export async function createAccount(
  name: string,
  keys: WalletKeys,
  password: string | null,
  useLegacyRequirements = false,
  derivationIndex?: number
): Promise<Result<number, DbError>> {
  // Password is optional — when null, keys are stored unprotected
  if (password !== null) {
    if (useLegacyRequirements) {
      // Legacy migration path: accept existing passwords with old 12-char minimum.
      // The UI already validated these when they were originally created.
      if (password.length < 12) {
        throw new Error('Password must be at least 12 characters')
      }
    } else {
      const validation = validatePassword(password)
      if (!validation.isValid) {
        throw new Error(validation.errors.join('. '))
      }
    }
  }

  const database = getDatabase()

  const keysObj = {
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
  }

  let encryptedKeysStr: string
  try {
    if (password !== null) {
      const encryptedData = await encrypt(JSON.stringify(keysObj), password)
      encryptedKeysStr = JSON.stringify(encryptedData)
    } else {
      // Unprotected mode — store plaintext in structured format
      encryptedKeysStr = JSON.stringify({ version: 0, mode: 'unprotected', keys: keysObj })
    }

    // Deactivate all existing accounts
    await database.execute('UPDATE accounts SET is_active = 0')

    // Insert new account as active
    const result = await database.execute(
      `INSERT INTO accounts (name, identity_address, encrypted_keys, is_active, created_at, last_accessed_at, derivation_index)
       VALUES ($1, $2, $3, 1, $4, $4, $5)`,
      [name, keys.identityAddress, encryptedKeysStr, Date.now(), derivationIndex ?? null]
    )

    const accountId = result.lastInsertId as number
    accountLogger.info('Created account', { name, accountId })

    // Set default settings for new account
    await setAccountSettings(accountId, DEFAULT_ACCOUNT_SETTINGS)

    return ok(accountId)
  } catch (e) {
    accountLogger.error('Failed to create account', e, { name })
    return err(new DbError(
      `createAccount failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
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
      lastAccessedAt: row.last_accessed_at ?? undefined,
      derivationIndex: row.derivation_index ?? undefined
    }))
  } catch (e) {
    // Table may not exist yet, or database query failed
    accountLogger.error('Failed to load accounts', e)
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

    const row = rows[0]!
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: true,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      derivationIndex: row.derivation_index ?? undefined
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

    const row = rows[0]!
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      derivationIndex: row.derivation_index ?? undefined
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

    const row = rows[0]!
    return {
      id: row.id,
      name: row.name,
      identityAddress: row.identity_address,
      encryptedKeys: row.encrypted_keys,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      derivationIndex: row.derivation_index ?? undefined
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
    // Two sequential UPDATEs without withTransaction() — avoids deadlocking
    // when sync operations hold the transaction queue.  SQLite auto-commits
    // each statement; worst case is a partial update (two accounts active)
    // which self-heals on next switch.
    await database.execute('UPDATE accounts SET is_active = 0 WHERE is_active = 1')
    await database.execute(
      'UPDATE accounts SET is_active = 1, last_accessed_at = $1 WHERE id = $2',
      [Date.now(), accountId]
    )

    accountLogger.info('Switched to account', { accountId })
    return true
  } catch (e) {
    accountLogger.error('Failed to switch account', e, { accountId })
    return false
  }
}

/**
 * Decrypt and retrieve wallet keys for an account
 */
export async function getAccountKeys(
  account: Account,
  password: string | null
): Promise<WalletKeys | null> {
  try {
    const parsed = JSON.parse(account.encryptedKeys)

    // Check for unprotected format first
    if (isUnprotectedData(parsed)) {
      return parsed.keys
    }

    // Encrypted format — password required
    if (!password || password.trim().length === 0) {
      accountLogger.error('Password is required to decrypt account keys')
      return null
    }

    const encryptedData = parsed as EncryptedData
    const keysJson = await decrypt(encryptedData, password)

    // Lazy PBKDF2 migration: re-encrypt with current iterations if outdated
    if (encryptedData.iterations < SECURITY.PBKDF2_ITERATIONS && account.id) {
      try {
        const newEncrypted = await encrypt(keysJson, password)
        const database = getDatabase()
        await database.execute(
          'UPDATE accounts SET encrypted_keys = $1 WHERE id = $2',
          [JSON.stringify(newEncrypted), account.id]
        )
        accountLogger.info('Migrated PBKDF2 iterations', {
          accountId: account.id,
          from: encryptedData.iterations,
          to: newEncrypted.iterations
        })
      } catch (migrationError) {
        // Non-fatal: keys decrypted fine, re-encryption retried next unlock
        accountLogger.warn('Failed to migrate PBKDF2 iterations', { error: String(migrationError) })
      }
    }

    const keys = JSON.parse(keysJson)
    return keys as WalletKeys
  } catch (e) {
    accountLogger.error('Failed to decrypt keys', e)
    return null
  }
}

/**
 * Update account name
 */
export async function updateAccountName(accountId: number, name: string): Promise<Result<void, DbError>> {
  const database = getDatabase()

  try {
    await database.execute(
      'UPDATE accounts SET name = $1 WHERE id = $2',
      [name, accountId]
    )
    return ok(undefined)
  } catch (e) {
    accountLogger.error('Failed to update account name', e, { accountId })
    return err(new DbError(
      `updateAccountName failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Delete an account
 * Returns ok(false) if the account cannot be deleted (only account remaining).
 * Returns ok(true) on successful deletion.
 * Returns err(DbError) on database failure.
 */
export async function deleteAccount(accountId: number): Promise<Result<boolean, DbError>> {
  const database = getDatabase()

  try {
    // Check if this is the only account
    const accounts = await getAllAccounts()
    if (accounts.length <= 1) {
      accountLogger.error('Cannot delete the only account')
      return ok(false)
    }

    // Check if this is the active account
    const account = await getAccountById(accountId)
    const wasActive = account?.isActive

    // Delete all account-scoped data atomically
    await withTransaction(async () => {
      // Delete in dependency order (children before parents)
      await database.execute('DELETE FROM transaction_labels WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM transactions WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM locks WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM utxos WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM ordinal_cache WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM derived_addresses WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM account_settings WHERE account_id = $1', [accountId])
      await database.execute('DELETE FROM accounts WHERE id = $1', [accountId])
    })

    // If deleted account was active, activate another one
    if (wasActive) {
      const remaining = await getAllAccounts()
      if (remaining.length > 0) {
        await switchAccount(remaining[0]!.id!)
      }
    }

    accountLogger.info('Deleted account', { accountId })
    return ok(true)
  } catch (e) {
    accountLogger.error('Failed to delete account', e, { accountId })
    return err(new DbError(
      `deleteAccount failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
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
 * Called when upgrading from old version or creating new wallets
 * Uses legacy password requirements (12 chars min) since the UI validates this already
 */
export async function migrateToMultiAccount(
  existingKeys: WalletKeys,
  password: string | null
): Promise<number | null> {
  try {
    // Check if already migrated
    const accounts = await getAllAccounts()
    const existingAccount = accounts.find(a => a.identityAddress === existingKeys.identityAddress)

    if (existingAccount) {
      // Backfill derivation index for legacy primary accounts.
      if (existingAccount.id && existingAccount.derivationIndex === undefined) {
        try {
          const database = getDatabase()
          await database.execute(
            'UPDATE accounts SET derivation_index = $1 WHERE id = $2 AND derivation_index IS NULL',
            [0, existingAccount.id]
          )
          accountLogger.info('Backfilled derivation index for existing account', {
            accountId: existingAccount.id,
            derivationIndex: 0
          })
        } catch (backfillErr) {
          accountLogger.warn('Failed to backfill derivation index', {
            accountId: existingAccount.id,
            error: String(backfillErr)
          })
        }
      }
      accountLogger.info('Account already exists, skipping migration')
      return existingAccount.id!
    }

    // Create account for existing wallet using legacy password requirements
    // The UI has already validated the password meets minimum requirements
    const result = await createAccount('Account 1', existingKeys, password, true, 0)
    if (!result.ok) {
      accountLogger.error('Failed to create account during migration', result.error)
      return null
    }
    accountLogger.info('Migrated existing wallet to account system')

    return result.value
  } catch (e) {
    accountLogger.error('Migration failed', e)
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

/**
 * Retroactively encrypt all unprotected accounts with a password.
 * Called when user sets a password in Settings after initially skipping it.
 * Atomic — if any account fails, throws and makes no changes.
 */
export async function encryptAllAccounts(password: string): Promise<void> {
  const validation = validatePassword(password)
  if (!validation.isValid) {
    throw new Error(validation.errors.join('. '))
  }

  const accounts = await getAllAccounts()
  const updates: { accountId: number; encryptedKeysStr: string }[] = []

  // Phase 1: Encrypt all unprotected accounts (no DB writes yet)
  for (const account of accounts) {
    const parsed = JSON.parse(account.encryptedKeys)
    if (isUnprotectedData(parsed)) {
      const keysJson = JSON.stringify(parsed.keys)
      const encryptedData = await encrypt(keysJson, password)
      updates.push({
        accountId: account.id!,
        encryptedKeysStr: JSON.stringify(encryptedData)
      })
    }
  }

  if (updates.length === 0) {
    accountLogger.info('No unprotected accounts to encrypt')
    return
  }

  // Phase 2: Write all updates atomically
  const database = getDatabase()
  await withTransaction(async () => {
    for (const { accountId, encryptedKeysStr } of updates) {
      await database.execute(
        'UPDATE accounts SET encrypted_keys = $1 WHERE id = $2',
        [encryptedKeysStr, accountId]
      )
    }
  })

  // Phase 3: Re-encrypt the secure storage blob (wallet's primary key store)
  try {
    const currentKeys = await loadWallet(null)
    if (currentKeys) {
      await saveWallet(currentKeys, password)
      // saveWallet already sets HAS_PASSWORD = 'true'
    } else {
      accountLogger.warn('Could not load wallet keys for secure storage re-encryption')
      localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'true')
    }
  } catch (storageError) {
    // DB rows are already encrypted — log warning but don't fail
    accountLogger.warn('Failed to re-encrypt secure storage blob', { error: String(storageError) })
    localStorage.setItem(STORAGE_KEYS.HAS_PASSWORD, 'true')
  }

  accountLogger.info('Encrypted all accounts', { count: updates.length })
}
