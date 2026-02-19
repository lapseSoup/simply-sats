/**
 * SyncContext - Handles wallet synchronization state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides sync-related state that can be consumed independently.
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { WalletKeys, UTXO, Ordinal, LockedUTXO } from '../services/wallet'
import { getBalance, getUTXOs, getOrdinals, getUTXOsFromDB } from '../services/wallet'
import {
  getAllTransactions,
  getDerivedAddresses,
  getLocks as getLocksFromDB,
  upsertOrdinalCache,
  getCachedOrdinalContent,
  upsertOrdinalContent,
  hasOrdinalContent,
  getCachedOrdinals,
  type CachedOrdinal
} from '../infrastructure/database'
import {
  syncWallet,
  restoreFromBlockchain,
  getBalanceFromDatabase,
  getOrdinalsFromDatabase,
  mapDbLocksToLockedUtxos
} from '../services/sync'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import { useNetwork } from './NetworkContext'
import { syncLogger } from '../services/logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

/** Cached content for rendering ordinal previews */
export interface OrdinalContentEntry {
  contentData?: Uint8Array
  contentText?: string
}

export interface TxHistoryItem {
  tx_hash: string
  height: number
  amount?: number
  address?: string
  description?: string
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
    silent?: boolean
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

  const resetSync = useCallback((initialBalance = 0) => {
    setUtxos([])
    setOrdinals([])
    setTxHistory([])
    setBasketBalances({ default: 0, ordinals: 0, identity: 0, derived: 0, locks: 0 })
    setBalance(initialBalance)
    setOrdBalance(0)
    setSyncError(null)
    setOrdinalContentCache(new Map())
    contentCacheRef.current = new Map()
  }, [])

