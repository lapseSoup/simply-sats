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

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode, type MutableRefObject } from 'react'
import type { WalletKeys, UTXO, Ordinal, LockedUTXO, TxHistoryItem } from '../domain/types'
import { useSyncStatus } from './NetworkContext'

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

// Re-export from domain/types for backward compatibility
export type { TxHistoryItem } from '../domain/types'

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
  /** Account ID that the current account-scoped sync state belongs to. */
  scopedDataAccountId: number | null
  basketBalances: BasketBalances
  balance: number
  ordBalance: number
  syncError: string | null
  /** Ref-based ordinal content cache — read via .current. Does not trigger re-renders on mutation. */
  contentCacheRef: Readonly<MutableRefObject<Map<string, OrdinalContentEntry>>>
  /** Incremented when a batch of cache entries is added. Subscribe to this to re-render. */
  cacheVersion: number

  // State setters (for WalletContext to update when needed)
  setUtxos: (utxos: UTXO[]) => void
  setOrdinals: (ordinals: Ordinal[]) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  setScopedDataAccountId: (accountId: number | null) => void
  setBasketBalances: (balances: BasketBalances) => void
  setBalance: (balance: number) => void
  setOrdBalance: (balance: number) => void
  setSyncError: (error: string | null) => void

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
    getKnownUnlockedLocks: () => Set<string>,
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
  const { setSyncing } = useSyncStatus()

  // Sync-related state
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [ordinals, setOrdinals] = useState<Ordinal[]>([])
  const [txHistory, setTxHistory] = useState<TxHistoryItem[]>([])
  const [scopedDataAccountId, setScopedDataAccountId] = useState<number | null>(null)
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
  const contentCacheRef = useRef<Map<string, OrdinalContentEntry>>(new Map())
  const [cacheVersion, setCacheVersion] = useState(0)
  // Ref so fetchData can read the current ordinals count without a stale closure
  const ordinalsRef = useRef<Ordinal[]>(ordinals)
  // Keep ref in sync with state
  const setOrdinalsWithRef = useCallback((next: Ordinal[]) => {
    ordinalsRef.current = next
    setOrdinals(next)
  }, [])

  /** Increment cacheVersion to notify consumers that contentCacheRef has new entries */
  const bumpCacheVersion = useCallback(() => {
    setCacheVersion(v => v + 1)
  }, [])

  const resetSync = useCallback((initialBalance = 0) => {
    setUtxos([])
    setOrdinalsWithRef([])
    setTxHistory([])
    setScopedDataAccountId(null)
    setBasketBalances({ default: 0, ordinals: 0, identity: 0, derived: 0, locks: 0 })
    setBalance(initialBalance)
    setOrdBalance(0)
    setSyncError(null)
    contentCacheRef.current = new Map()
    setCacheVersion(0)
  }, [setOrdinalsWithRef])

  // --- Extracted hooks ---

  const { fetchDataFromDB, fetchData } = useSyncData({
    setBalance,
    setOrdBalance,
    setTxHistory,
    setScopedDataAccountId,
    setUtxos,
    setOrdinalsWithRef,
    ordinalsRef,
    setSyncError,
    bumpCacheVersion,
    contentCacheRef,
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
    bumpCacheVersion
  })

  // --- Context value ---

  const value: SyncContextType = useMemo(() => ({
    utxos,
    ordinals,
    txHistory,
    scopedDataAccountId,
    basketBalances,
    balance,
    ordBalance,
    syncError,
    contentCacheRef,
    cacheVersion,
    setUtxos,
    setOrdinals: setOrdinalsWithRef,
    setTxHistory,
    setScopedDataAccountId,
    setBasketBalances,
    setBalance,
    setOrdBalance,
    setSyncError,
    resetSync,
    performSync,
    fetchDataFromDB,
    fetchData,
    fetchOrdinalContentIfMissing
  }), [utxos, ordinals, txHistory, scopedDataAccountId, basketBalances, balance, ordBalance, syncError, cacheVersion, setUtxos, setOrdinalsWithRef, setTxHistory, setScopedDataAccountId, setBasketBalances, setBalance, setOrdBalance, setSyncError, resetSync, performSync, fetchDataFromDB, fetchData, fetchOrdinalContentIfMissing])

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}
