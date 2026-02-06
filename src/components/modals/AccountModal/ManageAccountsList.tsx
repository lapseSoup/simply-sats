/**
 * ManageAccountsList Component
 *
 * List component for managing multiple wallet accounts.
 */

import { useState, useCallback, memo } from 'react'
import { Check, X, ArrowRight, Pencil, Trash2 } from 'lucide-react'
import type { Account } from '../../../services/accounts'

interface ManageAccountsListProps {
  accounts: Account[]
  activeAccountId?: number | null
  onDeleteAccount?: (accountId: number) => Promise<boolean>
  onRenameAccount?: (accountId: number, name: string) => Promise<void>
  onSwitchAccount?: (accountId: number) => void
  onCreateNew: () => void
  onClose: () => void
}

// Memoized account item to prevent unnecessary re-renders
const AccountItem = memo(function AccountItem({
  account,
  isActive,
  isEditing,
  isDeleting,
  editName,
  loading,
  onEditNameChange,
  onSave,
  onCancelEdit,
  onDelete,
  onCancelDelete,
  onStartEdit,
  onStartDelete,
  onSwitch,
  canDelete,
  canRename,
  canSwitch
}: {
  account: Account
  isActive: boolean
  isEditing: boolean
  isDeleting: boolean
  editName: string
  loading: boolean
  onEditNameChange: (name: string) => void
  onSave: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onCancelDelete: () => void
  onStartEdit: () => void
  onStartDelete: () => void
  onSwitch: () => void
  canDelete: boolean
  canRename: boolean
  canSwitch: boolean
}) {
  if (isEditing) {
    return (
      <div className={`account-item-manage ${isActive ? 'active' : ''}`}>
        <div className="edit-name-row">
          <input
            type="text"
            value={editName}
            onChange={e => onEditNameChange(e.target.value)}
            placeholder="Account name"
            autoFocus
          />
          <button
            type="button"
            className="icon-button save"
            onClick={onSave}
            aria-label="Save name"
          >
            <Check size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-button cancel"
            onClick={onCancelEdit}
            aria-label="Cancel edit"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    )
  }

  if (isDeleting) {
    return (
      <div className={`account-item-manage ${isActive ? 'active' : ''}`}>
        <div className="confirm-delete-row">
          <span>Delete "{account.name}"?</span>
          <button
            type="button"
            className="icon-button delete"
            onClick={onDelete}
            disabled={loading}
          >
            Yes
          </button>
          <button
            type="button"
            className="icon-button cancel"
            onClick={onCancelDelete}
          >
            No
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`account-item-manage ${isActive ? 'active' : ''}`}>
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
        {isActive && (
          <span className="active-badge">Active</span>
        )}
      </div>
      <div className="account-actions-manage">
        {canSwitch && !isActive && (
          <button
            type="button"
            className="icon-button"
            onClick={onSwitch}
            title="Switch to this account"
            aria-label="Switch to this account"
          >
            <ArrowRight size={16} strokeWidth={2} />
          </button>
        )}
        {canRename && (
          <button
            type="button"
            className="icon-button"
            onClick={onStartEdit}
            title="Rename account"
            aria-label="Rename account"
          >
            <Pencil size={16} strokeWidth={2} />
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="icon-button delete"
            onClick={onStartDelete}
            title="Delete account"
            aria-label="Delete account"
          >
            <Trash2 size={16} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
})

export const ManageAccountsList = memo(function ManageAccountsList({
  accounts,
  activeAccountId,
  onDeleteAccount,
  onRenameAccount,
  onSwitchAccount,
  onCreateNew,
  onClose
}: ManageAccountsListProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRename = useCallback(async (accountId: number) => {
    if (!onRenameAccount || !editName.trim()) return

    try {
      await onRenameAccount(accountId, editName.trim())
      setEditingId(null)
      setEditName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename account')
    }
  }, [onRenameAccount, editName])

  const handleDelete = useCallback(async (accountId: number) => {
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
  }, [onDeleteAccount])

  return (
    <div className="account-modal-content">
      <h3>Manage Accounts</h3>

      <div className="account-list-manage" role="list">
        {accounts.map(account => (
          <AccountItem
            key={account.id}
            account={account}
            isActive={account.id === activeAccountId}
            isEditing={editingId === account.id}
            isDeleting={confirmDelete === account.id}
            editName={editName}
            loading={loading}
            onEditNameChange={setEditName}
            onSave={() => handleRename(account.id!)}
            onCancelEdit={() => { setEditingId(null); setEditName('') }}
            onDelete={() => handleDelete(account.id!)}
            onCancelDelete={() => setConfirmDelete(null)}
            onStartEdit={() => { setEditingId(account.id!); setEditName(account.name) }}
            onStartDelete={() => setConfirmDelete(account.id!)}
            onSwitch={() => onSwitchAccount?.(account.id!)}
            canDelete={!!onDeleteAccount && accounts.length > 1}
            canRename={!!onRenameAccount}
            canSwitch={!!onSwitchAccount}
          />
        ))}
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={onCreateNew}
        >
          + New Account
        </button>
      </div>

      <button type="button" className="close-button" onClick={onClose}>
        Close
      </button>
    </div>
  )
})

export default ManageAccountsList
