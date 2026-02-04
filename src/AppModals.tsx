import {
  SendModal,
  LockModal,
  ReceiveModal,
  BRC100Modal,
  MnemonicModal,
  OrdinalModal,
  UnlockConfirmModal,
  SettingsModal,
  OrdinalTransferModal,
  AccountModal
} from './components/modals'
import type { Ordinal, LockedUTXO } from './services/wallet'
import type { BRC100Request } from './services/brc100'
import type { Account } from './services/accounts'

export type Modal =
  | 'send'
  | 'receive'
  | 'settings'
  | 'mnemonic'
  | 'restore'
  | 'ordinal'
  | 'brc100'
  | 'lock'
  | 'transfer-ordinal'
  | 'account'
  | null

export type AccountModalMode = 'create' | 'import' | 'manage'

interface AppModalsProps {
  modal: Modal
  onCloseModal: () => void

  // Send/Lock/Receive modals
  // (no additional props needed)

  // Settings modal
  // (no additional props needed)

  // Ordinal modal
  selectedOrdinal: Ordinal | null
  onTransferOrdinal: (ordinal: Ordinal) => void

  // Transfer ordinal modal
  ordinalToTransfer: Ordinal | null
  onTransferComplete: () => void

  // BRC-100 modal
  brc100Request: BRC100Request | null
  onApproveBRC100: () => void
  onRejectBRC100: () => void

  // Mnemonic modal
  newMnemonic: string | null
  onMnemonicConfirm: () => void

  // Account modal
  accountModalMode: AccountModalMode
  accounts: Account[]
  activeAccountId: number | null
  onCreateAccount: (name: string) => Promise<string | null>
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onDeleteAccount: (id: number) => Promise<boolean>
  onRenameAccount: (id: number, name: string) => Promise<void>

  // Unlock confirm modal
  unlockConfirm: LockedUTXO | 'all' | null
  unlockableLocks: LockedUTXO[]
  onConfirmUnlock: () => void
  onCancelUnlock: () => void
  isUnlocking: boolean
}

/**
 * Renders all modal components based on the current modal state.
 * Centralizes modal rendering logic from App.tsx.
 */
export function AppModals({
  modal,
  onCloseModal,
  selectedOrdinal,
  onTransferOrdinal,
  ordinalToTransfer,
  onTransferComplete,
  brc100Request,
  onApproveBRC100,
  onRejectBRC100,
  newMnemonic,
  onMnemonicConfirm,
  accountModalMode,
  accounts,
  activeAccountId,
  onCreateAccount,
  onImportAccount,
  onDeleteAccount,
  onRenameAccount,
  unlockConfirm,
  unlockableLocks,
  onConfirmUnlock,
  onCancelUnlock,
  isUnlocking
}: AppModalsProps) {
  return (
    <>
      {modal === 'send' && <SendModal onClose={onCloseModal} />}
      {modal === 'lock' && <LockModal onClose={onCloseModal} />}
      {modal === 'receive' && <ReceiveModal onClose={onCloseModal} />}
      {modal === 'settings' && <SettingsModal onClose={onCloseModal} />}

      {modal === 'ordinal' && selectedOrdinal && (
        <OrdinalModal
          ordinal={selectedOrdinal}
          onClose={onCloseModal}
          onTransfer={() => onTransferOrdinal(selectedOrdinal)}
        />
      )}

      {modal === 'transfer-ordinal' && ordinalToTransfer && (
        <OrdinalTransferModal
          ordinal={ordinalToTransfer}
          onClose={onTransferComplete}
        />
      )}

      {modal === 'brc100' && brc100Request && (
        <BRC100Modal
          request={brc100Request}
          onApprove={onApproveBRC100}
          onReject={onRejectBRC100}
        />
      )}

      {modal === 'mnemonic' && newMnemonic && (
        <MnemonicModal mnemonic={newMnemonic} onConfirm={onMnemonicConfirm} />
      )}

      {modal === 'account' && (
        <AccountModal
          isOpen={true}
          onClose={onCloseModal}
          mode={accountModalMode}
          accounts={accounts}
          activeAccountId={activeAccountId}
          onCreateAccount={onCreateAccount}
          onImportAccount={onImportAccount}
          onDeleteAccount={onDeleteAccount}
          onRenameAccount={onRenameAccount}
        />
      )}

      {unlockConfirm && (
        <UnlockConfirmModal
          locks={unlockConfirm === 'all' ? unlockableLocks : [unlockConfirm]}
          onConfirm={onConfirmUnlock}
          onCancel={onCancelUnlock}
          unlocking={isUnlocking}
        />
      )}
    </>
  )
}
