import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useWalletActions } from '../../contexts'
import { useUI } from '../../contexts/UIContext'
import { SECURITY } from '../../config'
import { Modal } from '../shared/Modal'
import { PasswordInput } from '../shared/PasswordInput'
import { MnemonicInput } from '../forms/MnemonicInput'
import { restoreWallet, importFromJSON, saveWallet, saveWalletUnprotected } from '../../services/wallet'
import { importDatabase, type DatabaseBackup } from '../../infrastructure/database'
import { decrypt, type EncryptedData } from '../../services/crypto'
import { setWalletKeys } from '../../services/brc100'
import { migrateToMultiAccount, getActiveAccount } from '../../services/accounts'
import { discoverAccounts } from '../../services/accountDiscovery'
import { setSessionPassword as setModuleSessionPassword } from '../../services/sessionPasswordStore'

interface RestoreModalProps {
  onClose: () => void
  onSuccess: () => void
}

type RestoreMode = 'mnemonic' | 'json' | 'fullbackup'

export function RestoreModal({ onClose, onSuccess }: RestoreModalProps) {
  const { setWallet, setSessionPassword, performSync, handleRestoreWallet, handleImportJSON, refreshAccounts } = useWalletActions()
  const { showToast } = useUI()
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [skipPassword, setSkipPassword] = useState(false)
  const [showSkipWarning, setShowSkipWarning] = useState(false)

  const validatePasswordFields = (): boolean => {
    if (skipPassword) return true
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

  const handleRestoreFromMnemonic = async (overrideSkip?: boolean) => {
    const willSkip = overrideSkip ?? skipPassword
    if (!willSkip && !validatePasswordFields()) return
    try {
      const words = restoreMnemonic.trim().split(/\s+/)
      if (words.length !== 12 && words.length !== 24) {
        showToast('Please enter exactly 12 or 24 words', 'warning')
        return
      }
      const pwd = willSkip ? null : password
      const success = await handleRestoreWallet(restoreMnemonic.trim(), pwd)
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
    if (!validatePasswordFields()) return
    try {
      let jsonToImport = restoreJSON
      const pwd = skipPassword ? null : password
      // Check if the pasted JSON is an encrypted key export
      try {
        const parsed = JSON.parse(restoreJSON)
        if (parsed.format === 'simply-sats-keys-encrypted' && parsed.encrypted) {
          if (!pwd) {
            showToast('Encrypted backup requires a password to decrypt', 'error')
            return
          }
          const decrypted = await decrypt(parsed.encrypted as EncryptedData, pwd)
          jsonToImport = decrypted
        }
      } catch (_decryptErr) {
        // If it was explicitly marked as encrypted, decryption failure is a real error
        try {
          const check = JSON.parse(restoreJSON)
          if (check.format === 'simply-sats-keys-encrypted') {
            showToast('Failed to decrypt backup — wrong password?', 'error')
            return
          }
        } catch { /* not JSON at all, let handleImportJSON deal with it */ }
      }
      const success = await handleImportJSON(jsonToImport, pwd)
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
    if (!validatePasswordFields()) return
    try {
      const filePath = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false
      })

      if (!filePath || Array.isArray(filePath)) return

      const json = await readTextFile(filePath)
      const raw = JSON.parse(json)
      const pwd = skipPassword ? null : password

      let backup
      if (raw.format === 'simply-sats-backup-encrypted' && raw.encrypted) {
        // Encrypted backup — need a password to decrypt
        if (!pwd) {
          showToast('This backup file is encrypted. Please enter a password above to decrypt it.', 'error')
          setSkipPassword(false)
          return
        }
        try {
          const decrypted = await decrypt(raw.encrypted as EncryptedData, pwd)
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

      const sessionPwd = pwd ?? ''

      // Restore wallet from backup with password
      if (backup.wallet.mnemonic) {
        const restoreResult = await restoreWallet(backup.wallet.mnemonic)
        if (!restoreResult.ok) {
          showToast('Failed to restore wallet: ' + restoreResult.error.message, 'error')
          return
        }
        const keys = restoreResult.value
        if (pwd !== null) {
          const saveResult = await saveWallet(keys, pwd)
          if (!saveResult.ok) {
            showToast('Failed to save wallet: ' + saveResult.error, 'error')
            return
          }
        } else {
          await saveWalletUnprotected(keys)
        }
        // Create account in database for persistence across app restarts
        await migrateToMultiAccount({ ...keys, mnemonic: backup.wallet.mnemonic }, pwd)
        // Populate the Rust key store so WIF operations work immediately after restore
        try {
          await invoke('store_keys', { mnemonic: backup.wallet.mnemonic, accountIndex: 0 })
        } catch (_e) { /* non-fatal — unlock will re-populate */ }
        // Store keys in React state WITHOUT mnemonic (mnemonic lives in Rust key store)
        setWallet({ ...keys, mnemonic: '' })
        setWalletKeys(keys)
        setSessionPassword(sessionPwd)
        setModuleSessionPassword(sessionPwd)
      } else if (backup.wallet.keys) {
        const importResult = await importFromJSON(JSON.stringify(backup.wallet.keys))
        if (!importResult.ok) {
          showToast('Failed to import wallet: ' + importResult.error.message, 'error')
          return
        }
        const keys = importResult.value
        if (pwd !== null) {
          const saveResult2 = await saveWallet(keys, pwd)
          if (!saveResult2.ok) {
            showToast('Failed to save wallet: ' + saveResult2.error, 'error')
            return
          }
        } else {
          await saveWalletUnprotected(keys)
        }
        // Create account in database for persistence across app restarts
        await migrateToMultiAccount(keys, pwd)
        // Populate the Rust key store so WIF operations work immediately after restore
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
        } catch (_e) { /* non-fatal — unlock will re-populate */ }
        setWallet(keys)
        setWalletKeys(keys)
        setSessionPassword(sessionPwd)
        setModuleSessionPassword(sessionPwd)
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
        discoverAccounts(backup.wallet.mnemonic, pwd, activeAfterRestore?.id)
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
      <div className="modal-content compact">
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
              {!skipPassword && (
                <>
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
                </>
              )}
              <button
                className="btn btn-ghost btn-small"
                onClick={() => {
                  if (skipPassword) {
                    setSkipPassword(false)
                  } else {
                    setShowSkipWarning(true)
                  }
                }}
                type="button"
              >
                {skipPassword ? 'Set a password' : 'Skip password'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleRestoreFromMnemonic()}
                disabled={!restoreMnemonic.trim() || (!skipPassword && (!password || !confirmPassword))}
              >
                {skipPassword ? 'Restore Without Password' : 'Restore Wallet'}
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
              {!skipPassword && (
                <>
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
                </>
              )}
              <button
                className="btn btn-ghost btn-small"
                onClick={() => {
                  if (skipPassword) {
                    setSkipPassword(false)
                  } else {
                    setShowSkipWarning(true)
                  }
                }}
                type="button"
              >
                {skipPassword ? 'Set a password' : 'Skip password'}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromJSON}
                disabled={!restoreJSON.trim() || (!skipPassword && (!password || !confirmPassword))}
              >
                {skipPassword ? 'Import Without Password' : 'Import Wallet'}
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
              {!skipPassword && (
                <>
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
                </>
              )}
              <button
                className="btn btn-ghost btn-small"
                onClick={() => {
                  if (skipPassword) {
                    setSkipPassword(false)
                  } else {
                    setShowSkipWarning(true)
                  }
                }}
                type="button"
              >
                {skipPassword ? 'Set a password' : 'Skip password'}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromFullBackup}
                disabled={!skipPassword && (!password || !confirmPassword)}
              >
                {skipPassword ? 'Restore Without Password' : 'Select Backup File'}
              </button>
            </div>
          )}
        </div>
      {showSkipWarning && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="skip-pwd-title">
          <div className="modal-container modal-sm">
            <h3 className="modal-title" id="skip-pwd-title">Skip Password?</h3>
            <p className="modal-text">
              Without a password, anyone with access to this computer can open your wallet and spend your funds.
              You can set a password later in Settings.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSkipWarning(false)}>
                Go Back
              </button>
              <button className="btn btn-primary" onClick={() => {
                setShowSkipWarning(false)
                setSkipPassword(true)
                setPassword('')
                setConfirmPassword('')
                setPasswordError('')
                // If mnemonic is already complete, restore immediately — no redundant screen
                if (restoreMnemonic.trim()) {
                  void handleRestoreFromMnemonic(true)
                }
              }}>
                Continue Without Password
              </button>
            </div>
          </div>
        </div>
      )}
      </Modal>
  )
}
