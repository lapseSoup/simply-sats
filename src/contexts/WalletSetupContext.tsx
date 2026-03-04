import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

// ---- Context shape ----

interface WalletSetupContextType {
  newMnemonic: string | null
  setNewMnemonic: (mnemonic: string | null) => void
  confirmMnemonic: () => void
}

const WalletSetupContext = createContext<WalletSetupContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useWalletSetup() {
  const context = useContext(WalletSetupContext)
  if (!context) {
    throw new Error('useWalletSetup must be used within a WalletSetupProvider')
  }
  return context
}

interface WalletSetupProviderProps {
  children: ReactNode
}

export function WalletSetupProvider({ children }: WalletSetupProviderProps) {
  const [newMnemonic, setNewMnemonicState] = useState<string | null>(null)

  const setNewMnemonic = useCallback((mnemonic: string | null) => {
    setNewMnemonicState(mnemonic)
  }, [])

  const confirmMnemonic = useCallback(() => {
    setNewMnemonicState(null)
  }, [])

  const value = useMemo<WalletSetupContextType>(() => ({
    newMnemonic,
    setNewMnemonic,
    confirmMnemonic,
  }), [
    newMnemonic,
    setNewMnemonic,
    confirmMnemonic,
  ])

  return (
    <WalletSetupContext.Provider value={value}>
      {children}
    </WalletSetupContext.Provider>
  )
}
