/**
 * Hook for blockchain sync orchestration: performSync (syncWallet / restoreFromBlockchain).
 *
 * Extracted from SyncContext to reduce god-object complexity.
 */

import { useCallback } from 'react'
import type { WalletKeys } from '../services/wallet'
import { getAllTransactions } from '../infrastructure/database'
import { getCachedOrdinals } from '../services/ordinalCache'
import {
  syncWallet,
  restoreFromBlockchain,
  getBalanceFromDatabase,
  getOrdinalsFromDatabase
} from '../services/sync'
import { syncLogger } from '../services/logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'
import type { TxHistoryItem, BasketBalances } from '../contexts/SyncContext'

/** Sort transactions: unconfirmed first, then by block height descending, createdAt tiebreaker */
function compareTxByHeight(a: TxHistoryItem, b: TxHistoryItem): number {
  const aH = a.height || 0, bH = b.height || 0
  if (aH === 0 && bH !== 0) return -1
  if (bH === 0 && aH !== 0) return 1
  if (aH === 0 && bH === 0) return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  return bH - aH
}

/**
 * Merge synthetic TxHistoryItems for ordinal receives whose txids are not in
 * the DB transactions table. Reads from local SQLite only -- no API calls.
 */
async function mergeOrdinalTxEntries(
  dbTxHistory: TxHistoryItem[],
  accountId: number | null
): Promise<void> {
  const ordinalTxidHeights = new Map<string, number>()
  try {
    const cachedOrds = await getCachedOrdinals(accountId ?? undefined)
    if (cachedOrds.length > 0) {
      for (const c of cachedOrds) ordinalTxidHeights.set(c.txid, c.blockHeight ?? -1)
    } else {
      const dbOrds = await getOrdinalsFromDatabase(accountId ?? undefined)
      for (const o of dbOrds) ordinalTxidHeights.set(o.txid, -1)
    }
  } catch (e) { console.warn('[SyncContext] mergeOrdinalTxEntries failed:', e) }

  const dbTxidSet = new Set(dbTxHistory.map(tx => tx.tx_hash))
  for (const [txid, height] of ordinalTxidHeights) {
    if (!dbTxidSet.has(txid)) {
      dbTxHistory.push({ tx_hash: txid, height, amount: 1, createdAt: 0 })
    }
  }
}

interface UseSyncOrchestrationOptions {
  setSyncing: (syncing: boolean) => void
  setBalance: (balance: number) => void
  setBasketBalances: (balances: BasketBalances) => void
  setTxHistory: (history: TxHistoryItem[]) => void
  setSyncError: (error: string | null) => void
}

interface UseSyncOrchestrationReturn {
  performSync: (
    wallet: WalletKeys,
    activeAccountId: number | null,
    isRestore?: boolean,
    forceReset?: boolean,
    silent?: boolean,
    isCancelled?: () => boolean
  ) => Promise<void>
}

export function useSyncOrchestration({
  setSyncing,
  setBalance,
  setBasketBalances,
  setTxHistory,
  setSyncError
}: UseSyncOrchestrationOptions): UseSyncOrchestrationReturn {

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

      // Guard: never sync without a valid account ID -- null would cause syncTransactionHistory
      // to store transactions with account_id=1 (the ?? 1 default in addTransaction), bleeding
      // all synced transactions into account 1 regardless of which account is active.
      if (!activeAccountId) {
        syncLogger.warn('[SYNC] performSync called with null activeAccountId -- aborting to prevent cross-account data write')
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
      // with this (now-inactive) account's values -- causing wrong balance display.
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
      // txHistory state -- stale records linger until fetchData runs otherwise.
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
          dbTxHistory.sort(compareTxByHeight)
          setTxHistory(dbTxHistory)
        }
      } catch (_e) {
        // Non-fatal: stale txHistory in UI is better than crash
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error('Sync failed', error)

      // Don't set error state if account changed -- it's not relevant to the new account
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
  }, [setSyncing, setBalance, setBasketBalances, setTxHistory, setSyncError])

  return { performSync }
}
