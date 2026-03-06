import { useCallback } from 'react'
import { decrypt, type EncryptedData } from '../services/crypto'
import {
  importBackupDatabase,
  openAndParseBackupFile,
  restoreWalletFromBackup,
  type FullBackup,
  type RestoreImportCallbacks,
} from '../services/restore'

type JsonRestoreResult =
  | { ok: true; value: string }
  | { ok: false; error: string }

export function useRestoreOperations() {
  const resolveJsonRestorePayload = useCallback(async (
    restoreJson: string,
    password: string | null
  ): Promise<JsonRestoreResult> => {
    try {
      const parsed = JSON.parse(restoreJson) as Record<string, unknown>
      if (parsed.format === 'simply-sats-keys-encrypted' && parsed.encrypted) {
        if (!password) {
          return { ok: false, error: 'Encrypted backup requires a password to decrypt' }
        }

        try {
          const decrypted = await decrypt(parsed.encrypted as EncryptedData, password)
          return { ok: true, value: decrypted }
        } catch {
          return { ok: false, error: 'Failed to decrypt backup — wrong password?' }
        }
      }
    } catch {
      return { ok: true, value: restoreJson }
    }

    return { ok: true, value: restoreJson }
  }, [])

  const openParsedBackupFile = useCallback(async (password: string | null) => {
    return openAndParseBackupFile(password)
  }, [])

  const restoreWalletKeysFromBackup = useCallback(async (
    backup: FullBackup,
    password: string | null
  ) => {
    return restoreWalletFromBackup(backup, password)
  }, [])

  const importParsedBackupDatabase = useCallback(async (
    backup: FullBackup,
    password: string | null,
    callbacks: RestoreImportCallbacks
  ) => {
    return importBackupDatabase(backup, password, callbacks)
  }, [])

  return {
    resolveJsonRestorePayload,
    openParsedBackupFile,
    restoreWalletKeysFromBackup,
    importParsedBackupDatabase,
  }
}
