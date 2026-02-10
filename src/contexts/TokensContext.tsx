import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import {
  type TokenBalance,
  syncTokenBalances,
  sendToken
} from '../services/tokens'
import { getUTXOs, type WalletKeys } from '../services/wallet'
import { tokenLogger } from '../services/logger'

interface TokensContextType {
  tokenBalances: TokenBalance[]
  tokensSyncing: boolean
  resetTokens: () => void
  refreshTokens: (wallet: WalletKeys, accountId: number) => Promise<void>
  sendTokenAction: (
    wallet: WalletKeys,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ) => Promise<{ success: boolean; txid?: string; error?: string }>
}

const TokensContext = createContext<TokensContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useTokens() {
  const context = useContext(TokensContext)
  if (!context) {
    throw new Error('useTokens must be used within a TokensProvider')
  }
  return context
}

interface TokensProviderProps {
  children: ReactNode
}

export function TokensProvider({ children }: TokensProviderProps) {
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([])
  const [tokensSyncing, setTokensSyncing] = useState(false)
  const tokensSyncingRef = useRef(false)

  const resetTokens = useCallback(() => {
    setTokenBalances([])
    setTokensSyncing(false)
    tokensSyncingRef.current = false
  }, [])

  const refreshTokens = useCallback(async (wallet: WalletKeys, accountId: number) => {
    // Use ref to avoid stale closure — prevents callback recreation on every toggle
    if (tokensSyncingRef.current) return

    tokensSyncingRef.current = true
    setTokensSyncing(true)
    try {
      const balances = await syncTokenBalances(
        accountId,
        wallet.walletAddress,
        wallet.ordAddress
      )
      setTokenBalances(balances)
      tokenLogger.info(`Synced ${balances.length} token balances`)
    } catch (e) {
      tokenLogger.error('Failed to sync tokens', e)
    } finally {
      tokensSyncingRef.current = false
      setTokensSyncing(false)
    }
  }, [])

  const sendTokenAction = useCallback(async (
    wallet: WalletKeys,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<{ success: boolean; txid?: string; error?: string }> => {
    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return { success: false, error: 'No funding UTXOs available for transfer fee' }
      }

      const result = await sendToken(
        wallet.walletAddress,
        wallet.ordAddress,
        wallet.walletWif,
        wallet.ordWif,
        fundingUtxos,
        ticker,
        protocol,
        amount,
        toAddress
      )

      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Token transfer failed' }
    }
  }, [])

  const value: TokensContextType = useMemo(() => ({
    tokenBalances,
    tokensSyncing,
    resetTokens,
    refreshTokens,
    sendTokenAction
  }), [tokenBalances, tokensSyncing, resetTokens, refreshTokens, sendTokenAction])

  return (
    <TokensContext.Provider value={value}>
      {children}
    </TokensContext.Provider>
  )
}
