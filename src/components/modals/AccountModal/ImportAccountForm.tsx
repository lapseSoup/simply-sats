/**
 * ImportAccountForm Component
 *
 * Form for importing an existing wallet account from mnemonic.
 */

import { useState, useCallback, memo } from 'react'

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

  const handleImport = useCallback(async () => {
    if (!accountName.trim()) {
      setError('Please enter an account name')
      return
    }

    const words = mnemonic.trim().split(/\s+/)
    if (words.length !== 12) {
      setError('Please enter a valid 12-word recovery phrase')
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
        <label htmlFor="import-mnemonic">Recovery Phrase</label>
        <textarea
          id="import-mnemonic"
          value={mnemonic}
          onChange={e => setMnemonic(e.target.value)}
          placeholder="Enter your 12 words separated by spaces"
          rows={3}
          disabled={loading}
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
          disabled={loading || !accountName.trim() || !mnemonic.trim()}
        >
          {loading ? 'Importing...' : 'Import Account'}
        </button>
      </div>
    </div>
  )
})

export default ImportAccountForm
