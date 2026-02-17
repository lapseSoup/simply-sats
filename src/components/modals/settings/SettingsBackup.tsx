import { useState, useCallback } from 'react'
import { save, open } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
import {
  Save,
  Download,
  ChevronRight
} from 'lucide-react'
import { useWallet } from '../../../contexts/WalletContext'
import { useUI } from '../../../contexts/UIContext'
import { exportDatabase, exportDatabaseFull, importDatabase, type DatabaseBackup } from '../../../services/database'
import { encrypt, decrypt, type EncryptedData } from '../../../services/crypto'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { BackupRecoveryModal } from '../BackupRecoveryModal'
import { handleKeyDown } from './settingsKeyDown'

export function SettingsBackup() {
  const { wallet, sessionPassword, performSync } = useWallet()
  const { showToast } = useUI()

  const [showBackupRecovery, setShowBackupRecovery] = useState(false)
  const [showImportConfirm, setShowImportConfirm] = useState<{ utxos: number; transactions: number } | null>(null)
  const [pendingImportBackup, setPendingImportBackup] = useState<DatabaseBackup | null>(null)

  const handleExportEssentialBackup = useCallback(async () => {
    if (!wallet || sessionPassword === null) {
      showToast('Session password not available \u2014 try locking and unlocking first', 'warning')
      return
    }
    try {
      const dbBackup = await exportDatabase()
      // Retrieve WIFs from key store for backup (WIFs needed in backup file)
      const { getWifForOperation } = await import('../../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'exportBackup', wallet)
      const walletWif = await getWifForOperation('wallet', 'exportBackup', wallet)
      const ordWif = await getWifForOperation('ordinals', 'exportBackup', wallet)

      // Fetch mnemonic from Rust key store for backup (doesn't clear it)
      const mnemonic = await invoke<string | null>('get_mnemonic')

      const fullBackup = {
        format: 'simply-sats-full',
        wallet: {
          mnemonic: mnemonic || null,
          keys: {
            identity: { wif: identityWif, pubKey: wallet.identityPubKey },
            payment: { wif: walletWif, address: wallet.walletAddress },
            ordinals: { wif: ordWif, address: wallet.ordAddress }
          }
        },
        database: dbBackup
      }
      const encrypted = await encrypt(JSON.stringify(fullBackup), sessionPassword)
      const encryptedBackup = {
        format: 'simply-sats-backup-encrypted',
        version: 1,
        encrypted
      }
      const backupJson = JSON.stringify(encryptedBackup, null, 2)
      const filePath = await save({
        defaultPath: `simply-sats-backup-essential-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, backupJson)
        showToast('Essential backup saved!')
      }
    } catch (err) {
      console.error('Backup failed:', err)
      showToast(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [wallet, sessionPassword, showToast])

  const handleExportFullBackup = useCallback(async () => {
    if (!wallet || sessionPassword === null) {
      showToast('Session password not available \u2014 try locking and unlocking first', 'warning')
      return
    }
    try {
      showToast('Exporting full backup (including ordinal content)...')
      const dbBackup = await exportDatabaseFull()
      // Retrieve WIFs from key store for backup
      const { getWifForOperation } = await import('../../../services/wallet')
      const identityWif = await getWifForOperation('identity', 'exportFullBackup', wallet)
      const walletWif = await getWifForOperation('wallet', 'exportFullBackup', wallet)
      const ordWif = await getWifForOperation('ordinals', 'exportFullBackup', wallet)

      // Fetch mnemonic from Rust key store for backup (doesn't clear it)
      const mnemonic = await invoke<string | null>('get_mnemonic')

      const fullBackup = {
        format: 'simply-sats-full',
        wallet: {
          mnemonic: mnemonic || null,
          keys: {
            identity: { wif: identityWif, pubKey: wallet.identityPubKey },
            payment: { wif: walletWif, address: wallet.walletAddress },
            ordinals: { wif: ordWif, address: wallet.ordAddress }
          }
        },
        database: dbBackup
      }
      const encrypted = await encrypt(JSON.stringify(fullBackup), sessionPassword)
      const encryptedBackup = {
        format: 'simply-sats-backup-encrypted',
        version: 1,
        encrypted
      }
      const backupJson = JSON.stringify(encryptedBackup, null, 2)
      const filePath = await save({
        defaultPath: `simply-sats-backup-full-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, backupJson)
        showToast('Full backup saved!')
      }
    } catch (err) {
      console.error('Backup failed:', err)
      showToast(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [wallet, sessionPassword, showToast])

  const handleImportBackup = useCallback(async () => {
    try {
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false
      })
      if (!filePath || Array.isArray(filePath)) return
      const json = await readTextFile(filePath)
      const raw = JSON.parse(json)

      let backup
      if (raw.format === 'simply-sats-backup-encrypted' && raw.encrypted) {
        if (sessionPassword === null) {
          showToast('Session password not available \u2014 try locking and unlocking first', 'warning')
          return
        }
        try {
          const decrypted = await decrypt(raw.encrypted as EncryptedData, sessionPassword)
          backup = JSON.parse(decrypted)
        } catch {
          showToast('Failed to decrypt backup \u2014 wrong password?', 'error')
          return
        }
      } else {
        backup = raw
      }

      if (backup.format !== 'simply-sats-full' || !backup.database) {
        showToast('Invalid backup format', 'error')
        return
      }
      setPendingImportBackup(backup.database as DatabaseBackup)
      setShowImportConfirm({ utxos: backup.database.utxos.length, transactions: backup.database.transactions.length })
    } catch (err) {
      console.error('Import failed:', err)
      showToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [sessionPassword, showToast])

  const executeImportBackup = useCallback(async () => {
    if (pendingImportBackup) {
      await importDatabase(pendingImportBackup)
      showToast('Backup imported!')
      performSync(false)
      setPendingImportBackup(null)
    }
    setShowImportConfirm(null)
  }, [pendingImportBackup, performSync, showToast])

  if (!wallet) return null

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">Backup</div>
        <div className="settings-card">
          <div className="settings-row" role="button" tabIndex={0} onClick={handleExportEssentialBackup} onKeyDown={handleKeyDown(handleExportEssentialBackup)} aria-label="Export essential backup">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Save size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Export Essential</div>
                <div className="settings-row-value">Keys + transactions (restores with sync)</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
          <div className="settings-row" role="button" tabIndex={0} onClick={handleExportFullBackup} onKeyDown={handleKeyDown(handleExportFullBackup)} aria-label="Export full backup">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Save size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Export Full</div>
                <div className="settings-row-value">Everything + ordinal content</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
          <div className="settings-row" role="button" tabIndex={0} onClick={handleImportBackup} onKeyDown={handleKeyDown(handleImportBackup)} aria-label="Import backup">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Download size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Import Backup</div>
                <div className="settings-row-value">Restore from file</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
          <div className="settings-row" role="button" tabIndex={0} onClick={() => setShowBackupRecovery(true)} onKeyDown={handleKeyDown(() => setShowBackupRecovery(true))} aria-label="Recover from backup">
            <div className="settings-row-left">
              <div className="settings-row-icon" aria-hidden="true"><Download size={16} strokeWidth={1.75} /></div>
              <div className="settings-row-content">
                <div className="settings-row-label">Recover from Backup</div>
                <div className="settings-row-value">Import old wallet accounts</div>
              </div>
            </div>
            <span className="settings-row-arrow" aria-hidden="true"><ChevronRight size={16} strokeWidth={1.75} /></span>
          </div>
        </div>
      </div>

      {showBackupRecovery && (
        <BackupRecoveryModal onClose={() => setShowBackupRecovery(false)} />
      )}

      {showImportConfirm && (
        <ConfirmationModal
          title="Import Backup"
          message={`Import ${showImportConfirm.utxos} UTXOs and ${showImportConfirm.transactions} transactions?`}
          type="info"
          confirmText="Import"
          cancelText="Cancel"
          onConfirm={executeImportBackup}
          onCancel={() => { setShowImportConfirm(null); setPendingImportBackup(null) }}
        />
      )}
    </>
  )
}
