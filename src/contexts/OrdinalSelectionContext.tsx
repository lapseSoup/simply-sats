import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { Ordinal } from '../domain/types'

// ---- Context shape ----

interface OrdinalSelectionContextType {
  selectedOrdinal: Ordinal | null
  ordinalToTransfer: Ordinal | null
  ordinalToList: Ordinal | null
  selectOrdinal: (ordinal: Ordinal) => void
  /** B-104: Clear selectedOrdinal to prevent stale state after modal close */
  clearSelectedOrdinal: () => void
  startTransferOrdinal: (ordinal: Ordinal) => void
  startListOrdinal: (ordinal: Ordinal) => void
  completeTransfer: () => void
  completeList: () => void
}

const OrdinalSelectionContext = createContext<OrdinalSelectionContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useOrdinalSelection() {
  const context = useContext(OrdinalSelectionContext)
  if (!context) {
    throw new Error('useOrdinalSelection must be used within an OrdinalSelectionProvider')
  }
  return context
}

interface OrdinalSelectionProviderProps {
  children: ReactNode
}

export function OrdinalSelectionProvider({ children }: OrdinalSelectionProviderProps) {
  const [selectedOrdinal, setSelectedOrdinal] = useState<Ordinal | null>(null)
  const [ordinalToTransfer, setOrdinalToTransfer] = useState<Ordinal | null>(null)
  const [ordinalToList, setOrdinalToList] = useState<Ordinal | null>(null)

  const selectOrdinal = useCallback((ordinal: Ordinal) => {
    setSelectedOrdinal(ordinal)
  }, [])

  const clearSelectedOrdinal = useCallback(() => {
    setSelectedOrdinal(null)
  }, [])

  const startTransferOrdinal = useCallback((ordinal: Ordinal) => {
    setOrdinalToTransfer(ordinal)
  }, [])

  const startListOrdinal = useCallback((ordinal: Ordinal) => {
    setOrdinalToList(ordinal)
  }, [])

  const completeTransfer = useCallback(() => {
    setOrdinalToTransfer(null)
  }, [])

  const completeList = useCallback(() => {
    setOrdinalToList(null)
  }, [])

  const value = useMemo<OrdinalSelectionContextType>(() => ({
    selectedOrdinal,
    ordinalToTransfer,
    ordinalToList,
    selectOrdinal,
    clearSelectedOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
  }), [
    selectedOrdinal,
    ordinalToTransfer,
    ordinalToList,
    selectOrdinal,
    clearSelectedOrdinal,
    startTransferOrdinal,
    startListOrdinal,
    completeTransfer,
    completeList,
  ])

  return (
    <OrdinalSelectionContext.Provider value={value}>
      {children}
    </OrdinalSelectionContext.Provider>
  )
}
