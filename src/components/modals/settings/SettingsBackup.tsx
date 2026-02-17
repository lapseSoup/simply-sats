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
import { NO_PASSWORD } from '../../../services/sessionPasswordStore'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { PasswordInput } from '../../shared/PasswordInput'
import { BackupRecoveryModal } from '../BackupRecoveryModal'
import { handleKeyDown } from './settingsKeyDown'
import { SECURITY } from '../../../config'

export function SettingsBackup() {
  const { wallet, sessionPassword, performSync } = useWallet()
  const { showToast } = useUI()

  const [showBackupRecovery, setShowBackupRecovery] = useState(false)
  const [showImportConfirm, setShowImportConfirm] = useState<{ utxos: number; transactions: number } | null>(null)
  const [pendingImportBackup, setPendingImportBackup] = useState<DatabaseBackup | null>(null)
  const [showBackupPasswordPrompt, setShowBackupPasswordPrompt] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  const [confirmBackupPassword, setConfirmBackupPassword] = useState('')
  const [backupPasswordError, setBackupPasswordError] = useState('')
  const [pendingBackupType, setPendingBackupType] = useState<'essential' | 'full' | null>(null)

  const executeBackupWithPassword = useCallback(async (password: string, type: 'essential' | 'full') => {
    try {
      if (type === 'full') showToast('Exporting full backup (including ordinal content)...')
      const dbBackup = type === 'full' ? await exportDatabaseFull() : await exportDatabase()
      const { getWifForOperation } = await import('../../../services/wallet')
      const operationName = type === 'full' ? 'exportFullBackup' : 'exportBackup'
      const identityWif = await getWifForOperation('identity', operationName, wallet!)
      const walletWif = await getWifForOperation('wallet', operationName, wallet!)
      const ordWif = await getWifForOperation('ordinals', operationName, wallet!)
      const mnemonic = await invoke<string | null>('get_mnemonic')

      const fullBackup = {
        format: 'simply-sats-full',
        wallet: {
          mnemonic: mnemonic || null,
          keys: {
            identity: { wif: identityWif, pubKey: wallet!.identityPubKey },
            payment: { wif: walletWif, address: wallet!.walletAddress },
            ordinals: { wif: ordWif, address: wallet!.ordAddress }
          }
        },
        database: dbBackup
      }
      const encrypted = await encrypt(JSON.stringify(fullBackup), password)
      const encryptedBackup = {
        format: 'simply-sats-backup-encrypted',
        version: 1,
        encrypted
      }
      const backupJson = JSON.stringify(encryptedBackup, null, 2)
      const suffix = type === 'full' ? 'full' : 'essential'
      const filePath = await save({
        defaultPath: `simply-sats-backup-${suffix}-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeTextFile(filePath, backupJson)
        showToast(type === 'full' ? 'Full backup saved!' : 'Essential backup saved!')
      }
    } catch (err) {
      console.error('Backup failed:', err)
      showToast(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [wallet, showToast])

  const handleExportEssentialBackup = useCallback(async () => {
    if (!wallet) return
    if (sessionPassword === null || sessionPassword === NO_PASSWORD) {
      setPendingBackupType('essential')
      setShowBackupPasswordPrompt(true)
      return
    }
    await executeBackupWithPassword(sessionPassword, 'essential')
  }, [wallet, sessionPassword, executeBackupWithPassword])

  const handleExportFullBackup = useCallback(async () => {
    if (!wallet) return
    if (sessionPassword === null || sessionPassword === NO_PASSWORD) {
      setPendingBackupType('full')
      setShowBackupPasswordPrompt(true)
      return
    }
    await executeBackupWithPassword(sessionPassword, 'full')
  }, [wallet, sessionPassword, executeBackupWithPassword])

  const handleBackupWithPassword = useCallback(async () => {
    if (backupPassword.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setBackupPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (backupPassword !== confirmBackupPassword) {
      setBackupPasswordError('Passwords do not match')
      return
    }
    if (pendingBackupType) {
      await executeBackupWithPassword(backupPassword, pendingBackupType)
    }
    setShowBackupPasswordPrompt(false)
    setBackupPassword('')
    setConfirmBackupPassword('')
    setBackupPasswordError('')
    setPendingBackupType(null)
  }, [backupPassword, confirmBackupPassword, pendingBackupType, executeBackupWithPassword])

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

      {showBackupPasswordPrompt && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="backup-pwd-title">
          <div className="modal-container modal-sm">
            <h3 className="modal-title" id="backup-pwd-title">Backup Password</h3>
            <p className="modal-text">
              Enter a password to protect your backup file. You will need this password to restore from it.
            </p>
            <div className="form-group">
              <label className="form-label">Password</label>
              <PasswordInput
                id="backup-password-input"
                value={backupPassword}
                onChange={setBackupPassword}
                placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <PasswordInput
                id="backup-password-confirm-input"
                value={confirmBackupPassword}
                onChange={setConfirmBackupPassword}
                placeholder="Confirm password"
              />
            </div>
            {backupPasswordError && <div className="form-error" role="alert">{backupPasswordError}</div>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => {
                setShowBackupPasswordPrompt(false)
                setBackupPassword('')
                setConfirmBackupPassword('')
                setBackupPasswordError('')
                setPendingBackupType(null)
              }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBackupWithPassword} disabled={!backupPassword || !confirmBackupPassword}>
                Export Backup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
