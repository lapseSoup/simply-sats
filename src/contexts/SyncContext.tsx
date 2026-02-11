/**
 * SyncContext - Handles wallet synchronization state and operations
 *
 * Extracted from WalletContext to improve maintainability.
 * Provides sync-related state that can be consumed independently.
 */

import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { WalletKeys, UTXO, Ordinal } from '../services/wallet'
import { getBalance, getUTXOs, getOrdinals } from '../services/wallet'
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
} from '../services/database'
import {
  syncWallet,
  restoreFromBlockchain,
  getBalanceFromDatabase,
  getOrdinalsFromDatabase
} from '../services/sync'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import { useNetwork } from './NetworkContext'
import { syncLogger } from '../services/logger'

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
  resetSync: () => void
  performSync: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore?: boolean,
    forceReset?: boolean
  ) => Promise<void>
  fetchData: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: import('../services/wallet').LockedUTXO[] }) => void
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
  const [balance, setBalance] = useState<number>(() => {
    try {
      const cached = localStorage.getItem('simply_sats_cached_balance')
      return cached ? parseInt(cached, 10) : 0
    } catch { return 0 }
  })
  const [ordBalance, setOrdBalance] = useState<number>(() => {
    try {
      const cached = localStorage.getItem('simply_sats_cached_ord_balance')
      return cached ? parseInt(cached, 10) : 0
    } catch { return 0 }
  })
  const [syncError, setSyncError] = useState<string | null>(null)
  const [ordinalContentCache, setOrdinalContentCache] = useState<Map<string, OrdinalContentEntry>>(new Map())
  const contentCacheRef = useRef<Map<string, OrdinalContentEntry>>(new Map())

  const resetSync = useCallback(() => {
    setUtxos([])
    setOrdinals([])
    setTxHistory([])
    setBasketBalances({ default: 0, ordinals: 0, identity: 0, derived: 0, locks: 0 })
    setBalance(0)
    setOrdBalance(0)
    setSyncError(null)
    setOrdinalContentCache(new Map())
    contentCacheRef.current = new Map()
  }, [])

  // Sync wallet with blockchain
  const performSync = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore = false,
    forceReset = false
  ) => {
    setSyncing(true)
    try {
      // When forceReset, clear all UTXOs so sync rebuilds from chain state
      if (forceReset && activeAccountId) {
        syncLogger.info('Force reset: clearing UTXOs for account', { accountId: activeAccountId })
        const { clearUtxosForAccount } = await import('../services/database')
        await clearUtxosForAccount(activeAccountId)
      }

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
        try { localStorage.setItem('simply_sats_cached_balance', String(totalBalance)) } catch { /* quota exceeded */ }
      } catch (e) {
        syncLogger.error('Failed to get basket balances', e)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      setSyncError(`Sync failed: ${msg}`)
      syncLogger.error('Sync failed', error)
    } finally {
      setSyncing(false)
    }
  }, [setSyncing])

  // Fetch data from database and API
  const fetchData = useCallback(async (
    wallet: WalletKeys,
    activeAccountId: number | null,
    knownUnlockedLocks: Set<string>,
    onLocksDetected: (locks: { utxos: UTXO[]; shouldClearLocks: boolean; preloadedLocks?: import('../services/wallet').LockedUTXO[] }) => void
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
      try { localStorage.setItem('simply_sats_cached_balance', String(totalBalance)) } catch { /* quota exceeded */ }
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
        setOrdBalance(totalOrdBalance)
        try { localStorage.setItem('simply_sats_cached_ord_balance', String(totalOrdBalance)) } catch { /* quota exceeded */ }
      } catch (_e) {
        // On API failure, keep current React state — don't overwrite with stale cache
        syncLogger.warn('Failed to fetch ord balance from API, keeping current value')
      }

      // Get transaction history from DATABASE (scoped to account)
      const dbTxs = await getAllTransactions(30, activeAccountId || undefined)
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

      setTxHistory(dbTxHistory)

      // Load locks from database instantly so they appear before blockchain detection
      let preloadedLocks: import('../services/wallet').LockedUTXO[] = []
      try {
        const dbLocks = await getLocksFromDB(0, activeAccountId || undefined)
        preloadedLocks = dbLocks.map(lock => ({
          txid: lock.utxo.txid,
          vout: lock.utxo.vout,
          satoshis: lock.utxo.satoshis,
          lockingScript: lock.utxo.lockingScript,
          unlockBlock: lock.unlockBlock,
          publicKeyHex: wallet.walletPubKey,
          createdAt: lock.createdAt,
          lockBlock: lock.lockBlock
        }))
        if (preloadedLocks.length > 0) {
          // Send preloaded locks immediately via callback so UI updates
          onLocksDetected({ utxos: [], shouldClearLocks: false, preloadedLocks })
        }
      } catch (_e) {
        syncLogger.warn('Failed to preload locks from DB')
      }

      // Get ordinals - first from database (already synced), then supplement with API calls
      try {
        const dbOrdinals = await getOrdinalsFromDatabase(activeAccountId || undefined)
        syncLogger.debug('Found ordinals in database', { count: dbOrdinals.length, accountId: activeAccountId })

        // Load cached content from DB for instant previews
        const cachedOrdinals = await getCachedOrdinals(activeAccountId || undefined)
        const newCache = new Map<string, OrdinalContentEntry>()
        for (const cached of cachedOrdinals) {
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
        const derivedAddrs = await getDerivedAddresses(activeAccountId || undefined)

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

        setOrdinals(allOrdinals)

        // Cache ordinal metadata to DB and fetch missing content in background
        cacheOrdinalsInBackground(allOrdinals, activeAccountId, contentCacheRef, setOrdinalContentCache)
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
    fetchData
  }), [utxos, ordinals, txHistory, basketBalances, balance, ordBalance, syncError, ordinalContentCache, setUtxos, setOrdinals, setTxHistory, setBasketBalances, setBalance, setOrdBalance, resetSync, performSync, fetchData])

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
  setOrdinalContentCache: React.Dispatch<React.SetStateAction<Map<string, OrdinalContentEntry>>>
): Promise<void> {
  try {
    // 1. Save metadata to DB
    const now = Date.now()
    for (const ord of allOrdinals) {
      const cached: CachedOrdinal = {
        origin: ord.origin,
        txid: ord.txid,
        vout: ord.vout,
        satoshis: ord.satoshis,
        contentType: ord.contentType,
        contentHash: ord.content,
        accountId: activeAccountId || undefined,
        fetchedAt: now
      }
      await upsertOrdinalCache(cached)
    }
    syncLogger.debug('Cached ordinal metadata', { count: allOrdinals.length })

    // 2. Fetch missing content (up to 10 per cycle)
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
