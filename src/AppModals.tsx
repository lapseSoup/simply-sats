import { lazy, Suspense } from 'react'
import { AlertCircle } from 'lucide-react'
import { MnemonicModal, UnlockConfirmModal } from './components/modals'
import type { Ordinal, LockedUTXO } from './services/wallet'
import type { BRC100Request } from './services/brc100'
import type { Account } from './services/accounts'
import { ErrorBoundary } from './components/shared/ErrorBoundary'

// Lazy-loaded modals for code splitting (only loaded when first opened)
const SendModal = lazy(() => import('./components/modals/SendModal').then(m => ({ default: m.SendModal })))
const LockModal = lazy(() => import('./components/modals/LockModal').then(m => ({ default: m.LockModal })))
const ReceiveModal = lazy(() => import('./components/modals/ReceiveModal').then(m => ({ default: m.ReceiveModal })))
const SettingsModal = lazy(() => import('./components/modals/SettingsModal').then(m => ({ default: m.SettingsModal })))
const AccountModal = lazy(() => import('./components/modals/AccountModal').then(m => ({ default: m.AccountModal })))
const BRC100Modal = lazy(() => import('./components/modals/BRC100Modal').then(m => ({ default: m.BRC100Modal })))
const OrdinalModal = lazy(() => import('./components/modals/OrdinalModal').then(m => ({ default: m.OrdinalModal })))
const OrdinalTransferModal = lazy(() => import('./components/modals/OrdinalTransferModal').then(m => ({ default: m.OrdinalTransferModal })))
const OrdinalListModal = lazy(() => import('./components/modals/OrdinalListModal').then(m => ({ default: m.OrdinalListModal })))

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
          <Suspense fallback={null}>
            <SendModal onClose={onCloseModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'lock' && (
        <ErrorBoundary
          context="LockModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Lock" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <Suspense fallback={null}>
            <LockModal onClose={onCloseModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'receive' && (
        <ErrorBoundary
          context="ReceiveModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Receive" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <Suspense fallback={null}>
            <ReceiveModal onClose={onCloseModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'settings' && (
        <ErrorBoundary
          context="SettingsModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Settings" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <Suspense fallback={null}>
            <SettingsModal onClose={onCloseModal} />
          </Suspense>
        </ErrorBoundary>
      )}

      {modal === 'ordinal' && selectedOrdinal && (
        <ErrorBoundary
          context="OrdinalModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Ordinal" error={error} reset={reset} onClose={onCloseModal} />
          )}
        >
          <Suspense fallback={null}>
            <OrdinalModal
              ordinal={selectedOrdinal}
              onClose={onCloseModal}
              onTransfer={() => onTransferOrdinal(selectedOrdinal)}
              onList={() => onListOrdinal(selectedOrdinal)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {modal === 'transfer-ordinal' && ordinalToTransfer && (
        <ErrorBoundary
          context="OrdinalTransferModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Transfer Ordinal" error={error} reset={reset} onClose={onTransferComplete} />
          )}
        >
          <Suspense fallback={null}>
            <OrdinalTransferModal
              ordinal={ordinalToTransfer}
              onClose={onTransferComplete}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {modal === 'list-ordinal' && ordinalToList && (
        <ErrorBoundary
          context="OrdinalListModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="List Ordinal" error={error} reset={reset} onClose={onListComplete} />
          )}
        >
          <Suspense fallback={null}>
            <OrdinalListModal
              ordinal={ordinalToList}
              onClose={onListComplete}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {modal === 'brc100' && brc100Request && (
        <ErrorBoundary
          context="BRC100Modal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="BRC-100 Request" error={error} reset={reset} onClose={onRejectBRC100} />
          )}
        >
          <Suspense fallback={null}>
            <BRC100Modal
              request={brc100Request}
              onApprove={onApproveBRC100}
              onReject={onRejectBRC100}
            />
          </Suspense>
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
          <Suspense fallback={null}>
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
          </Suspense>
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
