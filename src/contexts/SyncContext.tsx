/**
 * SyncContext - Handles wallet synchronization state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides sync-related state that can be consumed independently.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { WalletKeys, UTXO, Ordinal } from '../services/wallet'
import { getBalance, getUTXOs, getOrdinals } from '../services/wallet'
import { getAllTransactions, getDerivedAddresses } from '../services/database'
import {
  syncWallet,
  restoreFromBlockchain,
  getBalanceFromDatabase,
  getOrdinalsFromDatabase
} from '../services/sync'
import { useNetwork } from './NetworkContext'
import { syncLogger } from '../services/logger'

export interface TxHistoryItem {
  tx_hash: string
  height: number
  amount?: number
  address?: string
}

export interface BasketBalances {
  default: number
  ordinals: number
  identity: number
  derived: number
  locks: number
}

interface SyncContextType {
  // State
  utxos: UTXO[]
  ordinals: Ordinal[]
  txHistory: TxHistoryItem[]
  basketBalances: BasketBalances
  balance: number
  ordBalance: number
  syncError: string | null

  // State setters (for WalletContext to update when needed)
  setUtxos: (utxos: UTXO[]) => void
  setOrdinals: (ordinals: Ordinal[]) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  setBasketBalances: (balances: BasketBalances) => void
  setBalance: (balance: number) => void
  setOrdBalance: (balance: number) => void

  // Actions
  resetSync: () => void
  performSync: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore?: boolean
  ) => Promise<void>
  fetchData: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean }) => void
  ) => Promise<void>
}

const SyncContext = createContext<SyncContextType | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncContext() {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSyncContext must be used within a SyncProvider')
  }
  return context
}

interface SyncProviderProps {
  children: ReactNode
}

export function SyncProvider({ children }: SyncProviderProps) {
  const { syncing, setSyncing } = useNetwork()

  // Sync-related state
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [basketBalances, setBasketBalances] = useState<BasketBalances>({
    default: 0,
    ordinals: 0,
    identity: 0,
    derived: 0,
    locks: 0
  })
  const [balance, setBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_balance')
    return cached ? parseInt(cached, 10) : 0
  })
  const [ordBalance, setOrdBalance] = useState<number>(() => {
    const cached = localStorage.getItem('simply_sats_cached_ord_balance')
    return cached ? parseInt(cached, 10) : 0
  })
  const [syncError, setSyncError] = useState<string | null>(null)

  const resetSync = useCallback(() => {
    setUtxos([])
    setOrdinals([])
    setTxHistory([])
    setBasketBalances({ default: 0, ordinals: 0, identity: 0, derived: 0, locks: 0 })
    setBalance(0)
    setOrdBalance(0)
    setSyncError(null)
  }, [])

  // Sync wallet with blockchain
  const performSync = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore = false
  ) => {
    if (syncing) return

    setSyncing(true)
    try {
      syncLogger.info('Starting wallet sync...', { accountId: activeAccountId })
      if (isRestore) {
        await restoreFromBlockchain(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          activeAccountId || undefined
        )
      } else {
        await syncWallet(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          activeAccountId || undefined
        )
      }
      syncLogger.info('Sync complete')
      setSyncError(null)

      // Update basket balances from database (scoped to account)
      try {
        const [defaultBal, ordBal, idBal, lockBal, derivedBal] = await Promise.all([
          getBalanceFromDatabase('default', activeAccountId || undefined),
          getBalanceFromDatabase('ordinals', activeAccountId || undefined),
          getBalanceFromDatabase('identity', activeAccountId || undefined),
          getBalanceFromDatabase('locks', activeAccountId || undefined),
          getBalanceFromDatabase('derived', activeAccountId || undefined)
        ])

        setBasketBalances({
          default: defaultBal,
          ordinals: ordBal,
          identity: idBal,
          locks: lockBal,
          derived: derivedBal
        })

        const totalBalance = defaultBal + derivedBal
        setBalance(totalBalance)
        localStorage.setItem('simply_sats_cached_balance', String(totalBalance))
      } catch (e) {
        syncLogger.error('Failed to get basket balances', e)
      }
    } catch (error) {
      setSyncError('Sync failed')
      syncLogger.error('Sync failed', error)
    } finally {
      setSyncing(false)
    }
  }, [syncing, setSyncing])

  // Fetch data from database and API
  const fetchData = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean }) => void
  ) => {
    syncLogger.debug('Fetching data (database-first approach)...', {
      activeAccountId,
      walletAddress: wallet.walletAddress.slice(0, 12) + '...'
    })

    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default', activeAccountId || undefined),
        getBalanceFromDatabase('derived', activeAccountId || undefined)
      ])
      const totalBalance = defaultBal + derivedBal
      setBalance(totalBalance)
      localStorage.setItem('simply_sats_cached_balance', String(totalBalance))
      setSyncError(null)

      // Get ordinals balance from API
      try {
        const [ordBal, idBal] = await Promise.all([
          getBalance(wallet.ordAddress),
          getBalance(wallet.identityAddress)
        ])
        const totalOrdBalance = ordBal + idBal
        setOrdBalance(totalOrdBalance)
        localStorage.setItem('simply_sats_cached_ord_balance', String(totalOrdBalance))
      } catch (_e) {
        // On API failure, keep current React state — don't overwrite with stale cache
        syncLogger.warn('Failed to fetch ord balance from API, keeping current value')
      }

      // Get transaction history from DATABASE (scoped to account)
      const dbTxs = await getAllTransactions(30, activeAccountId || undefined)
      const dbTxHistory: TxHistoryItem[] = dbTxs.map(tx => ({
        tx_hash: tx.txid,
        height: tx.blockHeight || 0,
        amount: tx.amount
      }))

      dbTxHistory.sort((a, b) => {
        const aHeight = a.height || 0
        const bHeight = b.height || 0
        if (aHeight === 0 && bHeight !== 0) return -1
        if (bHeight === 0 && aHeight !== 0) return 1
        return bHeight - aHeight
      })

      setTxHistory(dbTxHistory)

      // Get ordinals - first from database (already synced), then supplement with API calls
      try {
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId || undefined)
        syncLogger.debug('Found ordinals in database', { count: dbOrdinals.length, accountId: activeAccountId })

        // Get derived addresses
        const derivedAddrs = await getDerivedAddresses()

        // Fetch from all addresses in parallel
        const [ordAddressOrdinals, walletAddressOrdinals, identityAddressOrdinals, ...derivedOrdinals] = await Promise.all([
          getOrdinals(wallet.ordAddress).catch(() => []),
          getOrdinals(wallet.walletAddress).catch(() => []),
          getOrdinals(wallet.identityAddress).catch(() => []),
          ...derivedAddrs.map(d => getOrdinals(d.address).catch(() => []))
        ])

        // Combine and deduplicate by origin
        const seen = new Set<string>()
        const allOrdinals = [
          ...dbOrdinals,
          ...ordAddressOrdinals,
          ...walletAddressOrdinals,
          ...identityAddressOrdinals,
          ...derivedOrdinals.flat()
        ].filter(ord => {
          if (seen.has(ord.origin)) return false
          seen.add(ord.origin)
          return true
        })

        setOrdinals(allOrdinals)
      } catch (e) {
        syncLogger.error('Failed to fetch ordinals', e)
      }

      // Fetch UTXOs and notify about lock detection
      try {
        const utxoList = await getUTXOs(wallet.walletAddress)
        setUtxos(utxoList)
        // Notify caller about UTXOs for lock detection
        onLocksDetected({
          utxos: utxoList,
          shouldClearLocks: knownUnlockedLocks.size > 0
        })
      } catch (e) {
        syncLogger.error('Failed to fetch UTXOs', e)
      }
    } catch (error) {
      setSyncError('Failed to load wallet data')
      syncLogger.error('Failed to fetch data', error)
    }
  }, [])

  const value: SyncContextType = {
    utxos,
    ordinals,
    txHistory,
    basketBalances,
    balance,
    ordBalance,
    syncError,
    setUtxos,
    setOrdinals,
    setTxHistory,
    setBasketBalances,
    setBalance,
    setOrdBalance,
    resetSync,
    performSync,
    fetchData
  }

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}
