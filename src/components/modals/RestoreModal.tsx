import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useWallet } from '../../contexts/WalletContext'
import { MnemonicInput } from '../forms/MnemonicInput'
import { restoreWallet, importFromJSON } from '../../services/wallet'
import { importDatabase, type DatabaseBackup } from '../../services/database'
import { setWalletKeys } from '../../services/brc100'
import { saveWallet } from '../../services/wallet'

interface RestoreModalProps {
  onClose: () => void
  onSuccess: () => void
}

type RestoreMode = 'mnemonic' | 'json' | 'fullbackup'

export function RestoreModal({ onClose, onSuccess }: RestoreModalProps) {
  const { setWallet, performSync, handleRestoreWallet, handleImportJSON } = useWallet()
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  const validatePassword = (): boolean => {
    if (password.length < 12) {
      setPasswordError('Password must be at least 12 characters')
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
        alert('Please enter exactly 12 words')
        return
      }
      const success = await handleRestoreWallet(restoreMnemonic.trim(), password)
      if (success) {
        onSuccess()
      } else {
        alert('Failed to restore wallet')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid mnemonic. Please check your words.')
    }
  }

  const handleRestoreFromJSON = async () => {
    if (!validatePassword()) return
    try {
      const success = await handleImportJSON(restoreJSON, password)
      if (success) {
        onSuccess()
      } else {
        alert('Failed to import wallet')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Invalid JSON backup. Please check the format.')
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
      const backup = JSON.parse(json)

      if (backup.format !== 'simply-sats-full' || !backup.wallet) {
        alert('Invalid backup format. This should be a Simply Sats full backup file.')
        return
      }

      // Restore wallet from backup with password
      if (backup.wallet.mnemonic) {
        const keys = restoreWallet(backup.wallet.mnemonic)
        await saveWallet(keys, password)
        setWallet({ ...keys, mnemonic: backup.wallet.mnemonic })
        setWalletKeys(keys)
      } else if (backup.wallet.keys) {
        const keys = await importFromJSON(JSON.stringify(backup.wallet.keys))
        await saveWallet(keys, password)
        setWallet(keys)
        setWalletKeys(keys)
      } else {
        alert('Backup does not contain wallet keys.')
        return
      }

      // Import database if present
      if (backup.database) {
        await importDatabase(backup.database as DatabaseBackup)
      }

      alert(`Wallet restored from backup!\n\n${backup.database?.utxos?.length || 0} UTXOs\n${backup.database?.transactions?.length || 0} transactions`)

      // Trigger sync to update balances
      performSync(false)
      onSuccess()
    } catch (err) {
      alert('Import failed: ' + (err instanceof Error ? err.message : 'Invalid file'))
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="modal-header">
          <h2 className="modal-title">Restore Wallet</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-content">
          <div className="pill-tabs" role="tablist">
            <button
              className={`pill-tab ${restoreMode === 'mnemonic' ? 'active' : ''}`}
              onClick={() => setRestoreMode('mnemonic')}
              role="tab"
              aria-selected={restoreMode === 'mnemonic'}
            >
              Seed Phrase
            </button>
            <button
              className={`pill-tab ${restoreMode === 'json' ? 'active' : ''}`}
              onClick={() => setRestoreMode('json')}
              role="tab"
              aria-selected={restoreMode === 'json'}
            >
              JSON Backup
            </button>
            <button
              className={`pill-tab ${restoreMode === 'fullbackup' ? 'active' : ''}`}
              onClick={() => setRestoreMode('fullbackup')}
              role="tab"
              aria-selected={restoreMode === 'fullbackup'}
            >
              Full Backup
            </button>
          </div>

          {restoreMode === 'mnemonic' && (
            <>
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
                <input
                  id="restore-password"
                  type="password"
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="restore-confirm-password">Confirm Password</label>
                <input
                  id="restore-confirm-password"
                  type="password"
                  className="form-input"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
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
            </>
          )}

          {restoreMode === 'json' && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="restore-json">Wallet Backup JSON</label>
                <textarea
                  id="restore-json"
                  className="form-input"
                  placeholder='{"mnemonic": "...", ...}'
                  value={restoreJSON}
                  onChange={e => setRestoreJSON(e.target.value)}
                  style={{ minHeight: 120 }}
                />
                <div className="form-hint">
                  Supports Shaullet, 1Sat Ordinals, and Simply Sats backups
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="json-password">Create Password</label>
                <input
                  id="json-password"
                  type="password"
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="json-confirm-password">Confirm Password</label>
                <input
                  id="json-confirm-password"
                  type="password"
                  className="form-input"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
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
            </>
          )}

          {restoreMode === 'fullbackup' && (
            <>
              <div className="form-group">
                <label className="form-label">Full Backup File</label>
                <div className="form-hint" style={{ marginBottom: 12 }}>
                  Restore from a Simply Sats full backup file (.json) including wallet keys, UTXOs, and transaction history.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fullbackup-password">Create Password</label>
                <input
                  id="fullbackup-password"
                  type="password"
                  className="form-input"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="fullbackup-confirm-password">Confirm Password</label>
                <input
                  id="fullbackup-confirm-password"
                  type="password"
                  className="form-input"
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
