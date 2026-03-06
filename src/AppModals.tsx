import { lazy, Suspense } from 'react'
import { AlertCircle } from 'lucide-react'
import { MnemonicModal, UnlockConfirmModal } from './components/modals'
import type { Account } from './domain/accounts'
import type { LockedUTXO } from './services/wallet'
import type { BRC100Request } from './services/brc100'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { useModalContext, useOrdinalSelection, useWalletSetup, useLockWorkflow } from './contexts'
import { useModalCompoundActions } from './hooks'

// Re-export types from ModalContext for backward compatibility
export type { Modal, AccountModalMode } from './contexts/ModalContext'

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
 * Loading fallback for lazy-loaded modals - shows a spinner overlay
 * while the modal chunk is being fetched on slow connections.
 */
function ModalLoadingFallback() {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-loading">
        <div className="loading-spinner" />
      </div>
    </div>
  )
}

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

interface AppModalsProps {
  // BRC-100 (from useBrc100Handler in App.tsx)
  brc100Request: BRC100Request | null
  onApproveBRC100: () => void
  onRejectBRC100: () => void
  // Account management (from useWallet in App.tsx)
  accounts: Account[]
  activeAccountId: number | null
  onCreateAccount: (name: string) => Promise<boolean>
  onImportAccount: (name: string, mnemonic: string) => Promise<boolean>
  onDeleteAccount: (id: number) => Promise<boolean>
  onRenameAccount: (id: number, name: string) => Promise<boolean>
  // Unlock (computed in App.tsx)
  unlockableLocks: LockedUTXO[]
  onConfirmUnlock: () => void
}

/**
 * Renders all modal components based on the current modal state.
 * Most modal state comes from ModalContext; only cross-cutting props
 * that depend on other contexts are passed as props.
 */
export function AppModals({
  brc100Request,
  onApproveBRC100,
  onRejectBRC100,
  accounts,
  activeAccountId,
  onCreateAccount,
  onImportAccount,
  onDeleteAccount,
  onRenameAccount,
  unlockableLocks,
  onConfirmUnlock,
}: AppModalsProps) {
  // Granular context hooks (A-64: avoid merged useModal() to prevent needless re-renders)
  const { modal, accountModalMode } = useModalContext()
  const ordinalCtx = useOrdinalSelection()
  const { newMnemonic } = useWalletSetup()
  const { unlockConfirm, cancelUnlock, unlocking } = useLockWorkflow()

  // Shared compound actions (Q-121: single source of truth for modal+domain combos)
  const {
    closeModal,
    confirmMnemonic,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
  } = useModalCompoundActions()

  return (
    <>
      {modal === 'send' && (
        <ErrorBoundary
          context="SendModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Send" error={error} reset={reset} onClose={closeModal} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <SendModal onClose={closeModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'lock' && (
        <ErrorBoundary
          context="LockModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Lock" error={error} reset={reset} onClose={closeModal} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <LockModal onClose={closeModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'receive' && (
        <ErrorBoundary
          context="ReceiveModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Receive" error={error} reset={reset} onClose={closeModal} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <ReceiveModal onClose={closeModal} />
          </Suspense>
        </ErrorBoundary>
      )}
      {modal === 'settings' && (
        <ErrorBoundary
          context="SettingsModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Settings" error={error} reset={reset} onClose={closeModal} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <SettingsModal onClose={closeModal} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Q-126: capture selectedOrdinal to avoid non-null assertions in callbacks */}
      {(() => {
        const selected = ordinalCtx.selectedOrdinal
        if (modal !== 'ordinal' || !selected) return null
        return (
          <ErrorBoundary
            context="OrdinalModal"
            fallback={(error, reset) => (
              <ModalErrorFallback modalName="Ordinal" error={error} reset={reset} onClose={closeModal} />
            )}
          >
            <Suspense fallback={<ModalLoadingFallback />}>
              <OrdinalModal
                ordinal={selected}
                onClose={closeModal}
                onTransfer={() => startTransferOrdinal(selected)}
                onList={() => startListOrdinal(selected)}
              />
            </Suspense>
          </ErrorBoundary>
        )
      })()}

      {modal === 'transfer-ordinal' && ordinalCtx.ordinalToTransfer && (
        <ErrorBoundary
          context="OrdinalTransferModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Transfer Ordinal" error={error} reset={reset} onClose={completeTransfer} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <OrdinalTransferModal
              ordinal={ordinalCtx.ordinalToTransfer}
              onClose={completeTransfer}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {modal === 'list-ordinal' && ordinalCtx.ordinalToList && (
        <ErrorBoundary
          context="OrdinalListModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="List Ordinal" error={error} reset={reset} onClose={completeList} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <OrdinalListModal
              ordinal={ordinalCtx.ordinalToList}
              onClose={completeList}
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
          <Suspense fallback={<ModalLoadingFallback />}>
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
            <ModalErrorFallback modalName="Recovery Phrase" error={error} reset={reset} onClose={confirmMnemonic} />
          )}
        >
          <MnemonicModal mnemonic={newMnemonic} onConfirm={confirmMnemonic} />
        </ErrorBoundary>
      )}

      {modal === 'account' && (
        <ErrorBoundary
          context="AccountModal"
          fallback={(error, reset) => (
            <ModalErrorFallback modalName="Account" error={error} reset={reset} onClose={closeModal} />
          )}
        >
          <Suspense fallback={<ModalLoadingFallback />}>
            <AccountModal
              isOpen={true}
              onClose={closeModal}
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
            <ModalErrorFallback modalName="Unlock Confirmation" error={error} reset={reset} onClose={cancelUnlock} />
          )}
        >
          <UnlockConfirmModal
            locks={unlockConfirm === 'all' ? unlockableLocks : [unlockConfirm]}
            onConfirm={onConfirmUnlock}
            onCancel={cancelUnlock}
            unlocking={!!unlocking}
          />
        </ErrorBoundary>
      )}
    </>
  )
}
