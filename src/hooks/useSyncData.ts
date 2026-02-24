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
  setOrdinalContentCache: React.Dispatch<React.SetStateAction<Map<string, OrdinalContentEntry>>>
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
  ordinalsRef: MutableRefObject<Ordinal[]>
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
    knownUnlockedLocks: Set<string>,
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
  setOrdinalContentCache,
  contentCacheRef,
  ordinalsRef
}: UseSyncDataOptions): UseSyncDataReturn {

  // Load all data from local DB only -- no API calls. Completes fast for instant switching.
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
        try { localStorage.setItem(`${STORAGE_KEYS.CACHED_BALANCE}_${activeAccountId}`, String(totalBalance)) } catch (_e) { syncLogger.warn('localStorage quota exceeded for cached balance', { error: String(_e) }) }
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

      dbTxHistory.sort(compareTxByHeight)
      setTxHistory(dbTxHistory)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: tx history read failed', { error: String(e) })
    }

    // Locks from DB
    try {
      const dbLocks = await getLocksFromDB(0, activeAccountId)
      if (isCancelled?.()) return
      const mapped = mapDbLocksToLockedUtxos(dbLocks, wallet.walletPubKey)
      // Always call even for empty arrays -- ensures accounts with 0 locks
      // get setLocks([]) to clear any stale locks from a previous account
      onLocksLoaded(mapped)
    } catch (e) {
      syncLogger.warn('fetchDataFromDB: locks read failed', { error: String(e) })
    }

    // Ordinals from DB -- use the ordinal_cache table as the primary source since it
    // contains the full set from the last API fetch (across all addresses: ord, wallet,
    // identity, derived). The UTXOs table only has ordAddress UTXOs (basket='ordinals'),
    // which is a small subset. Fall back to UTXOs if the cache is empty.
    try {
      const cachedOrdinals = await getCachedOrdinals(activeAccountId)
      if (isCancelled?.()) return

      if (cachedOrdinals.length > 0) {
        // Map CachedOrdinal -> Ordinal for setOrdinals
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
        // Cache empty -- fall back to UTXOs table (basket='ordinals')
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId)
        if (isCancelled?.()) return
        setOrdinalsWithRef(dbOrdinals)
      }

      // Load content previews in a single batch query -- include ALL cached origins
      // (transferred + owned) so activity tab thumbnails work for ordinals no longer
      // in the wallet. Batch loading avoids 620+ sequential DB queries that caused
      // visible flicker and isCancelled() aborts during account switching.
      const allOrigins = await getAllCachedOrdinalOrigins(activeAccountId)
      if (isCancelled?.()) return
      const newCache = await getBatchOrdinalContent(allOrigins)
      if (isCancelled?.()) return
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

    // Ord balance is API-only -- no DB cache. Reset to 0 so the old account's
    // ord balance doesn't persist in the UI until the next API fetch.
    setOrdBalance(0)
    setSyncError(null)
  }, [setBalance, setOrdBalance, setTxHistory, setUtxos, setOrdinalsWithRef, setSyncError, setOrdinalContentCache, contentCacheRef])

  // Fetch data from database and API
  const fetchData = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: LockedUTXO[] }) => void,
    isCancelled?: () => boolean
  ) => {
    // Guard: require a valid account ID to prevent cross-account data leaks
    if (!activeAccountId) return

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

        // Display DB ordinals immediately (before slow API calls) -- but ONLY on cold
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
        if (checkCancelled()) return
        const newCache = await getBatchOrdinalContent(allCachedOrigins)
        if (newCache.size > 0) {
          contentCacheRef.current = newCache
          setOrdinalContentCache(new Map(newCache))
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
        {
          const liveTxidSet = new Set(dbTxHistory.map(tx => tx.tx_hash))
          let historyChanged = false
          for (const ord of allOrdinals) {
            if (!liveTxidSet.has(ord.txid)) {
              // blockHeight may not exist if allOrdinals came from DB fallback (getOrdinalsFromDatabase)
              // rather than from API. Use -1 sentinel as fallback.
              const blockHeight = ord.blockHeight ?? -1
              dbTxHistory.push({ tx_hash: ord.txid, height: blockHeight, amount: 1, createdAt: 0 })
              liveTxidSet.add(ord.txid)
              historyChanged = true
            }
          }
          if (historyChanged) {
            dbTxHistory.sort(compareTxByHeight)
            if (!checkCancelled()) setTxHistory([...dbTxHistory])
          }
        }

        // Cache ordinal metadata to DB and fetch missing content in background
        cacheOrdinalsInBackground(allOrdinals, activeAccountId, contentCacheRef, setOrdinalContentCache, isCancelled ?? (() => false), allOrdinalApiCallsSucceeded)
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
  }, [setBalance, setOrdBalance, setTxHistory, setUtxos, setOrdinalsWithRef, setSyncError, setOrdinalContentCache, contentCacheRef, ordinalsRef])

  return { fetchDataFromDB, fetchData }
}
