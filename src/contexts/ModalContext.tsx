import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { Ordinal, LockedUTXO } from '../services/wallet'

// ---- Types (moved from AppModals.tsx) ----

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

// ---- Context shape ----

interface ModalContextType {
  // State
  modal: Modal
  accountModalMode: AccountModalMode
  ordinalToTransfer: Ordinal | null
  ordinalToList: Ordinal | null
  selectedOrdinal: Ordinal | null
  newMnemonic: string | null
  unlockConfirm: LockedUTXO | 'all' | null
  unlocking: string | null

  // Actions
  openModal: (modal: Modal) => void
  closeModal: () => void
  openAccountModal: (mode: AccountModalMode) => void
  selectOrdinal: (ordinal: Ordinal) => void
  startTransferOrdinal: (ordinal: Ordinal) => void
  startListOrdinal: (ordinal: Ordinal) => void
  completeTransfer: () => void
  completeList: () => void
  setNewMnemonic: (mnemonic: string | null) => void
  confirmMnemonic: () => void
  startUnlock: (lock: LockedUTXO) => void
  startUnlockAll: () => void
  cancelUnlock: () => void
  setUnlocking: (txid: string | null) => void
}

const ModalContext = createContext<ModalContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useModal() {
  const context = useContext(ModalContext)
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return context
}

interface ModalProviderProps {
  children: ReactNode
}

export function ModalProvider({ children }: ModalProviderProps) {
  const [modal, setModal] = useState<Modal>(null)
  const [accountModalMode, setAccountModalMode] = useState<AccountModalMode>('manage')
  const [ordinalToTransfer, setOrdinalToTransfer] = useState<Ordinal | null>(null)
  const [ordinalToList, setOrdinalToList] = useState<Ordinal | null>(null)
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)
  const [newMnemonic, setNewMnemonicState] = useState<string | null>(null)
  const [unlockConfirm, setUnlockConfirm] = useState<LockedUTXO | 'all' | null>(null)
  const [unlocking, setUnlockingState] = useState<string | null>(null)

  // ---- Actions ----

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

  const selectOrdinal = useCallback((ordinal: Ordinal) => {
    setSelectedOrdinal(ordinal)
    setModal('ordinal')
  }, [])

  const startTransferOrdinal = useCallback((ordinal: Ordinal) => {
    setOrdinalToTransfer(ordinal)
    setModal('transfer-ordinal')
  }, [])

  const startListOrdinal = useCallback((ordinal: Ordinal) => {
    setOrdinalToList(ordinal)
    setModal('list-ordinal')
  }, [])

  const completeTransfer = useCallback(() => {
    setOrdinalToTransfer(null)
    setModal(null)
  }, [])

  const completeList = useCallback(() => {
    setOrdinalToList(null)
    setModal(null)
  }, [])

  const setNewMnemonic = useCallback((mnemonic: string | null) => {
    setNewMnemonicState(mnemonic)
  }, [])

  const confirmMnemonic = useCallback(() => {
    setNewMnemonicState(null)
    setModal(null)
  }, [])

  const startUnlock = useCallback((lock: LockedUTXO) => {
    setUnlockConfirm(lock)
  }, [])

  const startUnlockAll = useCallback(() => {
    setUnlockConfirm('all')
  }, [])

  const cancelUnlock = useCallback(() => {
    setUnlockConfirm(null)
  }, [])

  const setUnlocking = useCallback((txid: string | null) => {
    setUnlockingState(txid)
  }, [])

  const value = useMemo<ModalContextType>(() => ({
    // State
    modal,
    accountModalMode,
    ordinalToTransfer,
    ordinalToList,
    selectedOrdinal,
    newMnemonic,
    unlockConfirm,
    unlocking,
    // Actions
    openModal,
    closeModal,
    openAccountModal,
    selectOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
    setNewMnemonic,
    confirmMnemonic,
    startUnlock,
    startUnlockAll,
    cancelUnlock,
    setUnlocking,
  }), [
    modal,
    accountModalMode,
    ordinalToTransfer,
    ordinalToList,
    selectedOrdinal,
    newMnemonic,
    unlockConfirm,
    unlocking,
    openModal,
    closeModal,
    openAccountModal,
    selectOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
    setNewMnemonic,
    confirmMnemonic,
    startUnlock,
    startUnlockAll,
    cancelUnlock,
    setUnlocking,
  ])

  return (
    <ModalContext.Provider value={value}>
      {children}
    </ModalContext.Provider>
  )
}
