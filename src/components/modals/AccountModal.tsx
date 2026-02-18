/**
 * AccountModal Component
 *
 * Modal for creating new accounts, importing accounts from mnemonic,
 * and managing account settings. Delegates to sub-components for each mode.
 */

import { useState } from 'react'
import { Modal } from '../shared/Modal'
import { AccountCreateForm } from './AccountCreateForm'
import { AccountImportForm } from './AccountImportForm'
import { AccountManageList } from './AccountManageList'
import type { Account } from '../../services/accounts'

type ModalMode = 'create' | 'import' | 'manage' | 'settings'

interface AccountModalProps {
  isOpen: boolean
  onClose: () => void
  mode: ModalMode
  accounts?: Account[]
  activeAccountId?: number | null
  onCreateAccount: (name: string) => Promise<boolean> // Returns success (accounts derived from same seed)
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onDeleteAccount?: (accountId: number) => Promise<boolean>
  onRenameAccount?: (accountId: number, name: string) => Promise<boolean>
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

  const handleClose = () => {
    onClose()
  }

  if (!isOpen) return null

  return (
    <Modal onClose={handleClose} title="Account">
      <div className="modal-content">
        {mode === 'create' && (
          <AccountCreateForm
            onCreateAccount={onCreateAccount}
            onClose={handleClose}
          />
        )}
        {mode === 'import' && (
          <AccountImportForm
            onImportAccount={onImportAccount}
            onClose={handleClose}
          />
        )}
        {mode === 'manage' && (
          <AccountManageList
            accounts={accounts}
            activeAccountId={activeAccountId}
            onSwitchAccount={onSwitchAccount}
            onRenameAccount={onRenameAccount}
            onDeleteAccount={onDeleteAccount}
            onCreateNew={() => setMode('create')}
            onClose={handleClose}
          />
        )}
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

        /* Override .btn width:100% when inside button-row (flex context) */
        .button-row .btn {
          flex: 1;
          width: auto;
        }

        .account-modal-content > .btn {
          margin-top: 0.5rem;
        }

        .success-icon {
          display: flex;
          justify-content: center;
          margin-bottom: 0.5rem;
        }

        .account-list-manage {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 300px;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .account-item-manage {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          background: var(--bg-tertiary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          min-width: 0;
        }

        .account-item-manage.active {
          border-color: var(--accent);
        }

        .account-info-manage {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }

        .account-avatar-manage {
          width: 36px;
          min-width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.9375rem;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .account-details {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
          overflow: hidden;
        }

        .account-name-manage {
          font-size: 0.9375rem;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .account-address-manage {
          font-size: 0.75rem;
          color: var(--text-tertiary);
          font-family: var(--font-mono);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .active-badge {
          padding: 0.125rem 0.5rem;
          background: var(--accent);
          border-radius: 9999px;
          font-size: 0.6875rem;
          font-weight: 600;
          color: white;
          flex-shrink: 0;
        }

        .account-actions-manage {
          display: flex;
          gap: 0.25rem;
          flex-shrink: 0;
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
