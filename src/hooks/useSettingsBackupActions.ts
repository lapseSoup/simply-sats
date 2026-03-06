import { useCallback } from 'react'
import { exportDatabase, exportDatabaseFull, importDatabase, type DatabaseBackup } from '../infrastructure/database'
import { decrypt, type EncryptedData } from '../services/crypto'
import { NO_PASSWORD } from '../services/sessionPasswordStore'
import { isTauri, tauriInvoke } from '../utils/tauri'
import type { ActiveWallet } from '../domain/types'
import { buildBrowserEncryptedDatabaseBackup } from '../services/browserSecretExports'

export type SettingsDatabaseBackup = DatabaseBackup
export type BackupType = 'essential' | 'full'

type ImportBackupParseResult =
  | { ok: true; backup: DatabaseBackup; stats: { utxos: number; transactions: number } }
  | { ok: false; error: string }

export function useSettingsBackupActions() {
  const sessionNeedsBackupPassword = useCallback((sessionPassword: string | null) => {
    return sessionPassword === null || sessionPassword === NO_PASSWORD
  }, [])

  const buildEncryptedBackupJson = useCallback(async (
    wallet: ActiveWallet,
    password: string,
    type: BackupType
  ): Promise<string> => {
    const dbBackup = type === 'full' ? await exportDatabaseFull() : await exportDatabase()
    const encrypted = isTauri()
      ? await tauriInvoke<EncryptedData>('build_encrypted_backup_from_store', {
        password,
        walletAddress: wallet.walletAddress,
        ordAddress: wallet.ordAddress,
        identityPubKey: wallet.identityPubKey,
        database: dbBackup
      })
      : await buildBrowserEncryptedDatabaseBackup(wallet, password, dbBackup)

    return JSON.stringify({
      format: 'simply-sats-backup-encrypted',
      version: 1,
      encrypted
    }, null, 2)
  }, [])

  const parseImportedBackupJson = useCallback(async (
    json: string,
    sessionPassword: string | null
  ): Promise<ImportBackupParseResult> => {
    const raw = JSON.parse(json) as Record<string, unknown>

    let backup: Record<string, unknown>
    if (raw.format === 'simply-sats-backup-encrypted' && raw.encrypted) {
      if (sessionPassword === null) {
        return { ok: false, error: 'Session password not available — try locking and unlocking first' }
      }

      try {
        const decryptedJson = await decrypt(raw.encrypted as EncryptedData, sessionPassword)
        backup = JSON.parse(decryptedJson) as Record<string, unknown>
      } catch {
        return { ok: false, error: 'Failed to decrypt backup — wrong password?' }
      }
    } else {
      backup = raw
    }

    if (backup.format !== 'simply-sats-full' || !backup.database) {
      return { ok: false, error: 'Invalid backup format' }
    }

    const databaseBackup = backup.database as DatabaseBackup
    return {
      ok: true,
      backup: databaseBackup,
      stats: {
        utxos: databaseBackup.utxos.length,
        transactions: databaseBackup.transactions.length,
      }
    }
  }, [])

  const importBackupData = useCallback(async (backup: DatabaseBackup) => {
    await importDatabase(backup)
  }, [])

  return {
    sessionNeedsBackupPassword,
    buildEncryptedBackupJson,
    parseImportedBackupJson,
    importBackupData,
  }
}
