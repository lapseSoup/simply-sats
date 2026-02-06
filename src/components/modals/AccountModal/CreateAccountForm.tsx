/**
 * CreateAccountForm Component
 *
 * Form for creating a new derived wallet account.
 * Accounts are derived from the same master seed, so no new mnemonic is shown.
 */

import { useState, useCallback, memo } from 'react'

interface CreateAccountFormProps {
  onCreateAccount: (name: string) => Promise<boolean>
  onClose: () => void
}

export const CreateAccountForm = memo(function CreateAccountForm({
  onCreateAccount,
  onClose
}: CreateAccountFormProps) {
  const [accountName, setAccountName] = useState('')
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!accountName.trim()) {
      setError('Please enter an account name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const created = await onCreateAccount(accountName.trim())
      if (created) {
        setSuccess(true)
      } else {
        setError('Failed to create account')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setLoading(false)
    }
  }, [accountName, onCreateAccount])

  if (success) {
    return (
      <div className="account-modal-content">
        <div className="success-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
            <path d="M14 24L21 31L34 18" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3>Account Created!</h3>
        <p className="modal-description">
          Your new account has been created and is ready to use.
          It shares the same recovery phrase as your other accounts.
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="account-modal-content">
      <h3>Add Account</h3>
      <p className="modal-description">
        Create a new account derived from your wallet.
        All accounts share the same recovery phrase.
      </p>

      <div className="form-group">
        <label htmlFor="account-name">Account Name</label>
        <input
          id="account-name"
          type="text"
          value={accountName}
          onChange={e => setAccountName(e.target.value)}
          placeholder="e.g., Savings, Trading, etc."
          disabled={loading}
          autoFocus
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
          onClick={handleCreate}
          disabled={loading || !accountName.trim()}
        >
          {loading ? 'Creating...' : 'Add Account'}
        </button>
      </div>
    </div>
  )
})

export default CreateAccountForm
