import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import {
  type TokenBalance,
  syncTokenBalances,
  sendToken,
  sendTokenFromStore
} from '../services/tokens'
import type { ActiveWallet } from '../domain/types'
import { hasPrivateKeyMaterial } from '../domain/types'
import { getUTXOs } from '../services/wallet'
import { isTauri } from '../utils/tauri'
import { tokenLogger } from '../services/logger'
import { err, type Result } from '../domain/types'
import { acquireSyncLock } from '../services/cancellation'
import { useAccountsState } from './AccountsContext'

interface TokensContextType {
  tokenBalances: TokenBalance[]
  tokensSyncing: boolean
  resetTokens: () => void
  refreshTokens: (wallet: ActiveWallet, accountId: number) => Promise<void>
  sendTokenAction: (
    wallet: ActiveWallet,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ) => Promise<Result<{ txid: string }, string>>
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
  const { activeAccountId } = useAccountsState()
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([])
  const [tokensSyncing, setTokensSyncing] = useState(false)
  const tokensSyncingRef = useRef(false)
  const lastRequestedAccountRef = useRef<number | null>(null)

  const resetTokens = useCallback(() => {
    setTokenBalances([])
    setTokensSyncing(false)
    tokensSyncingRef.current = false
    lastRequestedAccountRef.current = null
  }, [])

  const refreshTokens = useCallback(async (wallet: ActiveWallet, accountId: number) => {
    // Use ref to avoid stale closure — prevents callback recreation on every toggle
    if (tokensSyncingRef.current) return

    tokensSyncingRef.current = true
    lastRequestedAccountRef.current = accountId
    setTokensSyncing(true)
    try {
      const balances = await syncTokenBalances(
        accountId,
        wallet.walletAddress,
        wallet.ordAddress
      )
      // Guard: discard results if a newer request was made for a different account
      if (lastRequestedAccountRef.current !== accountId) {
        tokenLogger.debug('Token sync result discarded — account changed during sync', { requestedAccount: accountId, currentAccount: lastRequestedAccountRef.current })
        return
      }
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
    wallet: ActiveWallet,
    ticker: string,
    protocol: 'bsv20' | 'bsv21',
    amount: string,
    toAddress: string
  ): Promise<Result<{ txid: string }, string>> => {
    const releaseLock = await acquireSyncLock(activeAccountId ?? 1)
    try {
      const fundingUtxos = await getUTXOs(wallet.walletAddress)

      if (fundingUtxos.length === 0) {
        return err('No funding UTXOs available for transfer fee')
      }

      const result = isTauri()
        ? await sendTokenFromStore(
          wallet.walletAddress,
          wallet.ordAddress,
          fundingUtxos,
          ticker,
          protocol,
          amount,
          toAddress
        )
        : await (async () => {
          if (!hasPrivateKeyMaterial(wallet)) {
            return err('Private keys are unavailable in this session')
          }
          return sendToken(
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
        })()

      return result
    } catch (e) {
      return err(e instanceof Error ? e.message : 'Token transfer failed')
    } finally {
      releaseLock()
    }
  }, [activeAccountId])

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
