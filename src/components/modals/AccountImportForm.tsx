/**
 * AccountImportForm Component
 *
 * Form for importing an account using a 12-word recovery phrase.
 * Manages its own state for name, mnemonic, validation, loading, and error.
 */

import { useState, useMemo } from 'react'
import { validateMnemonic } from 'bip39'
import { MnemonicInput } from '../forms/MnemonicInput'

interface AccountImportFormProps {
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onClose: () => void
}

export function AccountImportForm({ onImportAccount, onClose }: AccountImportFormProps) {
  const [accountName, setAccountName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isMnemonicValid = useMemo(() => {
    const words = mnemonic.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length !== 12 && words.length !== 24) return false
    return validateMnemonic(mnemonic.trim().toLowerCase())
  }, [mnemonic])

  const handleImportAccount = async () => {
    if (!accountName.trim()) {
      setError('Please enter an account name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const success = await onImportAccount(accountName.trim(), mnemonic.trim())
      if (success) {
        onClose()
      } else {
        setError('Failed to import account')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="account-modal-content">
      <h3>Import Account</h3>
      <p className="modal-description">
        Restore an account using your 12-word recovery phrase.
      </p>

      <div className="form-group">
        <label htmlFor="import-name">Account Name</label>
        <input
          id="import-name"
          type="text"
          value={accountName}
          onChange={e => setAccountName(e.target.value)}
          placeholder="e.g., Restored Account"
          disabled={loading}
        />
      </div>

      <div className="form-group">
        <label htmlFor="import-mnemonic">Recovery Phrase</label>
        <MnemonicInput
          value={mnemonic}
          onChange={setMnemonic}
          placeholder="Start typing your seed words..."
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleImportAccount}
          disabled={loading || !accountName.trim() || !isMnemonicValid}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <span className="spinner-small" aria-hidden="true" />
              Importing...
            </>
          ) : 'Import Account'}
        </button>
      </div>
    </div>
  )
}
