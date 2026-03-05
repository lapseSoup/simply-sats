import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { Ordinal } from '../domain/types'
import { useOrdinalSelection } from './OrdinalSelectionContext'
import { useWalletSetup } from './WalletSetupContext'
import { useLockWorkflow } from './LockWorkflowContext'

// ---- Types ----

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

// ---- Slim ModalContext (UI-only: which modal is open) ----

interface ModalContextType {
  modal: Modal
  accountModalMode: AccountModalMode
  openModal: (modal: Modal) => void
  closeModal: () => void
  openAccountModal: (mode: AccountModalMode) => void
}

const ModalContext = createContext<ModalContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useModalContext() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModalContext must be used within a ModalProvider')
  }
  return context
}

// ---- Combined hook for backward compatibility ----
// Merges ModalContext + OrdinalSelectionContext + WalletSetupContext + LockWorkflowContext
// so existing consumers don't need to change their imports.

/**
 * @deprecated Use the granular hooks instead to avoid unnecessary re-renders:
 * - `useModalContext()` for modal open/close state
 * - `useOrdinalSelection()` for ordinal selection/transfer/list state
 * - `useWalletSetup()` for mnemonic/setup state
 * - `useLockWorkflow()` for unlock/lock workflow state
 *
 * This hook merges 4 contexts into a single 22-field object, which means
 * any change to any sub-context will re-render all useModal() consumers.
 * Compound actions (e.g. selectOrdinal + openModal) should be composed
 * at the call site using useCallback.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useModal() {
  const modalCtx = useModalContext()
  const ordinalCtx = useOrdinalSelection()
  const walletSetupCtx = useWalletSetup()
  const lockCtx = useLockWorkflow()

  // Compound actions that set domain state AND open/close the modal.
  // These preserve the original behavior where e.g. selectOrdinal both
  // sets the selected ordinal and opens the 'ordinal' modal.
  const selectOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.selectOrdinal(ordinal)
    modalCtx.openModal('ordinal')
  }, [ordinalCtx, modalCtx])

  const startTransferOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.startTransferOrdinal(ordinal)
    modalCtx.openModal('transfer-ordinal')
  }, [ordinalCtx, modalCtx])

  const startListOrdinal = useCallback((ordinal: Ordinal) => {
    ordinalCtx.startListOrdinal(ordinal)
    modalCtx.openModal('list-ordinal')
  }, [ordinalCtx, modalCtx])

  const completeTransfer = useCallback(() => {
    ordinalCtx.completeTransfer()
    modalCtx.closeModal()
  }, [ordinalCtx, modalCtx])

  const completeList = useCallback(() => {
    ordinalCtx.completeList()
    modalCtx.closeModal()
  }, [ordinalCtx, modalCtx])

  const confirmMnemonic = useCallback(() => {
    walletSetupCtx.confirmMnemonic()
    modalCtx.closeModal()
  }, [walletSetupCtx, modalCtx])

  // B-104: Clear selectedOrdinal when closing any modal to prevent stale state
  // B-111: Also clear ordinalToTransfer/ordinalToList to prevent stale references
  // B-136: Only call cleanup when there's actually ordinal state to clear,
  // avoiding unnecessary re-renders when closing non-ordinal modals.
  const closeModal = useCallback(() => {
    modalCtx.closeModal()
    if (ordinalCtx.selectedOrdinal) ordinalCtx.clearSelectedOrdinal()
    if (ordinalCtx.ordinalToTransfer) ordinalCtx.completeTransfer()
    if (ordinalCtx.ordinalToList) ordinalCtx.completeList()
  }, [modalCtx, ordinalCtx])

  return useMemo(() => ({
    // ModalContext (UI state)
    modal: modalCtx.modal,
    accountModalMode: modalCtx.accountModalMode,
    openModal: modalCtx.openModal,
    closeModal,
    openAccountModal: modalCtx.openAccountModal,
    // OrdinalSelectionContext (compound actions)
    selectedOrdinal: ordinalCtx.selectedOrdinal,
    ordinalToTransfer: ordinalCtx.ordinalToTransfer,
    ordinalToList: ordinalCtx.ordinalToList,
    selectOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
    // WalletSetupContext
    newMnemonic: walletSetupCtx.newMnemonic,
    setNewMnemonic: walletSetupCtx.setNewMnemonic,
    confirmMnemonic,
    // LockWorkflowContext
    unlockConfirm: lockCtx.unlockConfirm,
    unlocking: lockCtx.unlocking,
    startUnlock: lockCtx.startUnlock,
    startUnlockAll: lockCtx.startUnlockAll,
    cancelUnlock: lockCtx.cancelUnlock,
    setUnlocking: lockCtx.setUnlocking,
  }), [
    modalCtx.modal, modalCtx.accountModalMode, modalCtx.openModal,
    closeModal, modalCtx.openAccountModal,
    ordinalCtx.selectedOrdinal, ordinalCtx.ordinalToTransfer,
    ordinalCtx.ordinalToList,
    selectOrdinal, startTransferOrdinal, startListOrdinal,
    completeTransfer, completeList,
    walletSetupCtx.newMnemonic, walletSetupCtx.setNewMnemonic,
    confirmMnemonic,
    lockCtx.unlockConfirm, lockCtx.unlocking, lockCtx.startUnlock,
    lockCtx.startUnlockAll, lockCtx.cancelUnlock, lockCtx.setUnlocking,
  ])
}

// ---- Slim ModalProvider ----

interface ModalProviderProps {
  children: ReactNode
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [modal, setModal] = useState<Modal>(null)
  const [accountModalMode, setAccountModalMode] = useState<AccountModalMode>('manage')

  const openModal = useCallback((m: Modal) => {
    setModal(m)
  }, [])

  const closeModal = useCallback(() => {
    setModal(null)
  }, [])

  const openAccountModal = useCallback((mode: AccountModalMode) => {
    setAccountModalMode(mode)
    setModal('account')
  }, [])

  const value = useMemo<ModalContextType>(() => ({
    modal,
    accountModalMode,
    openModal,
    closeModal,
    openAccountModal,
  }), [
    modal,
    accountModalMode,
    openModal,
    closeModal,
    openAccountModal,
  ])

  return (
    <ModalContext.Provider value={value}>
      {children}
    </ModalContext.Provider>
  )
}