  // Load all data from local DB only — no API calls. Completes fast for instant switching.
  const fetchDataFromDB = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    onLocksLoaded: (locks: LockedUTXO[]) => void,
    isCancelled?: () => boolean
  ) => {
    if (!activeAccountId) return

    syncLogger.debug('fetchDataFromDB: loading cached data', { activeAccountId })

    // Balance from DB
    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default', activeAccountId),
        getBalanceFromDatabase('derived', activeAccountId)
      ])
      if (isCancelled?.()) return
      const totalBalance = defaultBal + derivedBal
      if (Number.isFinite(totalBalance)) {
        setBalance(totalBalance)
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${activeAccountId}`, String(totalBalance)) } catch { /* quota exceeded */ }
      }
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: balance read failed', { error: String(e) })
    }

    // Transaction history from DB
    try {
      const dbTxsResult = await getAllTransactions(activeAccountId)
      const dbTxs = dbTxsResult.ok ? dbTxsResult.value : []
      if (isCancelled?.()) return
      const dbTxHistory: TxHistoryItem[] = dbTxs.map(tx => ({
        tx_hash: tx.txid,
        height: tx.blockHeight || 0,
        amount: tx.amount,
        description: tx.description
      }))
      dbTxHistory.sort((a, b) => {
        const aH = a.height || 0, bH = b.height || 0
        if (aH === 0 && bH !== 0) return -1
        if (bH === 0 && aH !== 0) return 1
        return bH - aH
      })
      setTxHistory(dbTxHistory)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: tx history read failed', { error: String(e) })
    }

    // Locks from DB
    try {
      const dbLocks = await getLocksFromDB(0, activeAccountId)
      if (isCancelled?.()) return
      const mapped = mapDbLocksToLockedUtxos(dbLocks, wallet.walletPubKey)
      // Always call even for empty arrays — ensures accounts with 0 locks
      // get setLocks([]) to clear any stale locks from a previous account
      onLocksLoaded(mapped)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: locks read failed', { error: String(e) })
    }

    // Ordinals from DB
    try {
      const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
      if (isCancelled?.()) return
      if (dbOrdinals.length > 0) {
        setOrdinals(dbOrdinals)
      }
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: ordinals read failed', { error: String(e) })
    }

    // Cached ordinal content from DB
    try {
      const cachedOrdinals = await getCachedOrdinals(activeAccountId)
      const newCache = new Map<string, OrdinalContentEntry>()
      for (const cached of cachedOrdinals) {
        if (isCancelled?.()) return
        const content = await getCachedOrdinalContent(cached.origin)
        if (content && (content.contentData || content.contentText)) {
          newCache.set(cached.origin, content)
        }
      }
      if (newCache.size > 0) {
        contentCacheRef.current = newCache
        setOrdinalContentCache(new Map(newCache))
      }
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: ordinal content cache read failed', { error: String(e) })
    }

    // UTXOs from DB
    try {
      const dbUtxos = await getUTXOsFromDB(undefined, activeAccountId)
      if (isCancelled?.()) return
      setUtxos(dbUtxos)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: UTXOs read failed', { error: String(e) })
    }

    setSyncError(null)
  }, [])

  // Sync wallet with blockchain
  // When silent=true, the syncing indicator is suppressed (used for background sync)
  const performSync = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore = false,
    forceReset = false,
    silent = false
  ) => {
    if (!silent) setSyncing(true)
    try {
      // When forceReset, clear all UTXOs so sync rebuilds from chain state
      if (forceReset && activeAccountId) {
        syncLogger.info('Force reset: clearing UTXOs for account', { accountId: activeAccountId })
        const { clearUtxosForAccount } = await import('../services/database')
        const clearResult = await clearUtxosForAccount(activeAccountId)
        if (!clearResult.ok) {
          syncLogger.warn('Failed to clear UTXOs for account', { accountId: activeAccountId, error: clearResult.error.message })
        }
      }

      // Guard: never sync without a valid account ID — null would cause syncTransactionHistory
      // to store transactions with account_id=1 (the ?? 1 default in addTransaction), bleeding
      // all synced transactions into account 1 regardless of which account is active.
      if (!activeAccountId) {
        syncLogger.warn('[SYNC] performSync called with null activeAccountId — aborting to prevent cross-account data write')
        return
      }

      syncLogger.info('Starting wallet sync...', { accountId: activeAccountId })
      const accountId = activeAccountId
      if (isRestore) {
        await restoreFromBlockchain(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          accountId,
          wallet.walletPubKey
        )
      } else {
        await syncWallet(
          wallet.walletAddress,
          wallet.ordAddress,
          wallet.identityAddress,
          accountId,
          wallet.walletPubKey
        )
      }
      syncLogger.info('Sync complete')
      setSyncError(null)

      // Update basket balances from database (scoped to account)
      try {
        const [defaultBal, ordBal, idBal, lockBal, derivedBal] = await Promise.all([
          getBalanceFromDatabase('default', accountId),
          getBalanceFromDatabase('ordinals', accountId),
          getBalanceFromDatabase('identity', accountId),
          getBalanceFromDatabase('locks', accountId),
          getBalanceFromDatabase('derived', accountId)
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
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${accountId}`, String(totalBalance)) } catch { /* quota exceeded */ }
      } catch (e) {
        syncLogger.error('Failed to get basket balances', e)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error('Sync failed', error)

      // Run diagnostics to identify the exact failure point
      try {
        const { diagnoseSyncHealth } = await import('../services/sync')
        const health = await diagnoseSyncHealth(activeAccountId ?? undefined)
        syncLogger.error('Post-failure health check', { ...health })
        if (!health.dbConnected) {
          setSyncError('Sync failed: database connection error')
        } else if (!health.apiReachable) {
          setSyncError('Sync failed: cannot reach blockchain API')
        } else if (!health.derivedAddressQuery || !health.utxoQuery) {
          setSyncError(`Sync failed: database query error — ${health.errors.join('; ')}`)
        } else {
          setSyncError(`Sync failed: ${msg}`)
        }
      } catch {
        setSyncError(`Sync failed: ${msg}`)
      }
    } finally {
      if (!silent) setSyncing(false)
    }
  }, [setSyncing])

  // Fetch data from database and API
  const fetchData = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: import('../services/wallet').LockedUTXO[] }) => void,
    isCancelled?: () => boolean
  ) => {
    // Guard: require a valid account ID to prevent cross-account data leaks
    if (!activeAccountId) return

    syncLogger.debug('Fetching data (database-first approach)...', {
      activeAccountId,
      walletAddress: wallet.walletAddress.slice(0, 12) + '...'
    })

    // Track partial failures so the user knows when data may be stale
    const partialErrors: string[] = []

    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default', activeAccountId),
        getBalanceFromDatabase('derived', activeAccountId)
      ])
      if (isCancelled?.()) return
      const totalBalance = defaultBal + derivedBal
      // Guard against NaN/Infinity from unexpected DB values — don't corrupt displayed balance
      if (Number.isFinite(totalBalance)) {
        setBalance(totalBalance)
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${activeAccountId}`, String(totalBalance)) } catch { /* quota exceeded */ }
      } else {
        syncLogger.warn('Skipping non-finite balance', { defaultBal, derivedBal })
      }
      setSyncError(null)

      // Get ordinals balance from API (use allSettled so one failure doesn't lose the other)
      try {
        const results = await Promise.allSettled([
          getBalance(wallet.ordAddress),
          getBalance(wallet.identityAddress)
        ])
        const ordBal = results[0].status === 'fulfilled' ? results[0].value : 0
        const idBal = results[1].status === 'fulfilled' ? results[1].value : 0
        if (results.some(r => r.status === 'rejected')) {
          syncLogger.warn('Partial failure fetching ord balance')
        }
        const totalOrdBalance = ordBal + idBal
        if (isCancelled?.()) return
        // Guard against NaN/Infinity from API values
        if (Number.isFinite(totalOrdBalance)) {
          setOrdBalance(totalOrdBalance)
          try { localStorage.setItem(`${STORAGE_KEYS.CACHED_ORD_BALANCE}_${activeAccountId}`, String(totalOrdBalance)) } catch { /* quota exceeded */ }
        } else {
          syncLogger.warn('Skipping non-finite ord balance', { ordBal, idBal })
        }
      } catch (_e) {
        // On API failure, keep current React state — don't overwrite with stale cache
        syncLogger.warn('Failed to fetch ord balance from API, keeping current value')
        partialErrors.push('ordinal balance')
      }

      // Get transaction history from DATABASE (scoped to account)
      const dbTxsResult = await getAllTransactions(activeAccountId)
      const dbTxs = dbTxsResult.ok ? dbTxsResult.value : []
      if (!dbTxsResult.ok) {
        syncLogger.warn('Failed to get transactions from database', { error: dbTxsResult.error.message })
      }
      const dbTxHistory: TxHistoryItem[] = dbTxs.map(tx => ({
        tx_hash: tx.txid,
        height: tx.blockHeight || 0,
        amount: tx.amount,
        description: tx.description
      }))

      dbTxHistory.sort((a, b) => {
        const aHeight = a.height || 0
        const bHeight = b.height || 0
        if (aHeight === 0 && bHeight !== 0) return -1
        if (bHeight === 0 && aHeight !== 0) return 1
        return bHeight - aHeight
      })

      if (isCancelled?.()) return
      setTxHistory(dbTxHistory)

      // Load locks from database instantly so they appear before blockchain detection
      let preloadedLocks: import('../services/wallet').LockedUTXO[] = []
      try {
        const dbLocks = await getLocksFromDB(0, activeAccountId)
        preloadedLocks = mapDbLocksToLockedUtxos(dbLocks, wallet.walletPubKey)
        if (preloadedLocks.length > 0) {
          // Send preloaded locks immediately via callback so UI updates
          onLocksDetected({ utxos: [], shouldClearLocks: false, preloadedLocks })
        }
      } catch (_e) {
        syncLogger.warn('Failed to preload locks from DB')
        partialErrors.push('locks')
      }

      // Get ordinals - first from database (already synced), then supplement with API calls
      try {
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
        syncLogger.debug('Found ordinals in database', { count: dbOrdinals.length, accountId: activeAccountId })

        // Guard: if account switched during async DB call, discard results
        if (isCancelled?.()) return

        // Display DB ordinals immediately (before slow API calls)
        // Only set from DB if we actually found ordinals — avoids clobbering state
        // with empty results before API calls complete (fixes ordinals not showing
        // after 12-word restore, where sync writes UTXOs but not ordinal metadata)
        if (dbOrdinals.length > 0) {
          setOrdinals(dbOrdinals)
        }

        // Load cached content from DB for instant previews
        const cachedOrdinals = await getCachedOrdinals(activeAccountId)
        const newCache = new Map<string, OrdinalContentEntry>()
        for (const cached of cachedOrdinals) {
          if (isCancelled?.()) return
          // Load actual content for ordinals that have it cached
          const content = await getCachedOrdinalContent(cached.origin)
          if (content && (content.contentData || content.contentText)) {
            newCache.set(cached.origin, content)
          }
        }
        if (newCache.size > 0) {
          contentCacheRef.current = newCache
          setOrdinalContentCache(new Map(newCache))
          syncLogger.debug('Loaded cached ordinal content', { count: newCache.size })
        }

        // Get derived addresses (scoped to active account)
        const derivedAddrs = await getDerivedAddresses(activeAccountId)

        // Fetch from all addresses in parallel
        const ordinalResults = await Promise.allSettled([
          getOrdinals(wallet.ordAddress),
          getOrdinals(wallet.walletAddress),
          getOrdinals(wallet.identityAddress),
          ...derivedAddrs.map(d => getOrdinals(d.address))
        ])

        const ordinalArrays = ordinalResults.map((result, i) => {
          if (result.status === 'fulfilled') return result.value
          syncLogger.warn('Failed to fetch ordinals', { index: i, reason: String(result.reason) })
          return [] as Ordinal[]
        })

        const [ordAddressOrdinals = [], walletAddressOrdinals = [], identityAddressOrdinals = [], ...derivedOrdinals] = ordinalArrays

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

        // Guard: if account switched during slow API calls, discard results
        if (isCancelled?.()) return

        setOrdinals(allOrdinals)

        // Cache ordinal metadata to DB and fetch missing content in background
        cacheOrdinalsInBackground(allOrdinals, activeAccountId, contentCacheRef, setOrdinalContentCache, isCancelled ?? (() => false))
      } catch (e) {
        syncLogger.error('Failed to fetch ordinals', e)
        partialErrors.push('ordinals')
      }

      // Fetch UTXOs and notify about lock detection
      try {
        if (isCancelled?.()) return
        const utxoList = await getUTXOs(wallet.walletAddress)
        if (isCancelled?.()) return
        setUtxos(utxoList)
        if (isCancelled?.()) return
        // Notify caller about UTXOs for lock detection
        onLocksDetected({
          utxos: utxoList,
          shouldClearLocks: knownUnlockedLocks.size > 0
        })
      } catch (e) {
        syncLogger.error('Failed to fetch UTXOs', e)
        partialErrors.push('UTXOs')
      }

      // Surface partial failures so the user knows data may be stale
      if (partialErrors.length > 0) {
        setSyncError(`Some data may be stale: failed to load ${partialErrors.join(', ')}`)
      }
    } catch (error) {
      if (partialErrors.length > 0) {
        setSyncError(`Some data may be stale: failed to load ${partialErrors.join(', ')}`)
      } else {
        setSyncError('Failed to load wallet data')
      }
      syncLogger.error('Failed to fetch data', error)
    }
  }, [])

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
    setOrdinals,
    setTxHistory,
    setBasketBalances,
    setBalance,
    setOrdBalance,
    resetSync,
    performSync,
    fetchDataFromDB,
    fetchData
  }), [utxos, ordinals, txHistory, basketBalances, balance, ordBalance, syncError, ordinalContentCache, setUtxos, setOrdinals, setTxHistory, setBasketBalances, setBalance, setOrdBalance, resetSync, performSync, fetchDataFromDB, fetchData])

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}

/**
 * Background task: save ordinal metadata to DB and fetch missing content.
 * Non-blocking — runs after ordinals are displayed to user.
 */
async function cacheOrdinalsInBackground(
  allOrdinals: Ordinal[],
  activeAccountId: number | null,
  contentCacheRef: React.MutableRefObject<Map<string, OrdinalContentEntry>>,
  setOrdinalContentCache: React.Dispatch<React.SetStateAction<Map<string, OrdinalContentEntry>>>,
  isCancelled: () => boolean
): Promise<void> {
  // Guard: don't cache ordinals without a valid account ID (prevents cross-account contamination)
  if (!activeAccountId) return

  try {
    // 1. Save metadata to DB
    if (isCancelled()) return
    const now = Date.now()
    for (const ord of allOrdinals) {
      if (isCancelled()) return
      const cached: CachedOrdinal = {
        origin: ord.origin,
        txid: ord.txid,
        vout: ord.vout,
        satoshis: ord.satoshis,
        contentType: ord.contentType,
        contentHash: ord.content,
        accountId: activeAccountId,
        fetchedAt: now
      }
      await upsertOrdinalCache(cached)
    }
    syncLogger.debug('Cached ordinal metadata', { count: allOrdinals.length })

    // 2. Fetch missing content (up to 10 per cycle)
    if (isCancelled()) return
    const toFetch: Ordinal[] = []
    for (const ord of allOrdinals) {
      if (contentCacheRef.current.has(ord.origin)) continue
      const hasCached = await hasOrdinalContent(ord.origin)
      if (!hasCached) {
        toFetch.push(ord)
      }
      if (toFetch.length >= 10) break
    }

    if (toFetch.length === 0) return

    syncLogger.debug('Fetching ordinal content', { count: toFetch.length })

    let contentAdded = false
    for (const ord of toFetch) {
      if (isCancelled()) return
      const content = await fetchOrdinalContent(ord.origin, ord.contentType)
      if (content) {
        // Save to DB
        await upsertOrdinalContent(ord.origin, content.contentData, content.contentText)
        // Update in-memory cache
        contentCacheRef.current.set(ord.origin, content)
        contentAdded = true
      }
    }

    // Trigger a single re-render with all new content
    if (contentAdded) {
      setOrdinalContentCache(new Map(contentCacheRef.current))
      syncLogger.debug('Ordinal content fetched and cached', { fetched: toFetch.length })
    }
  } catch (e) {
    syncLogger.warn('Background ordinal caching failed (non-critical)', { error: String(e) })
  }
}
