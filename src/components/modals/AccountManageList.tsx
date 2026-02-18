/**
 * AccountManageList Component
 *
 * Displays the list of accounts with switch, rename, and delete actions.
 * Manages its own state for editing, delete confirmation, loading, and error.
 */

import { useState } from 'react'
import type { Account } from '../../services/accounts'

interface AccountManageListProps {
  accounts: Account[]
  activeAccountId?: number | null
  onSwitchAccount?: (accountId: number) => void
  onRenameAccount?: (accountId: number, name: string) => Promise<boolean>
  onDeleteAccount?: (accountId: number) => Promise<boolean>
  onCreateNew: () => void
  onClose: () => void
}

export function AccountManageList({
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRenameAccount,
  onDeleteAccount,
  onCreateNew,
  onClose
}: AccountManageListProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRename = async (accountId: number) => {
    if (!onRenameAccount || !editName.trim()) return

    const success = await onRenameAccount(accountId, editName.trim())
    if (success) {
      setEditingId(null)
      setEditName('')
    } else {
      setError('Failed to rename account')
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

  return (
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
                  aria-label="Rename account"
                />
                <button
                  type="button"
                  className="icon-button save"
                  onClick={() => { if (account.id === undefined) return; handleRename(account.id) }}
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
                  onClick={() => { if (account.id === undefined) return; handleDeleteAccount(account.id) }}
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
                      onClick={() => { if (account.id === undefined) return; onSwitchAccount(account.id) }}
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
                      onClick={() => { if (account.id === undefined) return; setEditingId(account.id); setEditName(account.name) }}
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
                      onClick={() => { if (account.id === undefined) return; setConfirmDelete(account.id) }}
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
          className="btn btn-secondary"
          onClick={onCreateNew}
        >
          + New Account
        </button>
      </div>

      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
