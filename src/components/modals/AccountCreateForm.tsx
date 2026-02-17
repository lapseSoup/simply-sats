/**
 * AccountCreateForm Component
 *
 * Form for creating a new account derived from the wallet's seed.
 * Manages its own state for name input, loading, error, and success.
 */

import { useState } from 'react'

interface AccountCreateFormProps {
  onCreateAccount: (name: string) => Promise<boolean>
  onClose: () => void
}

export function AccountCreateForm({ onCreateAccount, onClose }: AccountCreateFormProps) {
  const [accountName, setAccountName] = useState('')
  const [accountCreated, setAccountCreated] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreateAccount = async () => {
    if (!accountName.trim()) {
      setError('Please enter an account name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const success = await onCreateAccount(accountName.trim())
      if (success) {
        setAccountCreated(true)
      } else {
        setError('Failed to create account')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setLoading(false)
    }
  }

  if (accountCreated) {
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
          className="btn btn-primary"
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
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreateAccount}
          disabled={loading || !accountName.trim()}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <span className="spinner-small" aria-hidden="true" />
              Creating...
            </>
          ) : 'Add Account'}
        </button>
      </div>
    </div>
  )
}
