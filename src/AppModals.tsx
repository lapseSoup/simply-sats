import { AlertCircle } from 'lucide-react'
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
  OrdinalListModal,
  AccountModal
} from './components/modals'
import type { Ordinal, LockedUTXO } from './services/wallet'
import type { BRC100Request } from './services/brc100'
import type { Account } from './services/accounts'
import { ErrorBoundary } from './components/shared/ErrorBoundary'

/**
 * Fallback UI for modal errors - shows error with close button
 */
function ModalErrorFallback({ modalName, error, reset, onClose }: {
  modalName: string
  error: Error
  reset: () => void
  onClose: () => void
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-error-fallback" role="alert">
        <div className="modal-header">
          <h2>Error in {modalName}</h2>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-content">
          <AlertCircle size={48} strokeWidth={2} color="#ef4444" />
          <p className="error-message">{error.message}</p>
          <div className="error-actions">
            <button type="button" className="button primary" onClick={reset}>
              Try Again
            </button>
            <button type="button" className="button secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

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
  | 'list-ordinal'
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
  onListOrdinal: (ordinal: Ordinal) => void

  // Transfer ordinal modal
  ordinalToTransfer: Ordinal | null
  onTransferComplete: () => void

  // List ordinal modal
  ordinalToList: Ordinal | null
  onListComplete: () => void

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
  onCreateAccount: (name: string) => Promise<boolean>
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
  onListOrdinal,
  ordinalToTransfer,
  onTransferComplete,
  ordinalToList,
  onListComplete,
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
      {modal === 'send' && (
        <ErrorBoundary
          context="SendModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Send" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <SendModal onClose={onCloseModal} />
        </ErrorBoundary>
      )}
      {modal === 'lock' && (
        <ErrorBoundary
          context="LockModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Lock" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <LockModal onClose={onCloseModal} />
        </ErrorBoundary>
      )}
      {modal === 'receive' && (
        <ErrorBoundary
          context="ReceiveModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Receive" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <ReceiveModal onClose={onCloseModal} />
        </ErrorBoundary>
      )}
      {modal === 'settings' && (
        <ErrorBoundary
          context="SettingsModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Settings" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <SettingsModal onClose={onCloseModal} />
        </ErrorBoundary>
      )}

      {modal === 'ordinal' && selectedOrdinal && (
        <ErrorBoundary
          context="OrdinalModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Ordinal" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <OrdinalModal
            ordinal={selectedOrdinal}
            onClose={onCloseModal}
            onTransfer={() => onTransferOrdinal(selectedOrdinal)}
            onList={() => onListOrdinal(selectedOrdinal)}
          />
        </ErrorBoundary>
      )}

      {modal === 'transfer-ordinal' && ordinalToTransfer && (
        <ErrorBoundary
          context="OrdinalTransferModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Transfer Ordinal" error={error} reset={reset} onClose={onTransferComplete} />
          )}
        >
          <OrdinalTransferModal
            ordinal={ordinalToTransfer}
            onClose={onTransferComplete}
          />
        </ErrorBoundary>
      )}

      {modal === 'list-ordinal' && ordinalToList && (
        <ErrorBoundary
          context="OrdinalListModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="List Ordinal" error={error} reset={reset} onClose={onListComplete} />
          )}
        >
          <OrdinalListModal
            ordinal={ordinalToList}
            onClose={onListComplete}
          />
        </ErrorBoundary>
      )}

      {modal === 'brc100' && brc100Request && (
        <ErrorBoundary
          context="BRC100Modal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="BRC-100 Request" error={error} reset={reset} onClose={onRejectBRC100} />
          )}
        >
          <BRC100Modal
            request={brc100Request}
            onApprove={onApproveBRC100}
            onReject={onRejectBRC100}
          />
        </ErrorBoundary>
      )}

      {modal === 'mnemonic' && newMnemonic && (
        <ErrorBoundary
          context="MnemonicModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Recovery Phrase" error={error} reset={reset} onClose={onMnemonicConfirm} />
          )}
        >
          <MnemonicModal mnemonic={newMnemonic} onConfirm={onMnemonicConfirm} />
        </ErrorBoundary>
      )}

      {modal === 'account' && (
        <ErrorBoundary
          context="AccountModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Account" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
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
        </ErrorBoundary>
      )}

      {unlockConfirm && (
        <ErrorBoundary
          context="UnlockConfirmModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Unlock Confirmation" error={error} reset={reset} onClose={onCancelUnlock} />
          )}
        >
          <UnlockConfirmModal
            locks={unlockConfirm === 'all' ? unlockableLocks : [unlockConfirm]}
            onConfirm={onConfirmUnlock}
            onCancel={onCancelUnlock}
            unlocking={isUnlocking}
          />
        </ErrorBoundary>
      )}
    </>
  )
}
