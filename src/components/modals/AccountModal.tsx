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

    </Modal>
  )
}
