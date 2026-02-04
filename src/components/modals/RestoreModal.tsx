import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { useWallet } from '../../contexts/WalletContext'
import { MnemonicInput } from '../forms/MnemonicInput'
import { restoreWallet, importFromJSON } from '../../services/wallet'
import { importDatabase, type DatabaseBackup } from '../../services/database'
import { setWalletKeys } from '../../services/brc100'

interface RestoreModalProps {
  onClose: () => void
  onSuccess: () => void
}

type RestoreMode = 'mnemonic' | 'json' | 'fullbackup'

export function RestoreModal({ onClose, onSuccess }: RestoreModalProps) {
  const { setWallet, performSync } = useWallet()
  const [restoreMode, setRestoreMode] = useState<RestoreMode>('mnemonic')
  const [restoreMnemonic, setRestoreMnemonic] = useState('')
  const [restoreJSON, setRestoreJSON] = useState('')

  const handleRestoreFromMnemonic = async () => {
    try {
      const words = restoreMnemonic.trim().split(/\s+/)
      if (words.length !== 12) {
        alert('Please enter exactly 12 words')
        return
      }
      const keys = restoreWallet(restoreMnemonic.trim())
      setWallet({ ...keys, mnemonic: restoreMnemonic.trim() })
      onSuccess()
    } catch (_err) {
      alert('Invalid mnemonic. Please check your words.')
    }
  }

  const handleRestoreFromJSON = async () => {
    try {
      const keys = await importFromJSON(restoreJSON)
      setWallet(keys)
      onSuccess()
    } catch (_err) {
      alert('Invalid JSON backup. Please check the format.')
    }
  }

  const handleRestoreFromFullBackup = async () => {
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

      // Restore wallet from backup
      if (backup.wallet.mnemonic) {
        const keys = restoreWallet(backup.wallet.mnemonic)
        setWallet({ ...keys, mnemonic: backup.wallet.mnemonic })
        setWalletKeys(keys)
      } else if (backup.wallet.keys) {
        const keys = await importFromJSON(JSON.stringify(backup.wallet.keys))
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
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromMnemonic}
                disabled={!restoreMnemonic.trim()}
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
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromJSON}
                disabled={!restoreJSON.trim()}
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
              <button
                className="btn btn-primary"
                onClick={handleRestoreFromFullBackup}
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
