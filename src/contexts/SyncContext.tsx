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
  markOrdinalTransferred,
  getAllCachedOrdinalOrigins,
  getCachedOrdinalContent,
  upsertOrdinalContent,
  hasOrdinalContent,
  getCachedOrdinals,
  ensureOrdinalCacheRowForTransferred,
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

/**
 * Merge synthetic TxHistoryItems for ordinal receives whose txids are not in
 * the DB transactions table. Uses real block heights from ordinal_cache when
 * available; falls back to -1 sentinel for ordinals without cached height.
 * Mutates `dbTxHistory` in place. No API calls — reads from local SQLite only.
 */
async function mergeOrdinalTxEntries(
  dbTxHistory: TxHistoryItem[],
  accountId: number | null
): Promise<void> {
  // Map<txid, blockHeight> — -1 sentinel means height unknown
  const ordinalTxidHeights = new Map<string, number>()
  try {
    const cachedOrds = await getCachedOrdinals(accountId ?? undefined)
    if (cachedOrds.length > 0) {
      for (const c of cachedOrds) ordinalTxidHeights.set(c.txid, c.blockHeight ?? -1)
    } else {
      const dbOrds = await getOrdinalsFromDatabase(accountId ?? undefined)
      for (const o of dbOrds) ordinalTxidHeights.set(o.txid, -1)  // utxos table has no height
    }
  } catch { /* non-critical — ordinal data loaded fully elsewhere */ }

  const dbTxidSet = new Set(dbTxHistory.map(tx => tx.tx_hash))
  for (const [txid, height] of ordinalTxidHeights) {
    if (!dbTxidSet.has(txid)) {
      dbTxHistory.push({ tx_hash: txid, height, amount: 1, createdAt: 0 })
    }
  }
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
        description: tx.description,
        createdAt: tx.createdAt
      }))

      // Merge ordinal receives not in DB transactions (old ordinals WoC missed)
      await mergeOrdinalTxEntries(dbTxHistory, activeAccountId)

      dbTxHistory.sort((a, b) => {
        const aH = a.height || 0, bH = b.height || 0
        if (aH === 0 && bH !== 0) return -1
        if (bH === 0 && aH !== 0) return 1
        if (aH === 0 && bH === 0) return (b.createdAt ?? 0) - (a.createdAt ?? 0)
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

    // Ordinals from DB — use the ordinal_cache table as the primary source since it
    // contains the full set from the last API fetch (across all addresses: ord, wallet,
    // identity, derived). The UTXOs table only has ordAddress UTXOs (basket='ordinals'),
    // which is a small subset. Fall back to UTXOs if the cache is empty.
    try {
      const cachedOrdinals = await getCachedOrdinals(activeAccountId)
      if (isCancelled?.()) return

      if (cachedOrdinals.length > 0) {
        // Map CachedOrdinal → Ordinal for setOrdinals
        const ordinals: Ordinal[] = cachedOrdinals.map(cached => ({
          origin: cached.origin,
          txid: cached.txid,
          vout: cached.vout,
          satoshis: cached.satoshis,
          contentType: cached.contentType,
          content: cached.contentHash
        }))
        setOrdinalsWithRef(ordinals)
      } else {
        // Cache empty — fall back to UTXOs table (basket='ordinals')
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
        if (isCancelled?.()) return
        setOrdinalsWithRef(dbOrdinals)
      }

      // Load content previews — include ALL cached origins (transferred + owned)
      // so activity tab thumbnails work for ordinals no longer in the wallet.
      const allOrigins = await getAllCachedOrdinalOrigins(activeAccountId)
      const newCache = new Map<string, OrdinalContentEntry>()
      for (const origin of allOrigins) {
        if (isCancelled?.()) return
        const content = await getCachedOrdinalContent(origin)
        if (content && (content.contentData || content.contentText)) {
          newCache.set(origin, content)
        }
      }
      contentCacheRef.current = newCache
      setOrdinalContentCache(new Map(newCache))
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: ordinals read failed', { error: String(e) })
    }

    // UTXOs from DB
    try {
      const dbUtxos = await getUTXOsFromDB(undefined, activeAccountId)
      if (isCancelled?.()) return
      setUtxos(dbUtxos)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: UTXOs read failed', { error: String(e) })
    }

    // Ord balance is API-only — no DB cache. Reset to 0 so the old account's
    // ord balance doesn't persist in the UI until the next API fetch.
    setOrdBalance(0)
    setSyncError(null)
  }, [setOrdinalsWithRef])

  // Sync wallet with blockchain
  // When silent=true, the syncing indicator is suppressed (used for background sync)
  // When isCancelled is provided, state updates are skipped if the account changed mid-sync
  const performSync = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore = false,
    forceReset = false,
    silent = false,
    isCancelled?: () => boolean
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

      // CRITICAL: If account changed during sync, do NOT update React state.
      // The sync wrote correct data to the DB (scoped by accountId), but updating
      // setBalance/setBasketBalances would overwrite the ACTIVE account's values
      // with this (now-inactive) account's values — causing wrong balance display.
      if (isCancelled?.()) {
        syncLogger.info('performSync: account changed during sync, skipping state update', { syncedAccountId: accountId })
        return
      }

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

        // Check again after async DB reads
        if (isCancelled?.()) {
          syncLogger.info('performSync: account changed after balance read, skipping state update', { syncedAccountId: accountId })
          return
        }

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

      // Reload txHistory from DB so deleted phantom transactions vanish from Activity tab.
      // syncWallet may delete phantom transaction records, but performSync never refreshes
      // txHistory state — stale records linger until fetchData runs otherwise.
      try {
        const dbTxsResult = await getAllTransactions(accountId)
        if (dbTxsResult.ok && !isCancelled?.()) {
          const dbTxHistory: TxHistoryItem[] = dbTxsResult.value.map(tx => ({
            tx_hash: tx.txid,
            height: tx.blockHeight || 0,
            amount: tx.amount,
            description: tx.description,
            createdAt: tx.createdAt
          }))
          await mergeOrdinalTxEntries(dbTxHistory, accountId)
          dbTxHistory.sort((a, b) => {
            const aH = a.height || 0, bH = b.height || 0
            if (aH === 0 && bH !== 0) return -1
            if (bH === 0 && aH !== 0) return 1
            if (aH === 0 && bH === 0) return (b.createdAt ?? 0) - (a.createdAt ?? 0)
            return bH - aH
          })
          setTxHistory(dbTxHistory)
        }
      } catch (_e) {
        // Non-fatal: stale txHistory in UI is better than crash
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error('Sync failed', error)

      // Don't set error state if account changed — it's not relevant to the new account
      if (isCancelled?.()) return

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
        description: tx.description,
        createdAt: tx.createdAt
      }))

      // Merge ordinal receives not in DB transactions (old ordinals WoC missed)
      await mergeOrdinalTxEntries(dbTxHistory, activeAccountId)

      dbTxHistory.sort((a, b) => {
        const aHeight = a.height || 0
        const bHeight = b.height || 0
        if (aHeight === 0 && bHeight !== 0) return -1
        if (bHeight === 0 && aHeight !== 0) return 1
        if (aHeight === 0 && bHeight === 0) return (b.createdAt ?? 0) - (a.createdAt ?? 0)
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

        // Display DB ordinals immediately (before slow API calls) — but ONLY on cold
        // start (when state is currently empty). If ordinals are already in state
        // (e.g. from an optimistic removal after a transfer), don't overwrite them
        // with potentially stale DB data before the API results arrive.
        if (dbOrdinals.length > 0 && ordinalsRef.current.length === 0) {
          setOrdinalsWithRef(dbOrdinals)
        }

        // Load cached content from DB for instant previews.
        // Use getAllCachedOrdinalOrigins (includes transferred=1 rows) so that
        // activity tab thumbnails work even for ordinals no longer owned.
        const allCachedOrigins = await getAllCachedOrdinalOrigins(activeAccountId)
        const newCache = new Map<string, OrdinalContentEntry>()
        for (const origin of allCachedOrigins) {
          if (isCancelled?.()) return
          const content = await getCachedOrdinalContent(origin)
          if (content && (content.contentData || content.contentText)) {
            newCache.set(origin, content)
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

        // Combine and deduplicate by origin.
        // API results are the authoritative source — do NOT re-add dbOrdinals here.
        // dbOrdinals were already shown immediately at line 499 for a fast initial
        // display. Including them again in the final merge would re-add transferred
        // ordinals whose DB records haven't been marked spent yet, causing the count
        // to stay stale. Only fall back to dbOrdinals if the API returned nothing.
        const seen = new Set<string>()
        const apiOrdinals = [
          ...ordAddressOrdinals,
          ...walletAddressOrdinals,
          ...identityAddressOrdinals,
          ...derivedOrdinals.flat()
        ].filter(ord => {
          if (seen.has(ord.origin)) return false
          seen.add(ord.origin)
          return true
        })

        const allOrdinals = apiOrdinals.length > 0 ? apiOrdinals : dbOrdinals

        // Guard: if account switched during slow API calls, discard results
        if (isCancelled?.()) return

        setOrdinalsWithRef(allOrdinals)

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
  }, [setOrdinalsWithRef])

  // Lazily fetch ordinal content for transferred ordinals missing from the cache.
  // Called by ActivityTab when displaying transfer history items after a fresh restore
  // where ordinal_cache may be empty (content was never fetched for the new wallet).
  const fetchOrdinalContentIfMissing = useCallback(async (origin: string, contentType?: string, accountId?: number) => {
    if (contentCacheRef.current.has(origin)) return  // already in memory

    try {
      // Check if content exists in DB first (cheapest path)
      const hasCached = await hasOrdinalContent(origin)
      if (hasCached) {
        const content = await getCachedOrdinalContent(origin)
        if (content && (content.contentData || content.contentText)) {
          contentCacheRef.current.set(origin, content)
          setOrdinalContentCache(new Map(contentCacheRef.current))
        }
        return
      }

      // Fetch from API (GorillaPool)
      const content = await fetchOrdinalContent(origin, contentType)
      if (content) {
        // Ensure a row exists with the correct account_id so it's found by
        // account-scoped DB queries on subsequent launches.
        await ensureOrdinalCacheRowForTransferred(origin, accountId)
        await upsertOrdinalContent(origin, content.contentData, content.contentText, content.contentType)
        contentCacheRef.current.set(origin, content)
        setOrdinalContentCache(new Map(contentCacheRef.current))
        syncLogger.debug('Fetched transferred ordinal content', { origin })
      }
    } catch (e) {
      syncLogger.warn('fetchOrdinalContentIfMissing failed (non-critical)', { origin, error: String(e) })
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
        fetchedAt: now,
        blockHeight: ord.blockHeight
      }
      await upsertOrdinalCache(cached)
    }
    syncLogger.debug('Cached ordinal metadata', { count: allOrdinals.length })

    // 1b. Mark transferred ordinals — any owned (transferred=0) cache entry whose
    // origin is no longer returned by the API is assumed to have been transferred out.
    // We mark it transferred=1 (NOT delete) so it stays available for historical
    // display in the activity tab thumbnails and tx detail modal.
    if (isCancelled()) return
    const currentOrigins = new Set(allOrdinals.map(o => o.origin))
    const ownedCachedRows = await getCachedOrdinals(activeAccountId)
    for (const row of ownedCachedRows) {
      if (!currentOrigins.has(row.origin)) {
        await markOrdinalTransferred(row.origin)
        syncLogger.debug('Marked ordinal as transferred in cache', { origin: row.origin })
      }
    }

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
        // Save to DB (also update content_type if resolved from response header)
        await upsertOrdinalContent(ord.origin, content.contentData, content.contentText, content.contentType)
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
