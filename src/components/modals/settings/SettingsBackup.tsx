import { useState, useCallback } from 'react'
import { saveFileDialog, openFileDialog } from '../../../utils/dialog'
import { writeFile, readFile } from '../../../utils/fs'
import {
  Save,
  Download,
  ChevronRight
} from 'lucide-react'
import { useWalletState, useWalletActions } from '../../../contexts'
import { useUI } from '../../../contexts/UIContext'
import { logger } from '../../../services/logger'
import {
  useSettingsBackupActions,
  type SettingsDatabaseBackup
} from '../../../hooks/useSettingsBackupActions'
import { ConfirmationModal } from '../../shared/ConfirmationModal'
import { PasswordInput } from '../../shared/PasswordInput'
import { BackupRecoveryModal } from '../BackupRecoveryModal'
import { handleKeyDown } from './settingsKeyDown'
import { SECURITY } from '../../../config'

export function SettingsBackup() {
  const { wallet, sessionPassword } = useWalletState()
  const { performSync } = useWalletActions()
  const { showToast } = useUI()
  const {
    sessionNeedsBackupPassword,
    buildEncryptedBackupJson,
    parseImportedBackupJson,
    importBackupData,
  } = useSettingsBackupActions()

  const [showBackupRecovery, setShowBackupRecovery] = useState(false)
  const [showImportConfirm, setShowImportConfirm] = useState<{ utxos: number; transactions: number } | null>(null)
  const [pendingImportBackup, setPendingImportBackup] = useState<SettingsDatabaseBackup | null>(null)
  const [showBackupPasswordPrompt, setShowBackupPasswordPrompt] = useState(false)
  const [backupPassword, setBackupPassword] = useState('')
  const [confirmBackupPassword, setConfirmBackupPassword] = useState('')
  const [backupPasswordError, setBackupPasswordError] = useState('')
  const [pendingBackupType, setPendingBackupType] = useState<'essential' | 'full' | null>(null)

  const executeBackupWithPassword = useCallback(async (password: string, type: 'essential' | 'full') => {
    try {
      if (type === 'full') showToast('Exporting full backup (including ordinal content)...')
      const backupJson = await buildEncryptedBackupJson(wallet!, password, type)
      const suffix = type === 'full' ? 'full' : 'essential'
      const filePath = await saveFileDialog({
        defaultPath: `simply-sats-backup-${suffix}-${new Date().toISOString().split('T')[0]}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (filePath) {
        await writeFile(filePath, backupJson)
        showToast(type === 'full' ? 'Full backup saved!' : 'Essential backup saved!')
      }
    } catch (err) {
      logger.error('Backup failed', err)
      showToast(`Backup failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [wallet, showToast, buildEncryptedBackupJson])

  const handleExportEssentialBackup = useCallback(async () => {
    if (!wallet) return
    if (sessionNeedsBackupPassword(sessionPassword)) {
      setPendingBackupType('essential')
      setShowBackupPasswordPrompt(true)
      return
    }
    await executeBackupWithPassword(sessionPassword, 'essential')
  }, [wallet, sessionPassword, executeBackupWithPassword, sessionNeedsBackupPassword])

  const handleExportFullBackup = useCallback(async () => {
    if (!wallet) return
    if (sessionNeedsBackupPassword(sessionPassword)) {
      setPendingBackupType('full')
      setShowBackupPasswordPrompt(true)
      return
    }
    await executeBackupWithPassword(sessionPassword, 'full')
  }, [wallet, sessionPassword, executeBackupWithPassword, sessionNeedsBackupPassword])

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
      const filePath = await openFileDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!filePath) return
      const json = await readFile(filePath)
      const parsed = await parseImportedBackupJson(json, sessionPassword)
      if (!parsed.ok) {
        showToast(parsed.error, parsed.error.includes('Session password') ? 'warning' : 'error')
        return
      }

      setPendingImportBackup(parsed.backup)
      setShowImportConfirm(parsed.stats)
    } catch (err) {
      logger.error('Import failed', err)
      showToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [sessionPassword, showToast, parseImportedBackupJson])

  const executeImportBackup = useCallback(async () => {
    if (pendingImportBackup) {
      await importBackupData(pendingImportBackup)
      showToast('Backup imported!')
      performSync(false)
      setPendingImportBackup(null)
    }
    setShowImportConfirm(null)
  }, [pendingImportBackup, performSync, showToast, importBackupData])

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
