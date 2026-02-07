/**
 * ImportAccountForm Component
 *
 * Form for importing an existing wallet account from mnemonic.
 * Uses MnemonicInput for real-time BIP-39 validation, autocomplete,
 * and smart paste handling — same experience as the wallet recovery flow.
 */

import { useState, useCallback, useMemo, memo } from 'react'
import { validateMnemonic } from 'bip39'
import { MnemonicInput } from '../../forms/MnemonicInput'

interface ImportAccountFormProps {
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onClose: () => void
}

export const ImportAccountForm = memo(function ImportAccountForm({
  onImportAccount,
  onClose
}: ImportAccountFormProps) {
  const [accountName, setAccountName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isMnemonicValid = useMemo(() => {
    const words = mnemonic.trim().split(/\s+/).filter(w => w.length > 0)
    if (words.length !== 12) return false
    return validateMnemonic(mnemonic.trim().toLowerCase())
  }, [mnemonic])

  const handleImport = useCallback(async () => {
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
  }, [accountName, mnemonic, onImportAccount, onClose])

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
        <label>Recovery Phrase</label>
        <MnemonicInput
          value={mnemonic}
          onChange={setMnemonic}
          placeholder="Start typing your seed words..."
        />
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button type="button" className="secondary-button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleImport}
          disabled={loading || !accountName.trim() || !isMnemonicValid}
        >
          {loading ? 'Importing...' : 'Import Account'}
        </button>
      </div>
    </div>
  )
})

export default ImportAccountForm
