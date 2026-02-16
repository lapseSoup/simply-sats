import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { SECURITY } from '../../config'
import { Modal } from '../shared/Modal'
import { PasswordInput } from '../shared/PasswordInput'
import { MnemonicInput } from '../forms/MnemonicInput'
import { restoreWallet, importFromJSON } from '../../services/wallet'
import { importDatabase, type DatabaseBackup } from '../../services/database'
import { decrypt, type EncryptedData } from '../../services/crypto'
import { setWalletKeys } from '../../services/brc100'
import { saveWallet } from '../../services/wallet'
import { migrateToMultiAccount, getActiveAccount } from '../../services/accounts'
import { discoverAccounts } from '../../services/accountDiscovery'

interface RestoreModalProps {
  onClose: () => void
  onSuccess: () => void
}

type RestoreMode = 'mnemonic' | 'json' | 'fullbackup'

export function RestoreModal({ onClose, onSuccess }: RestoreModalProps) {
  const { setWallet, performSync, handleRestoreWallet, handleImportJSON, refreshAccounts } = useWalletActions()
  const { showToast } = useUI()
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const validatePassword = (): boolean => {
    if (password.length < SECURITY.MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${SECURITY.MIN_PASSWORD_LENGTH} characters`)
      return false
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return false
    }
    setPasswordError('')
    return true
  }

  const handleRestoreFromMnemonic = async () => {
    if (!validatePassword()) return
    try {
      const words = restoreMnemonic.trim().split(/\s+/)
      if (words.length !== 12) {
        showToast('Please enter exactly 12 words', 'warning')
        return
      }
      const success = await handleRestoreWallet(restoreMnemonic.trim(), password)
      if (success) {
        onSuccess()
        // Account discovery is now deferred until after initial sync completes
        // (handled by App.tsx auto-sync effect via WalletContext.consumePendingDiscovery)
      } else {
        showToast('Failed to restore wallet', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid mnemonic. Please check your words.', 'error')
    }
  }

  const handleRestoreFromJSON = async () => {
    if (!validatePassword()) return
    try {
      let jsonToImport = restoreJSON
      // Check if the pasted JSON is an encrypted key export
      try {
        const parsed = JSON.parse(restoreJSON)
        if (parsed.format === 'simply-sats-keys-encrypted' && parsed.encrypted) {
          const decrypted = await decrypt(parsed.encrypted as EncryptedData, password)
          jsonToImport = decrypted
        }
      } catch {
        // Not valid JSON or decryption failed — let handleImportJSON handle the error
      }
      const success = await handleImportJSON(jsonToImport, password)
      if (success) {
        onSuccess()
      } else {
        showToast('Failed to import wallet', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid JSON backup. Please check the format.', 'error')
    }
  }

  const handleRestoreFromFullBackup = async () => {
    if (!validatePassword()) return
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
        // Encrypted backup — decrypt with the password the user entered
        try {
          const decrypted = await decrypt(raw.encrypted as EncryptedData, password)
          backup = JSON.parse(decrypted)
        } catch {
          showToast('Failed to decrypt backup — wrong password?', 'error')
          return
        }
      } else {
        backup = raw
      }

      if (backup.format !== 'simply-sats-full' || !backup.wallet) {
        showToast('Invalid backup format. This should be a Simply Sats full backup file.', 'error')
        return
      }

      // Restore wallet from backup with password
      if (backup.wallet.mnemonic) {
        const keys = await restoreWallet(backup.wallet.mnemonic)
        await saveWallet(keys, password)
        // Create account in database for persistence across app restarts
        await migrateToMultiAccount({ ...keys, mnemonic: backup.wallet.mnemonic }, password)
        setWallet({ ...keys, mnemonic: backup.wallet.mnemonic })
        setWalletKeys(keys)
      } else if (backup.wallet.keys) {
        const keys = await importFromJSON(JSON.stringify(backup.wallet.keys))
        await saveWallet(keys, password)
        // Create account in database for persistence across app restarts
        await migrateToMultiAccount(keys, password)
        setWallet(keys)
        setWalletKeys(keys)
      } else {
        showToast('Backup does not contain wallet keys.', 'error')
        return
      }

      // Import database if present
      if (backup.database) {
        await importDatabase(backup.database as DatabaseBackup)
      }

      showToast(`Wallet restored! ${backup.database?.utxos?.length || 0} UTXOs, ${backup.database?.transactions?.length || 0} transactions`)

      // Trigger sync to update balances
      performSync(false)
      onSuccess()

      // Discover additional accounts if mnemonic is available (non-blocking)
      if (backup.wallet.mnemonic) {
        const activeAfterRestore = await getActiveAccount()
        discoverAccounts(backup.wallet.mnemonic, password, activeAfterRestore?.id)
          .then(async (found) => {
            if (found > 0) {
              await refreshAccounts()
              showToast(`Discovered ${found} additional account${found > 1 ? 's' : ''}`)
            }
          })
          .catch(() => {}) // Silent failure — primary restore already succeeded
      }
    } catch (err) {
      showToast('Import failed: ' + (err instanceof Error ? err.message : 'Invalid file'), 'error')
    }
  }

  return (
    <Modal onClose={onClose} title="Restore Wallet">
      <div className="modal-content">
        <div className="pill-tabs" role="tablist" aria-label="Restore method">
            <button
              id="restore-tab-mnemonic"
              className={`pill-tab ${restoreMode === 'mnemonic' ? 'active' : ''}`}
              onClick={() => setRestoreMode('mnemonic')}
              role="tab"
              aria-selected={restoreMode === 'mnemonic'}
              aria-controls="restore-panel-mnemonic"
            >
              Seed Phrase
            </button>
            <button
              id="restore-tab-json"
              className={`pill-tab ${restoreMode === 'json' ? 'active' : ''}`}
              onClick={() => setRestoreMode('json')}
              role="tab"
              aria-selected={restoreMode === 'json'}
              aria-controls="restore-panel-json"
            >
              JSON Backup
            </button>
            <button
              id="restore-tab-fullbackup"
              className={`pill-tab ${restoreMode === 'fullbackup' ? 'active' : ''}`}
              onClick={() => setRestoreMode('fullbackup')}
              role="tab"
              aria-selected={restoreMode === 'fullbackup'}
              aria-controls="restore-panel-fullbackup"
            >
              Full Backup
            </button>
          </div>

          {restoreMode === 'mnemonic' && (
            <div id="restore-panel-mnemonic" role="tabpanel" aria-labelledby="restore-tab-mnemonic">
              <div className="form-group">
                <label className="form-label" htmlFor="restore-mnemonic">12-Word Recovery Phrase</label>
                <MnemonicInput
                  value={restoreMnemonic}
                  onChange={setRestoreMnemonic}
                  placeholder="Start typing your seed words..."
                />
                <div className="form-hint" id="mnemonic-hint">
                  Type each word and use arrow keys + Enter to select from suggestions
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="restore-password">Create Password</label>
                <PasswordInput
                  id="restore-password"
                  placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={setPassword}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="restore-confirm-password">Confirm Password</label>
                <PasswordInput
                  id="restore-confirm-password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
              </div>
              {passwordError && (
                <div className="form-error" role="alert">{passwordError}</div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromMnemonic}
                disabled={!restoreMnemonic.trim() || !password || !confirmPassword}
              >
                Restore Wallet
              </button>
            </div>
          )}

          {restoreMode === 'json' && (
            <div id="restore-panel-json" role="tabpanel" aria-labelledby="restore-tab-json">
              <div className="form-group">
                <label className="form-label" htmlFor="restore-json">Wallet Backup JSON</label>
                <textarea
                  id="restore-json"
                  className="form-input"
                  placeholder='{"mnemonic": "...", ...}'
                  value={restoreJSON}
                  onChange={e => setRestoreJSON(e.target.value)}
                  style={{ minHeight: 80 }}
                />
                <div className="form-hint">
                  Supports Shaullet, 1Sat Ordinals, and Simply Sats backups
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="json-password">Create Password</label>
                <PasswordInput
                  id="json-password"
                  placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={setPassword}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="json-confirm-password">Confirm Password</label>
                <PasswordInput
                  id="json-confirm-password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
              </div>
              {passwordError && (
                <div className="form-error" role="alert">{passwordError}</div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromJSON}
                disabled={!restoreJSON.trim() || !password || !confirmPassword}
              >
                Import Wallet
              </button>
            </div>
          )}

          {restoreMode === 'fullbackup' && (
            <div id="restore-panel-fullbackup" role="tabpanel" aria-labelledby="restore-tab-fullbackup">
              <div className="form-group">
                <label className="form-label">Full Backup File</label>
                <div className="form-hint" style={{ marginBottom: 12 }}>
                  Restore from a Simply Sats full backup file (.json) including wallet keys, UTXOs, and transaction history.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fullbackup-password">Create Password</label>
                <PasswordInput
                  id="fullbackup-password"
                  placeholder={`At least ${SECURITY.MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={setPassword}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fullbackup-confirm-password">Confirm Password</label>
                <PasswordInput
                  id="fullbackup-confirm-password"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
              </div>
              {passwordError && (
                <div className="form-error" role="alert">{passwordError}</div>
              )}
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromFullBackup}
                disabled={!password || !confirmPassword}
              >
                Select Backup File
              </button>
            </div>
          )}
        </div>
      </Modal>
  )
}
