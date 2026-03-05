/**
 * Hook for sync data fetching: fetchDataFromDB (local DB only) and fetchData (DB + API).
 *
 * Extracted from SyncContext to reduce god-object complexity.
 */

import { useCallback, type MutableRefObject } from 'react'
import type { WalletKeys, UTXO, Ordinal, LockedUTXO } from '../services/wallet'
import { getBalance, getUTXOs, getOrdinals, getUTXOsFromDB } from '../services/wallet'
import {
  getAllTransactions,
  getDerivedAddresses,
  getLocks as getLocksFromDB,
} from '../infrastructure/database'
import {
  getAllCachedOrdinalOrigins,
  getBatchOrdinalContent,
  getCachedOrdinals,
} from '../services/ordinalCache'
import {
  getBalanceFromDatabase,
  getOrdinalsFromDatabase,
  mapDbLocksToLockedUtxos
} from '../services/sync'
import { syncLogger } from '../services/logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import type { OrdinalContentEntry, TxHistoryItem } from '../contexts/SyncContext'
import { cacheOrdinalsInBackground } from './useOrdinalCache'
import { compareTxByHeight, mergeOrdinalTxEntries } from '../utils/syncHelpers'

interface UseSyncDataOptions {
  setBalance: (balance: number) => void
  setOrdBalance: (balance: number) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  setUtxos: (utxos: UTXO[]) => void
  setOrdinalsWithRef: (ordinals: Ordinal[]) => void
  setSyncError: (error: string | null) => void
  bumpCacheVersion: () => void
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
}

interface UseSyncDataReturn {
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
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: LockedUTXO[] }) => void,
    isCancelled?: () => boolean
  ) => Promise<void>
}

