/**
 * AccountModal Component
 *
 * Modal for creating new accounts, importing accounts from mnemonic,
 * and managing account settings.
 */

import { useState } from 'react'
import { Modal } from '../shared/Modal'
import type { Account } from '../../services/accounts'

type ModalMode = 'create' | 'import' | 'manage' | 'settings'

interface AccountModalProps {
  isOpen: boolean
  onClose: () => void
  mode: ModalMode
  accounts?: Account[]
  activeAccountId?: number | null
  onCreateAccount: (name: string) => Promise<string | null> // Returns mnemonic
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onDeleteAccount?: (accountId: number) => Promise<boolean>
  onRenameAccount?: (accountId: number, name: string) => Promise<void>
  onSwitchAccount?: (accountId: number) => void
}

export function AccountModal({
  isOpen,
  onClose,
  mode: initialMode,
  accounts = [],
  activeAccountId,
  onCreateAccount,
  onImportAccount,
  onDeleteAccount,
  onRenameAccount,
  onSwitchAccount
}: AccountModalProps) {
  const [mode, setMode] = useState<ModalMode>(initialMode)
  const [accountName, setAccountName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const resetState = () => {
    setAccountName('')
    setMnemonic('')
    setGeneratedMnemonic(null)
    setError('')
    setLoading(false)
    setCopied(false)
    setEditingId(null)
    setEditName('')
    setConfirmDelete(null)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const handleCreateAccount = async () => {
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
  }

  const handleImportAccount = async () => {
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
        handleClose()
      } else {
        setError('Failed to import account')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import account')
    } finally {
      setLoading(false)
    }
  }

  const handleCopyMnemonic = async () => {
    if (generatedMnemonic) {
      await navigator.clipboard.writeText(generatedMnemonic)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDeleteAccount = async (accountId: number) => {
    if (!onDeleteAccount) return

    setLoading(true)
    try {
      const success = await onDeleteAccount(accountId)
      if (success) {
        setConfirmDelete(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account')
    } finally {
      setLoading(false)
    }
  }

  const handleRename = async (accountId: number) => {
    if (!onRenameAccount || !editName.trim()) return

    try {
      await onRenameAccount(accountId, editName.trim())
      setEditingId(null)
      setEditName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename account')
    }
  }

  const renderCreateMode = () => {
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
            onClick={handleClose}
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
          <button type="button" className="secondary-button" onClick={handleClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleCreateAccount}
            disabled={loading || !accountName.trim()}
          >
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </div>
      </div>
    )
  }

  const renderImportMode = () => (
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
        <button type="button" className="secondary-button" onClick={handleClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          onClick={handleImportAccount}
          disabled={loading || !accountName.trim() || !mnemonic.trim()}
        >
          {loading ? 'Importing...' : 'Import Account'}
        </button>
      </div>
    </div>
  )

  const renderManageMode = () => (
    <div className="account-modal-content">
      <h3>Manage Accounts</h3>

      <div className="account-list-manage">
        {accounts.map(account => (
          <div key={account.id} className={`account-item-manage ${account.id === activeAccountId ? 'active' : ''}`}>
            {editingId === account.id ? (
              <div className="edit-name-row">
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Account name"
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-button save"
                  onClick={() => handleRename(account.id!)}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8L6 11L13 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="icon-button cancel"
                  onClick={() => { setEditingId(null); setEditName('') }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4L12 12M12 4L4 12" />
                  </svg>
                </button>
              </div>
            ) : confirmDelete === account.id ? (
              <div className="confirm-delete-row">
                <span>Delete "{account.name}"?</span>
                <button
                  type="button"
                  className="icon-button delete"
                  onClick={() => handleDeleteAccount(account.id!)}
                  disabled={loading}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className="icon-button cancel"
                  onClick={() => setConfirmDelete(null)}
                >
                  No
                </button>
              </div>
            ) : (
              <>
                <div className="account-info-manage">
                  <div className="account-avatar-manage">
                    {account.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="account-details">
                    <span className="account-name-manage">{account.name}</span>
                    <span className="account-address-manage">
                      {account.identityAddress.slice(0, 8)}...{account.identityAddress.slice(-6)}
                    </span>
                  </div>
                  {account.id === activeAccountId && (
                    <span className="active-badge">Active</span>
                  )}
                </div>
                <div className="account-actions-manage">
                  {account.id !== activeAccountId && onSwitchAccount && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onSwitchAccount(account.id!)}
                      title="Switch to this account"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 8H14M10 4L14 8L10 12" />
                      </svg>
                    </button>
                  )}
                  {onRenameAccount && (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => { setEditingId(account.id!); setEditName(account.name) }}
                      title="Rename account"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 2L14 5L5 14H2V11L11 2Z" />
                      </svg>
                    </button>
                  )}
                  {onDeleteAccount && accounts.length > 1 && (
                    <button
                      type="button"
                      className="icon-button delete"
                      onClick={() => setConfirmDelete(account.id!)}
                      title="Delete account"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 4H13M6 4V2H10V4M5 4V14H11V4" />
                      </svg>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => setMode('create')}
        >
          + New Account
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setMode('import')}
        >
          Import Account
        </button>
      </div>

      <button type="button" className="close-button" onClick={handleClose}>
        Close
      </button>
    </div>
  )

  if (!isOpen) return null

  return (
    <Modal onClose={handleClose} title="Account">
      <div className="modal-content">
        {mode === 'create' && renderCreateMode()}
        {mode === 'import' && renderImportMode()}
        {mode === 'manage' && renderManageMode()}
      </div>

      <style>{`
        .account-modal-content {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .account-modal-content h3 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .modal-description {
          margin: 0;
          font-size: 0.875rem;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--text-primary);
        }

        .form-group input,
        .form-group textarea {
          padding: 0.75rem 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 0.9375rem;
          outline: none;
          transition: border-color 0.15s ease, background 0.15s ease;
        }

        .form-group input::placeholder,
        .form-group textarea::placeholder {
          color: var(--text-tertiary);
        }

        .form-group input:focus,
        .form-group textarea:focus {
          border-color: var(--accent);
          background: var(--bg-elevated);
        }

        .form-group textarea {
          resize: vertical;
          font-family: monospace;
        }

        .error-message {
          color: var(--error);
          font-size: 0.875rem;
          margin: 0;
        }

        .button-row {
          display: flex;
          gap: 0.75rem;
          margin-top: 0.5rem;
        }

        .primary-button,
        .secondary-button,
        .close-button {
          flex: 1;
          padding: 0.875rem 1.25rem;
          border-radius: var(--radius-md);
          font-size: 0.9375rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .primary-button {
          background: var(--accent);
          border: none;
          color: white;
        }

        .primary-button:hover:not(:disabled) {
          background: var(--accent-light);
          transform: translateY(-1px);
        }

        .primary-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .secondary-button {
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          color: var(--text-primary);
        }

        .secondary-button:hover {
          background: var(--bg-elevated);
          border-color: var(--border-light);
        }

        .close-button {
          background: var(--bg-tertiary);
          border: none;
          color: var(--text-secondary);
          margin-top: 0.5rem;
        }

        .close-button:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }

        .success-icon {
          display: flex;
          justify-content: center;
          margin-bottom: 0.5rem;
        }

        .mnemonic-warning {
          background: rgba(234, 179, 8, 0.1);
          border: 1px solid rgba(234, 179, 8, 0.3);
          border-radius: var(--radius-md);
          padding: 0.875rem;
          font-size: 0.875rem;
          color: #eab308;
          line-height: 1.5;
        }

        .mnemonic-display {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.5rem;
          background: var(--bg-tertiary);
          border-radius: var(--radius-lg);
          padding: 1rem;
        }

        .mnemonic-word {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.625rem;
          background: var(--bg-elevated);
          border-radius: var(--radius-sm);
        }

        .word-number {
          font-size: 0.75rem;
          color: var(--text-tertiary);
          min-width: 1.25rem;
        }

        .word-text {
          font-family: var(--font-mono);
          font-size: 0.875rem;
          color: var(--text-primary);
        }

        .copy-button {
          padding: 0.625rem 1rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .copy-button:hover {
          background: var(--bg-elevated);
          border-color: var(--border-light);
        }

        .account-list-manage {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 300px;
          overflow-y: auto;
        }

        .account-item-manage {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.875rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
        }

        .account-item-manage.active {
          border-color: var(--accent);
        }

        .account-info-manage {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
        }

        .account-avatar-manage {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9375rem;
          font-weight: 600;
          color: white;
        }

        .account-details {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }

        .account-name-manage {
          font-size: 0.9375rem;
          font-weight: 500;
          color: var(--text-primary);
        }

        .account-address-manage {
          font-size: 0.8125rem;
          color: var(--text-tertiary);
          font-family: var(--font-mono);
        }

        .active-badge {
          padding: 0.1875rem 0.625rem;
          background: var(--accent);
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
        }

        .account-actions-manage {
          display: flex;
          gap: 0.25rem;
        }

        .icon-button {
          padding: 0.5rem;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .icon-button:hover {
          background: var(--bg-elevated);
          color: var(--text-primary);
        }

        .icon-button.delete:hover {
          color: var(--error);
        }

        .icon-button.save:hover {
          color: var(--success);
        }

        .edit-name-row,
        .confirm-delete-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .edit-name-row input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-size: 0.875rem;
        }

        .confirm-delete-row span {
          flex: 1;
          font-size: 0.875rem;
          color: var(--error);
        }
      `}</style>
    </Modal>
  )
}
