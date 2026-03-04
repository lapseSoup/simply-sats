import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { LockedUTXO } from '../domain/types'

// ---- Context shape ----

interface LockWorkflowContextType {
  unlockConfirm: LockedUTXO | 'all' | null
  unlocking: string | null
  startUnlock: (lock: LockedUTXO) => void
  startUnlockAll: () => void
  cancelUnlock: () => void
  setUnlocking: (txid: string | null) => void
}

const LockWorkflowContext = createContext<LockWorkflowContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useLockWorkflow() {
  const context = useContext(LockWorkflowContext)
  if (!context) {
    throw new Error('useLockWorkflow must be used within a LockWorkflowProvider')
  }
  return context
}

interface LockWorkflowProviderProps {
  children: ReactNode
}

export function LockWorkflowProvider({ children }: LockWorkflowProviderProps) {
  const [unlockConfirm, setUnlockConfirm] = useState<LockedUTXO | 'all' | null>(null)
  const [unlocking, setUnlockingState] = useState<string | null>(null)

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

  const value = useMemo<LockWorkflowContextType>(() => ({
    unlockConfirm,
    unlocking,
    startUnlock,
    startUnlockAll,
    cancelUnlock,
    setUnlocking,
  }), [
    unlockConfirm,
    unlocking,
    startUnlock,
    startUnlockAll,
    cancelUnlock,
    setUnlocking,
  ])

  return (
    <LockWorkflowContext.Provider value={value}>
      {children}
    </LockWorkflowContext.Provider>
  )
}
