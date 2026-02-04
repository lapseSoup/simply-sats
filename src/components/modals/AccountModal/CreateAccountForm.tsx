/**
 * CreateAccountForm Component
 *
 * Form for creating a new wallet account with mnemonic generation.
 */

import { useState, useCallback, memo } from 'react'

interface CreateAccountFormProps {
  onCreateAccount: (name: string) => Promise<string | null>
  onClose: () => void
}

export const CreateAccountForm = memo(function CreateAccountForm({
  onCreateAccount,
  onClose
}: CreateAccountFormProps) {
  const [accountName, setAccountName] = useState('')
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!accountName.trim()) {
      setError('Please enter an account name')
      return
    }

    setLoading(true)
    setError('')

    try {
      const newMnemonic = await onCreateAccount(accountName.trim())
      if (newMnemonic) {
        setGeneratedMnemonic(newMnemonic)
      } else {
        setError('Failed to create account')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setLoading(false)
    }
  }, [accountName, onCreateAccount])

  const handleCopyMnemonic = useCallback(async () => {
    if (generatedMnemonic) {
      await navigator.clipboard.writeText(generatedMnemonic)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [generatedMnemonic])

  if (generatedMnemonic) {
    return (
      <div className="account-modal-content">
        <div className="success-icon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" stroke="#22c55e" strokeWidth="4" />
            <path d="M14 24L21 31L34 18" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3>Account Created!</h3>
        <p className="mnemonic-warning">
          Write down these 12 words and store them safely. This is the only way to recover your account.
        </p>
        <div className="mnemonic-display">
          {generatedMnemonic.split(' ').map((word, i) => (
            <div key={i} className="mnemonic-word">
              <span className="word-number">{i + 1}</span>
              <span className="word-text">{word}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="copy-button"
          onClick={handleCopyMnemonic}
        >
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={onClose}
        >
          I've Saved My Recovery Phrase
        </button>
      </div>
    )
  }

  return (
    <div className="account-modal-content">
      <h3>Create New Account</h3>
      <p className="modal-description">
        Create a new account with its own wallet and addresses.
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
          {loading ? 'Creating...' : 'Create Account'}
        </button>
      </div>
    </div>
  )
})

export default CreateAccountForm
