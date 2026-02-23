/**
 * SyncContext - Handles wallet synchronization state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides sync-related state that can be consumed independently.
 *
 * Logic is delegated to extracted hooks:
 *   - useSyncData: fetchDataFromDB, fetchData
 *   - useSyncOrchestration: performSync
 *   - useOrdinalCache: fetchOrdinalContentIfMissing
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { WalletKeys, UTXO, Ordinal, LockedUTXO } from '../services/wallet'
import { useNetwork } from './NetworkContext'

// Extracted hooks
import { useSyncData } from '../hooks/useSyncData'
import { useSyncOrchestration } from '../hooks/useSyncOrchestration'
import { useOrdinalCache } from '../hooks/useOrdinalCache'

/** Cached content for rendering ordinal previews */
export interface OrdinalContentEntry {
  contentData?: Uint8Array
  contentText?: string
  /** Actual MIME type resolved from HTTP response header — used to render the correct preview */
  contentType?: string
}

export interface TxHistoryItem {
  tx_hash: string
  height: number
  amount?: number
  address?: string
  description?: string
  createdAt?: number
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
  ordinalContentCache: Map<string, OrdinalContentEntry>

  // State setters (for WalletContext to update when needed)
  setUtxos: (utxos: UTXO[]) => void
  setOrdinals: (ordinals: Ordinal[]) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  setBasketBalances: (balances: BasketBalances) => void
  setBalance: (balance: number) => void
  setOrdBalance: (balance: number) => void

  // Actions
  resetSync: (initialBalance?: number) => void
  performSync: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore?: boolean,
    forceReset?: boolean,
    silent?: boolean,
    isCancelled?: () => boolean
  ) => Promise<void>
  /** Load all data from local DB only (no API calls). Used for instant account switching. */
  fetchDataFromDB: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    onLocksLoaded: (locks: LockedUTXO[]) => void,
    isCancelled?: () => boolean
  ) => Promise<void>
  fetchData: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: import('../services/wallet').LockedUTXO[] }) => void,
    isCancelled?: () => boolean
  ) => Promise<void>
  /**
   * Fetch and cache ordinal content if not already in the in-memory cache.
   * Used by ActivityTab to lazily load thumbnails for transferred ordinals
   * that are missing from the cache after a fresh seed restore.
   */
  fetchOrdinalContentIfMissing: (origin: string, contentType?: string, accountId?: number) => Promise<void>
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
  const { setSyncing } = useNetwork()

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
  const [balance, setBalance] = useState<number>(0)
  const [ordBalance, setOrdBalance] = useState<number>(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ordinalContentCache, setOrdinalContentCache] = useState<Map<string, OrdinalContentEntry>>(new Map())
  const contentCacheRef = useRef<Map<string, OrdinalContentEntry>>(new Map())
  // Ref so fetchData can read the current ordinals count without a stale closure
  const ordinalsRef = useRef<Ordinal[]>(ordinals)
  // Keep ref in sync with state
  const setOrdinalsWithRef = useCallback((next: Ordinal[]) => {
    ordinalsRef.current = next
    setOrdinals(next)
  }, [])

  const resetSync = useCallback((initialBalance = 0) => {
    setUtxos([])
    setOrdinalsWithRef([])
    setTxHistory([])
    setBasketBalances({ default: 0, ordinals: 0, identity: 0, derived: 0, locks: 0 })
    setBalance(initialBalance)
    setOrdBalance(0)
    setSyncError(null)
    setOrdinalContentCache(new Map())
    contentCacheRef.current = new Map()
  }, [setOrdinalsWithRef])

  // --- Extracted hooks ---

  const { fetchDataFromDB, fetchData } = useSyncData({
    setBalance,
    setOrdBalance,
    setTxHistory,
    setUtxos,
    setOrdinalsWithRef,
    setSyncError,
    setOrdinalContentCache,
    contentCacheRef,
    ordinalsRef
  })

  const { performSync } = useSyncOrchestration({
    setSyncing,
    setBalance,
    setBasketBalances,
    setTxHistory,
    setSyncError
  })

  const { fetchOrdinalContentIfMissing } = useOrdinalCache({
    contentCacheRef,
    setOrdinalContentCache
  })

  // --- Context value ---

  const value: SyncContextType = useMemo(() => ({
    utxos,
    ordinals,
    txHistory,
    basketBalances,
    balance,
    ordBalance,
    syncError,
    ordinalContentCache,
    setUtxos,
    setOrdinals: setOrdinalsWithRef,
    setTxHistory,
    setBasketBalances,
    setBalance,
    setOrdBalance,
    resetSync,
    performSync,
    fetchDataFromDB,
    fetchData,
    fetchOrdinalContentIfMissing
  }), [utxos, ordinals, txHistory, basketBalances, balance, ordBalance, syncError, ordinalContentCache, setUtxos, setOrdinalsWithRef, setTxHistory, setBasketBalances, setBalance, setOrdBalance, resetSync, performSync, fetchDataFromDB, fetchData, fetchOrdinalContentIfMissing])

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}