export function useSyncData({
  setBalance,
  setOrdBalance,
  setTxHistory,
  setUtxos,
  setOrdinalsWithRef,
  setSyncError,
  bumpCacheVersion,
  contentCacheRef,
}: UseSyncDataOptions): UseSyncDataReturn {

  // Load all data from local DB only -- no API calls. Completes fast for instant switching.
  const fetchDataFromDB = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    onLocksLoaded: (locks: LockedUTXO[]) => void,
    isCancelled?: () => boolean
  ) => {
    if (activeAccountId == null) return

    const _t0 = performance.now()
    syncLogger.debug('fetchDataFromDB: loading cached data', { activeAccountId })

    // Run all DB reads in parallel — they're independent queries and parallelizing
    // cuts total load time from ~200ms (sequential) to ~50ms (single bottleneck).
    const [balanceResult, txResult, locksResult, ordinalsResult, utxoResult] = await Promise.allSettled([
      // Balance
      Promise.all([
        getBalanceFromDatabase('default', activeAccountId),
        getBalanceFromDatabase('derived', activeAccountId)
      ]),
      // Transaction history
      getAllTransactions(activeAccountId),
      // Locks
      getLocksFromDB(0, activeAccountId),
      // Ordinals from cache
      getCachedOrdinals(activeAccountId),
      // UTXOs
      getUTXOsFromDB(undefined, activeAccountId)
    ])

    syncLogger.info('⏱ fetchDataFromDB: queries done', { elapsedMs: Math.round(performance.now() - _t0) })
    if (isCancelled?.()) return

    // ── PHASE 1: Apply all cached data IMMEDIATELY (no awaits) ──────────
    // Every setState call below is synchronous. React batches them and
    // re-renders once, giving the user instant data display (~0ms).

    // NOTE: We do NOT clear contentCacheRef here. The cache is keyed by unique
    // ordinal origin (txid_vout) so there's no cross-account contamination.
    // Clearing forces re-fetch of all 621+ ordinal thumbnails on every switch,
    // which makes the app feel slow. Content from any account is safe to keep.

    // Balance
    if (balanceResult.status === 'fulfilled') {
      const [defaultBal, derivedBal] = balanceResult.value
      const totalBalance = defaultBal + derivedBal
      if (Number.isFinite(totalBalance)) {
        setBalance(totalBalance)
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${activeAccountId}`, String(totalBalance)) } catch (_e) { syncLogger.warn('localStorage quota exceeded for cached balance', { error: String(_e) }) }
      }
    } else {
      syncLogger.warn('fetchDataFromDB: balance read failed', { error: String(balanceResult.reason) })
    }

    // Transaction history — set immediately WITHOUT awaiting mergeOrdinalTxEntries.
    // The merge adds synthetic ordinal-receive entries and runs in Phase 2.
    let dbTxHistory: TxHistoryItem[] = []
    if (txResult.status === 'fulfilled') {
      const dbTxs = txResult.value.ok ? txResult.value.value : []
      dbTxHistory = dbTxs.map(tx => ({
        tx_hash: tx.txid,
        height: tx.blockHeight || 0,
        amount: tx.amount,
        description: tx.description,
        createdAt: tx.createdAt
      }))
      dbTxHistory.sort(compareTxByHeight)
      setTxHistory(dbTxHistory)
    } else {
      syncLogger.warn('fetchDataFromDB: tx history read failed', { error: String(txResult.reason) })
    }

    // Locks
    if (locksResult.status === 'fulfilled') {
      const mapped = mapDbLocksToLockedUtxos(locksResult.value, wallet.walletPubKey)
      onLocksLoaded(mapped)
    } else {
      syncLogger.warn('fetchDataFromDB: locks read failed', { error: String(locksResult.reason) })
    }

    // Ordinals from cache — set the list immediately, content previews load in Phase 2.
    // B-107: ALWAYS set ordinals in Phase 1 (even to []) to prevent stale data from a
    // previous account persisting. If ordinal_cache is empty, fall back to UTXOs table
    // SYNCHRONOUSLY (not fire-and-forget) so ordinals appear instantly on startup/switch.
    const cachedOrdinals = ordinalsResult.status === 'fulfilled' ? ordinalsResult.value : []
    if (cachedOrdinals.length > 0) {
      const ordinals: Ordinal[] = cachedOrdinals.map(cached => ({
        origin: cached.origin,
        txid: cached.txid,
        vout: cached.vout,
        satoshis: cached.satoshis,
        contentType: cached.contentType,
        content: cached.contentHash
      }))
      setOrdinalsWithRef(ordinals)
    } else if (ordinalsResult.status === 'rejected') {
      syncLogger.warn('fetchDataFromDB: ordinals read failed', { error: String(ordinalsResult.reason) })
      // Still try DB fallback even on cache read failure
      try {
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
        if (!isCancelled?.()) setOrdinalsWithRef(dbOrdinals)
      } catch (e) {
        syncLogger.warn('fetchDataFromDB: ordinals DB fallback also failed', { error: String(e) })
        if (!isCancelled?.()) setOrdinalsWithRef([])
      }
    } else {
      // Cache was empty (fulfilled but 0 results) — fall back to UTXOs table immediately.
      // This handles first startup / restored wallets where ordinal_cache hasn't been
      // populated yet but UTXOs table has ordinal-basket entries from blockchain sync.
      try {
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
        if (!isCancelled?.()) {
          setOrdinalsWithRef(dbOrdinals)
          syncLogger.debug('fetchDataFromDB: used UTXOs-table ordinals fallback', { count: dbOrdinals.length })
        }
      } catch (e) {
        syncLogger.warn('fetchDataFromDB: ordinals DB fallback failed', { error: String(e) })
        // Set empty to clear any stale ordinals from previous account
        if (!isCancelled?.()) setOrdinalsWithRef([])
      }
    }

    // UTXOs
    if (utxoResult.status === 'fulfilled') {
      setUtxos(utxoResult.value)
    } else {
      syncLogger.warn('fetchDataFromDB: UTXOs read failed', { error: String(utxoResult.reason) })
    }

    // Ord balance from localStorage cache
    // B-95: Guard against NaN/Infinity from corrupted cache values
    try {
      const cachedOrdBal = localStorage.getItem(`${STORAGE_KEYS.CACHED_ORD_BALANCE}_${activeAccountId}`)
      const parsed = cachedOrdBal ? Number(cachedOrdBal) : 0
      setOrdBalance(Number.isFinite(parsed) ? parsed : 0)
    } catch {
      setOrdBalance(0)
    }
    setSyncError(null)

    syncLogger.info('⏱ fetchDataFromDB: Phase 1 state setters done', { elapsedMs: Math.round(performance.now() - _t0) })

    // ── PHASE 2: Background enrichment (fire-and-forget) ────────────────
    // These operations add supplementary data (merged ordinal txs, content
    // previews, empty-cache fallback). They're non-blocking so the UI
    // shows cached data immediately while these complete in the background.

    // Merge ordinal receives into tx history (uses already-fetched cachedOrdinals, no re-query)
    if (dbTxHistory.length > 0 || cachedOrdinals.length > 0) {
      ;(async () => {
        try {
          // Build ordinal txid→height map from the already-fetched cache (no DB round-trip)
          const ordinalTxidHeights = new Map<string, number>()
          if (cachedOrdinals.length > 0) {
            for (const c of cachedOrdinals) ordinalTxidHeights.set(c.txid, c.blockHeight ?? -1)
          } else {
            // Cache was empty — fall back to UTXOs-table ordinals (also needs a query)
            try {
              const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
              for (const o of dbOrdinals) ordinalTxidHeights.set(o.txid, -1)
            } catch { /* swallow */ }
          }

          if (isCancelled?.()) return

          // B-67: Copy before mutating — dbTxHistory was already passed to
          // setTxHistory above, so pushing onto it would mutate React state.
          const mergedHistory = [...dbTxHistory]
          const dbTxidSet = new Set(mergedHistory.map(tx => tx.tx_hash))
          let added = 0
          for (const [txid, height] of ordinalTxidHeights) {
            if (!dbTxidSet.has(txid)) {
              mergedHistory.push({ tx_hash: txid, height, amount: 1, createdAt: 0 })
              added++
            }
          }

          if (added > 0 && !isCancelled?.()) {
            mergedHistory.sort(compareTxByHeight)
            setTxHistory(mergedHistory)
          }
        } catch (e) {
          syncLogger.warn('fetchDataFromDB: merge ordinal tx entries failed', { error: String(e) })
        }
      })()
    }

    // Content preview loading (ordinal list fallback moved to Phase 1 — B-107)
    if (ordinalsResult.status === 'fulfilled') {
      ;(async () => {
        try {
          // Load content previews in a single batch query
          const allOrigins = await getAllCachedOrdinalOrigins(activeAccountId)
          if (isCancelled?.()) return
          const newCache = await getBatchOrdinalContent(allOrigins)
          if (isCancelled?.()) return
          // B-60: Map.set() is atomic in single-threaded JS — concurrent syncs
          // may overwrite entries for the same key, but this is idempotent.
          for (const [k, v] of newCache) { contentCacheRef.current.set(k, v) }
          bumpCacheVersion()
        } catch (e) {
          syncLogger.warn('fetchDataFromDB: ordinal content batch read failed', { error: String(e) })
        }
      })()
    }
  }, [setBalance, setOrdBalance, setTxHistory, setUtxos, setOrdinalsWithRef, setSyncError, bumpCacheVersion, contentCacheRef])

  // Fetch data from database and API
  const fetchData = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    getKnownUnlockedLocks: () => Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: LockedUTXO[] }) => void,
    isCancelled?: () => boolean
  ) => {
    // Guard: require a valid account ID to prevent cross-account data leaks
    if (activeAccountId == null) return

    syncLogger.debug('Fetching data (database-first approach)...', {
      activeAccountId,
      walletAddress: wallet.walletAddress.slice(0, 12) + '...'
    })

    // Create an AbortController so that when isCancelled() fires (account switch),
    // in-flight HTTP requests are aborted immediately instead of wasting bandwidth.
    const abortController = new AbortController()
    const signal = abortController.signal
    // Wrap isCancelled to also abort the controller
    const checkCancelled = () => {
      if (isCancelled?.()) {
        if (!signal.aborted) abortController.abort()
        return true
      }
      return false
    }

    // Track partial failures so the user knows when data may be stale
    const partialErrors: string[] = []

    try {
      const [defaultBal, derivedBal] = await Promise.all([
        getBalanceFromDatabase('default', activeAccountId),
        getBalanceFromDatabase('derived', activeAccountId)
      ])
      if (checkCancelled()) return
      const totalBalance = defaultBal + derivedBal
      // Guard against NaN/Infinity from unexpected DB values -- don't corrupt displayed balance
      if (Number.isFinite(totalBalance)) {
        setBalance(totalBalance)
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${activeAccountId}`, String(totalBalance)) } catch (_e) { syncLogger.warn('localStorage quota exceeded for cached balance', { error: String(_e) }) }
      } else {
        syncLogger.warn('Skipping non-finite balance', { defaultBal, derivedBal })
      }
      setSyncError(null)

      // Get ordinals balance from API (use allSettled so one failure doesn't lose the other)
      try {
        const results = await Promise.allSettled([
          getBalance(wallet.ordAddress, signal),
          getBalance(wallet.identityAddress, signal)
        ])
        const ordBal = results[0].status === 'fulfilled' ? results[0].value : 0
        const idBal = results[1].status === 'fulfilled' ? results[1].value : 0
        if (results.some(r => r.status === 'rejected')) {
          syncLogger.warn('Partial failure fetching ord balance')
        }
        const totalOrdBalance = ordBal + idBal
        if (checkCancelled()) return
        // Guard against NaN/Infinity from API values
        if (Number.isFinite(totalOrdBalance)) {
          setOrdBalance(totalOrdBalance)
          try { localStorage.setItem(`${STORAGE_KEYS.CACHED_ORD_BALANCE}_${activeAccountId}`, String(totalOrdBalance)) } catch (_e) { syncLogger.warn('localStorage quota exceeded for cached ord balance', { error: String(_e) }) }
        } else {
          syncLogger.warn('Skipping non-finite ord balance', { ordBal, idBal })
        }
      } catch (_e) {
        // On API failure, keep current React state -- don't overwrite with stale cache
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

      dbTxHistory.sort(compareTxByHeight)

      if (checkCancelled()) return
      setTxHistory(dbTxHistory)

      // Load locks from database instantly so they appear before blockchain detection
      let preloadedLocks: LockedUTXO[] = []
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
        if (checkCancelled()) return

        // B-107: Always display DB ordinals as the initial set before slow API calls.
        // Previously guarded by `ordinalsRef.current.length === 0` to avoid overwriting
        // optimistic state (e.g. after a transfer), but that guard also blocked ordinals
        // from appearing on startup/switch when fetchDataFromDB had already populated
        // state from cache. The API results at line ~451 will replace these regardless,
        // so any brief re-flash of a transferred ordinal is acceptable vs. showing nothing.
        if (dbOrdinals.length > 0) {
          setOrdinalsWithRef(dbOrdinals)
        }

        // Load cached content from DB for instant previews.
        // Use getAllCachedOrdinalOrigins (includes transferred=1 rows) so that
        // activity tab thumbnails work even for ordinals no longer owned.
        const allCachedOrigins = await getAllCachedOrdinalOrigins(activeAccountId)
        if (checkCancelled()) return
        const newCache = await getBatchOrdinalContent(allCachedOrigins)
        if (newCache.size > 0) {
          for (const [k, v] of newCache) { contentCacheRef.current.set(k, v) }
          bumpCacheVersion()
          syncLogger.debug('Loaded cached ordinal content', { count: newCache.size })
        }

        // Get derived addresses (scoped to active account)
        const derivedAddrs = await getDerivedAddresses(activeAccountId)

        // Fetch from all addresses in parallel (with abort signal for cancellation)
        const ordinalResults = await Promise.allSettled([
          getOrdinals(wallet.ordAddress, signal),
          getOrdinals(wallet.walletAddress, signal),
          getOrdinals(wallet.identityAddress, signal),
          ...derivedAddrs.map(d => getOrdinals(d.address, signal))
        ])

        const allOrdinalApiCallsSucceeded = ordinalResults.every(r => r.status === 'fulfilled')
        if (!allOrdinalApiCallsSucceeded) {
          syncLogger.warn('Some ordinal API calls failed -- transfer detection disabled for this cycle', {
            results: ordinalResults.map((r, i) => ({ index: i, status: r.status }))
          })
        }

        const ordinalArrays = ordinalResults.map((result, i) => {
          if (result.status === 'fulfilled') return result.value
          syncLogger.warn('Failed to fetch ordinals', { index: i, reason: String(result.reason) })
          return [] as Ordinal[]
        })

        const [ordAddressOrdinals = [], walletAddressOrdinals = [], identityAddressOrdinals = [], ...derivedOrdinals] = ordinalArrays

        // Combine and deduplicate by origin.
        // API results are the authoritative source -- do NOT re-add dbOrdinals here.
        // dbOrdinals were already shown immediately for a fast initial
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

        // B-21: Only replace DB ordinals with API data when ALL API calls succeeded.
        // If some calls failed, apiOrdinals is a partial set — keep the full DB set intact.
        const allOrdinals: Ordinal[] = allOrdinalApiCallsSucceeded ? apiOrdinals : dbOrdinals

        // Guard: if account switched during slow API calls, discard results
        if (checkCancelled()) return

        setOrdinalsWithRef(allOrdinals)

        // Re-merge ordinal txids into tx history using the live API ordinals.
        // This handles the case where ordinal_cache was empty at the start of fetchData()
        // (e.g. first sync for a new account). The earlier mergeOrdinalTxEntries call
        // reads from DB cache -- if that cache is empty, it adds 0 synthetic entries
        // and setTxHistory is called with only the 51 DB txs. Now that we have the real
        // ordinals from the API, fill in any missing synthetic entries.
        //
        // B-35: Copy dbTxHistory before mutating — the original array was already passed
        // to setTxHistory above, so pushing onto it would mutate React state in-place.
        {
          const mergedHistory = [...dbTxHistory]
          const liveTxidSet = new Set(mergedHistory.map(tx => tx.tx_hash))
          let historyChanged = false
          for (const ord of allOrdinals) {
            if (!liveTxidSet.has(ord.txid)) {
              // blockHeight may not exist if allOrdinals came from DB fallback (getOrdinalsFromDatabase)
              // rather than from API. Use -1 sentinel as fallback.
              const blockHeight = ord.blockHeight ?? -1
              mergedHistory.push({ tx_hash: ord.txid, height: blockHeight, amount: 1, createdAt: 0 })
              liveTxidSet.add(ord.txid)
              historyChanged = true
            }
          }
          if (historyChanged) {
            mergedHistory.sort(compareTxByHeight)
            if (!checkCancelled()) setTxHistory(mergedHistory)
          }
        }

        // Cache ordinal metadata to DB and fetch missing content in background
        cacheOrdinalsInBackground(allOrdinals, activeAccountId, contentCacheRef, bumpCacheVersion, isCancelled ?? (() => false), allOrdinalApiCallsSucceeded)
      } catch (e) {
        syncLogger.error('Failed to fetch ordinals', e)
        partialErrors.push('ordinals')
      }

      // Fetch UTXOs and notify about lock detection
      try {
        if (checkCancelled()) return
        const utxoList = await getUTXOs(wallet.walletAddress, signal)
        if (checkCancelled()) return
        setUtxos(utxoList)
        if (checkCancelled()) return
        // Notify caller about UTXOs for lock detection
        onLocksDetected({
          utxos: utxoList,
          shouldClearLocks: getKnownUnlockedLocks().size > 0
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
  }, [setBalance, setOrdBalance, setTxHistory, setUtxos, setOrdinalsWithRef, setSyncError, bumpCacheVersion, contentCacheRef])

  return { fetchDataFromDB, fetchData }
}
