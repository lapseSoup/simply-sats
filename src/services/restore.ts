/**
 * Restore Service
 *
 * Business logic extracted from RestoreModal.tsx (A-41).
 * Handles full backup restore, including wallet key recovery,
 * database import, and account discovery.
 */

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { ok, err, type Result } from '../domain/types'
import type { WalletKeys } from '../domain/types'
import { restoreWallet, importFromJSON, saveWallet, saveWalletUnprotected } from './wallet'
import { importDatabase, type DatabaseBackup } from '../infrastructure/database'
import { decrypt, type EncryptedData } from './crypto'
import { setWalletKeys } from './brc100'
import { migrateToMultiAccount, getActiveAccount } from './accounts'
import { discoverAccounts } from './accountDiscovery'
import { setSessionPassword as setModuleSessionPassword } from './sessionPasswordStore'
import { walletLogger } from './logger'

// --- Types ---

export interface FullBackup {
  format: string
  wallet: {
    mnemonic?: string
    keys?: Record<string, unknown>
  }
  database?: DatabaseBackup
}

export interface RestoreCallbacks {
  setWallet: (keys: WalletKeys) => void
  setSessionPassword: (pwd: string) => void
  performSync: (force: boolean) => void
  refreshAccounts: () => Promise<void>
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void
}

export interface RestoreStats {
  utxoCount: number
  txCount: number
  discoveredAccounts: number
}

// --- Core restore logic ---

/**
 * Open a full backup file from disk, decrypt if needed, and validate format.
 * Returns the parsed backup or an error string.
 */
export async function openAndParseBackupFile(
  password: string | null
): Promise<Result<{ backup: FullBackup; setSkipPassword?: boolean }, string>> {
  const filePath = await open({
    filters: [{ name: 'JSON', extensions: ['json'] }],
    multiple: false
  })

  if (!filePath || Array.isArray(filePath)) {
    return err('cancelled')
  }

  const json = await readTextFile(filePath)
  const raw = JSON.parse(json) as Record<string, unknown>

  let backup: FullBackup
  if (raw.format === 'simply-sats-backup-encrypted' && raw.encrypted) {
    if (!password) {
      return err('encrypted-needs-password')
    }
    try {
      const decrypted = await decrypt(raw.encrypted as EncryptedData, password)
      backup = JSON.parse(decrypted) as FullBackup
    } catch {
      return err('decrypt-failed')
    }
  } else {
    backup = raw as unknown as FullBackup
  }

  if (backup.format !== 'simply-sats-full' || !backup.wallet) {
    return err('invalid-format')
  }

  return ok({ backup })
}

/**
 * Restore wallet keys from a parsed full backup.
 * Handles both mnemonic-based and key-based restores.
 */
export async function restoreWalletFromBackup(
  backup: FullBackup,
  password: string | null
): Promise<Result<WalletKeys, string>> {
  const sessionPwd = password ?? ''

  if (backup.wallet.mnemonic) {
    const restoreResult = await restoreWallet(backup.wallet.mnemonic)
    if (!restoreResult.ok) {
      return err('Failed to restore wallet: ' + restoreResult.error.message)
    }
    const keys = restoreResult.value
    if (password !== null) {
      const saveResult = await saveWallet(keys, password)
      if (!saveResult.ok) {
        return err('Failed to save wallet: ' + saveResult.error)
      }
    } else {
      await saveWalletUnprotected(keys)
    }
    await migrateToMultiAccount({ ...keys, mnemonic: backup.wallet.mnemonic }, password)
    try {
      await invoke('store_keys', { mnemonic: backup.wallet.mnemonic, accountIndex: 0 })
    } catch (e) {
      // B-89: Non-fatal but logged — unlock will re-populate Rust key store
      walletLogger.warn('Failed to store keys in Rust key store during restore', { error: e instanceof Error ? e.message : String(e) })
    }
    // Return keys with mnemonic cleared (mnemonic lives in Rust key store)
    const safeKeys = { ...keys, mnemonic: '' }
    setWalletKeys(safeKeys)
    setModuleSessionPassword(sessionPwd)
    return ok(safeKeys)
  }

  if (backup.wallet.keys) {
    const importResult = await importFromJSON(JSON.stringify(backup.wallet.keys))
    if (!importResult.ok) {
      return err('Failed to import wallet: ' + importResult.error.message)
    }
    const keys = importResult.value
    if (password !== null) {
      const saveResult = await saveWallet(keys, password)
      if (!saveResult.ok) {
        return err('Failed to save wallet: ' + saveResult.error)
      }
    } else {
      await saveWalletUnprotected(keys)
    }
    await migrateToMultiAccount(keys, password)
    try {
      if (keys.mnemonic) {
        await invoke('store_keys', { mnemonic: keys.mnemonic, accountIndex: keys.accountIndex ?? 0 })
      } else {
        await invoke('store_keys_direct', {
          walletWif: keys.walletWif,
          ordWif: keys.ordWif,
          identityWif: keys.identityWif,
          walletAddress: keys.walletAddress,
          walletPubKey: keys.walletPubKey,
          ordAddress: keys.ordAddress,
          ordPubKey: keys.ordPubKey,
          identityAddress: keys.identityAddress,
          identityPubKey: keys.identityPubKey,
          mnemonic: null
        })
      }
    } catch (e) {
      // B-89: Non-fatal but logged — unlock will re-populate Rust key store
      walletLogger.warn('Failed to store keys in Rust key store during restore', { error: e instanceof Error ? e.message : String(e) })
    }
    setWalletKeys(keys)
    setModuleSessionPassword(sessionPwd)
    return ok(keys)
  }

  return err('Backup does not contain wallet keys.')
}

/**
 * Import database records from backup and trigger account discovery.
 * Non-blocking discovery runs in background.
 */
export async function importBackupDatabase(
  backup: FullBackup,
  password: string | null,
  callbacks: Pick<RestoreCallbacks, 'refreshAccounts' | 'showToast'>
): Promise<RestoreStats> {
  const stats: RestoreStats = { utxoCount: 0, txCount: 0, discoveredAccounts: 0 }

  if (backup.database) {
    await importDatabase(backup.database)
    stats.utxoCount = backup.database.utxos?.length || 0
    stats.txCount = backup.database.transactions?.length || 0
  }

  // Discover additional accounts if mnemonic is available (non-blocking)
  if (backup.wallet.mnemonic) {
    const activeAfterRestore = await getActiveAccount()
    discoverAccounts(backup.wallet.mnemonic, password, activeAfterRestore?.id)
      .then(async (found) => {
        if (found > 0) {
          await callbacks.refreshAccounts()
          callbacks.showToast(`Discovered ${found} additional account${found > 1 ? 's' : ''}`)
        }
      })
      .catch((e) => {
        // B-90: Log discovery failures — primary restore already succeeded
        walletLogger.warn('Account discovery failed after restore', { error: e instanceof Error ? e.message : String(e) })
      })
  }

  return stats
}
