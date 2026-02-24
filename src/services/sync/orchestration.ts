/**
 * Sync Orchestration — top-level syncWallet function and coordination logic
 *
 * Coordinates the full wallet sync cycle: address syncing, transaction history,
 * backfilling null amounts, resolving pending transactions, and phantom lock cleanup.
 */

import { BASKETS } from '../../domain/types'
import type { DerivedAddress } from '../database'
import {
  getSpendableUTXOs,
  getDerivedAddresses as getDerivedAddressesFromDB,
  updateDerivedAddressSyncTime,
  getPendingUtxos,
  rollbackPendingSpend,
  getLastSyncedHeight,
  getPendingTransactionTxids,
  updateTransactionStatus,
  getAllTransactions,
  updateTransactionAmount,
  getLocks
} from '../database'
import { RATE_LIMITS } from '../config'
import { getWocClient } from '../../infrastructure/api/wocClient'
import {
  type CancellationToken,
  startNewSync,
  cancelSync,
  isCancellationError,
  cancellableDelay,
  acquireSyncLock,
  isSyncInProgress
} from '../cancellation'
import { syncLogger } from '../logger'
import { getDatabase } from '../../infrastructure/database/connection'
import { syncAddress } from './addressSync'
import { syncTransactionHistory, calculateTxAmount, txDetailCache, clearTxDetailCache } from './historySync'

import type { AddressInfo, SyncResult } from './index'

// Re-export cancellation functions for external use
export { cancelSync, startNewSync, isSyncInProgress }

/**
 * Sync health diagnostic results
 */
export interface SyncHealthResult {
  dbConnected: boolean
  apiReachable: boolean
  derivedAddressQuery: boolean
  utxoQuery: boolean
  errors: string[]
  timings: Record<string, number>
}

/**
 * Diagnose sync health by testing each component independently.
 * Useful for identifying the exact failure point on Windows.
 */
export async function diagnoseSyncHealth(accountId?: number): Promise<SyncHealthResult> {
  const errors: string[] = []
  const timings: Record<string, number> = {}
  let dbConnected = false
  let apiReachable = false
  let derivedAddressQuery = false
  let utxoQuery = false

  // Test 1: Database connectivity
  const dbStart = Date.now()
  try {
    const { getDatabase } = await import('../database')
    const db = getDatabase()
    await db.select('SELECT 1 as test')
    dbConnected = true
  } catch (e) {
    errors.push(`DB: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.db = Date.now() - dbStart

  // Test 2: WoC API reachability
  const apiStart = Date.now()
  try {
    const result = await getWocClient().getBlockHeightSafe()
    apiReachable = result.ok
    if (!result.ok) errors.push(`API: ${result.error.message}`)
  } catch (e) {
    errors.push(`API: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.api = Date.now() - apiStart

  // Test 3: Derived address query
  const derivedStart = Date.now()
  try {
    await getDerivedAddressesFromDB(accountId)
    derivedAddressQuery = true
  } catch (e) {
    errors.push(`DerivedAddr: ${e instanceof Error ? e.message : String(e)}`)
  }
  timings.derived = Date.now() - derivedStart

  // Test 4: UTXO query
  const utxoStart = Date.now()
  {
    const utxoResult = await getSpendableUTXOs(accountId)
    if (utxoResult.ok) {
      utxoQuery = true
    } else {
      errors.push(`UTXO: ${utxoResult.error.message}`)
    }
  }
  timings.utxo = Date.now() - utxoStart

  syncLogger.info('[DIAG] Sync health check', {
    dbConnected, apiReachable, derivedAddressQuery, utxoQuery,
    errors, timings
  })

  return { dbConnected, apiReachable, derivedAddressQuery, utxoQuery, errors, timings }
}

// ---------------------------------------------------------------------------
// Batched concurrency helper
// ---------------------------------------------------------------------------

/**
 * Execute an async function over a list of items in batches with controlled
 * concurrency.  Uses `Promise.allSettled` so a single failure never aborts the
 * remaining items.
 *
 * @param items - Items to process
 * @param fn - Async function to apply to each item
 * @param concurrency - Maximum number of items processed at once
 * @param isCancelled - Optional cancellation predicate checked between batches
 */
async function batchWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  isCancelled?: () => boolean
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  const totalBatches = Math.ceil(items.length / concurrency)
  for (let i = 0; i < items.length; i += concurrency) {
    if (isCancelled?.()) break
    const batchNum = Math.floor(i / concurrency) + 1
    syncLogger.debug(`[SYNC] Batch ${batchNum}/${totalBatches} (items ${i + 1}–${Math.min(i + concurrency, items.length)})`)
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

/**
 * Sync all wallet addresses using batched concurrency.
 *
 * Addresses are processed in batches of `RATE_LIMITS.maxConcurrentRequests`
 * (default 3) with an inter-batch delay of `RATE_LIMITS.addressSyncDelay` to
 * stay within WoC rate limits.  Each batch uses `Promise.allSettled` so a
 * single address failure never aborts the rest.
 *
 * @param addresses - List of addresses to sync
 * @param token - Optional cancellation token to abort the sync
 */
export async function syncAllAddresses(
  addresses: AddressInfo[],
  token?: CancellationToken
): Promise<SyncResult[]> {
  const results: SyncResult[] = []
  const concurrency = RATE_LIMITS.maxConcurrentRequests

  const totalBatches = Math.ceil(addresses.length / concurrency)
  syncLogger.debug(`[SYNC] syncAllAddresses: ${addresses.length} addresses in ~${totalBatches} batches (concurrency=${concurrency})`)

  for (let i = 0; i < addresses.length; i += concurrency) {
    // Check for cancellation before each batch
    if (token?.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled - stopping address sync')
      break
    }

    // Inter-batch delay (skip before the first batch)
    if (i > 0) {
      if (token) {
        await cancellableDelay(RATE_LIMITS.addressSyncDelay, token)
      } else {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMITS.addressSyncDelay))
      }
    }

    const batch = addresses.slice(i, i + concurrency)
    const batchNum = Math.floor(i / concurrency) + 1
    syncLogger.debug(`[SYNC] Batch ${batchNum}/${totalBatches}: syncing ${batch.map(a => a.address.slice(0, 8)).join(', ')}...`)

    const settled = await Promise.allSettled(
      batch.map(addr => syncAddress(addr))
    )

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j]!
      const addr = batch[j]!
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value)
        syncLogger.info(`Synced ${addr.basket}: ${outcome.value.newUtxos} new, ${outcome.value.spentUtxos} spent, ${outcome.value.totalBalance} sats`)
      } else {
        if (isCancellationError(outcome.reason)) {
          syncLogger.debug('[SYNC] Cancelled during address sync')
          // Don't break here — other addresses in the batch may have completed
        } else {
          syncLogger.error(`Failed to sync ${addr.address}:`, outcome.reason)
        }
      }
    }
  }

  return results
}

/**
 * Backfill NULL transaction amounts.
 *
 * After a 12-word restore the sync may store transactions with amount=NULL when
 * the WoC API times out or rate-limits during the initial heavy sync burst.
 * This function re-fetches transaction details in batches and recalculates
 * amounts for any transactions that still have NULL amounts.
 *
 * Uses `getTransactionDetailsBatch` for efficient concurrent fetching and
 * the module-level `txDetailCache` to avoid redundant API calls.
 *
 * Safe to call repeatedly — only touches rows where amount IS NULL.
 */
async function backfillNullAmounts(
  allWalletAddresses: string[],
  accountId?: number
): Promise<number> {
  try {
    const allTxsResult = await getAllTransactions(accountId)
    if (!allTxsResult.ok) {
      syncLogger.warn('[BACKFILL] Failed to get transactions', { error: allTxsResult.error.message })
      return 0
    }
    const allTxs = allTxsResult.value
    const nullAmountTxs = allTxs.filter(tx => tx.amount === undefined || tx.amount === null)

    if (nullAmountTxs.length === 0) return 0

    syncLogger.info(`[BACKFILL] Found ${nullAmountTxs.length} transactions with NULL amounts, recalculating...`)

    const wocClient = getWocClient()
    const primaryAddress = allWalletAddresses[0]
    if (!primaryAddress) return 0

    // --- Batch-fetch all missing tx details in one go ---
    // Filter out txids that are already in the cache
    const txidsToFetch = nullAmountTxs
      .map(tx => tx.txid)
      .filter(txid => !txDetailCache.has(txid))

    if (txidsToFetch.length > 0) {
      syncLogger.debug(`[BACKFILL] Batch-fetching ${txidsToFetch.length} tx details (concurrency=${RATE_LIMITS.maxConcurrentRequests})`)
      const batchMap = await wocClient.getTransactionDetailsBatch(
        txidsToFetch,
        RATE_LIMITS.maxConcurrentRequests
      )
      // Merge into the module-level cache
      for (const [txid, detail] of batchMap) {
        txDetailCache.set(txid, detail)
      }
    }

    // --- Calculate amounts using cached details ---
    let fixed = 0
    const calcResults = await batchWithConcurrency(
      nullAmountTxs,
      async (tx) => {
        const txDetails = txDetailCache.get(tx.txid) ?? null
        if (!txDetails) {
          syncLogger.debug(`[BACKFILL] Could not fetch tx ${tx.txid.slice(0, 8)}... — skipping`)
          return null
        }
        const amount = await calculateTxAmount(txDetails, primaryAddress, allWalletAddresses, accountId)
        const amtResult = await updateTransactionAmount(tx.txid, amount, accountId)
        if (!amtResult.ok) {
          syncLogger.warn(`[BACKFILL] Failed to update amount for ${tx.txid.slice(0,8)}...`, { error: amtResult.error.message })
        }
        syncLogger.debug(`[BACKFILL] Fixed amount for ${tx.txid.slice(0, 8)}... → ${amount} sats`)
        return { txid: tx.txid, amount }
      },
      RATE_LIMITS.maxConcurrentRequests
    )

    for (const r of calcResults) {
      if (r.status === 'fulfilled' && r.value !== null) fixed++
    }

    syncLogger.info(`[BACKFILL] Fixed ${fixed}/${nullAmountTxs.length} transaction amounts`)
    return fixed
  } catch (e) {
    syncLogger.warn('[BACKFILL] backfillNullAmounts failed (non-fatal)', { error: String(e) })
    return 0
  }
}

/**
 * Resolve pending transactions that may have been missed during sync.
 *
 * `syncTransactionHistory` skips already-known txids for efficiency.
 * If a pending transaction is not returned by the history API (e.g. due
 * to an API error mid-sync), `updateTransactionStatus` is never called
 * — so it stays "Pending" forever even after on-chain confirmation.
 *
 * This function queries all pending txids from the DB and, for each one,
 * checks WoC directly.  If confirmed (blockheight > 0), it updates the DB.
 *
 * Safe to call repeatedly — only touches rows where status='pending'.
 */
async function resolvePendingTransactions(accountId?: number): Promise<void> {
  try {
    const pendingResult = await getPendingTransactionTxids(accountId)
    if (!pendingResult.ok) {
      syncLogger.warn('[RESOLVE_PENDING] Failed to query pending txids', { error: pendingResult.error.message })
      return
    }

    const pendingTxids = [...pendingResult.value]
    if (pendingTxids.length === 0) return

    syncLogger.debug(`[RESOLVE_PENDING] Checking ${pendingTxids.length} pending transaction(s)`)

    const wocClient = getWocClient()

    for (const txid of pendingTxids) {
      try {
        const detailResult = await wocClient.getTransactionDetailsSafe(txid)
        if (!detailResult.ok) {
          syncLogger.debug(`[RESOLVE_PENDING] Could not fetch details for ${txid.slice(0, 8)}... (non-fatal)`, { error: detailResult.error.message })
          continue
        }

        const txDetails = detailResult.value
        if (txDetails.blockheight && txDetails.blockheight > 0) {
          const updateResult = await updateTransactionStatus(txid, 'confirmed', txDetails.blockheight, accountId)
          if (updateResult.ok) {
            syncLogger.info(`[RESOLVE_PENDING] Resolved pending tx → confirmed`, { txid: txid.slice(0, 8) + '...', blockheight: txDetails.blockheight })
          } else {
            syncLogger.warn(`[RESOLVE_PENDING] Failed to update status for ${txid.slice(0, 8)}...`, { error: updateResult.error.message })
          }
        }
      } catch (e) {
        syncLogger.debug(`[RESOLVE_PENDING] Error checking ${txid.slice(0, 8)}... (non-fatal)`, { error: String(e) })
      }
    }
  } catch (e) {
    syncLogger.warn('[RESOLVE_PENDING] resolvePendingTransactions failed (non-fatal)', { error: String(e) })
  }
}

/**
 * Full wallet sync - syncs all three address types plus derived addresses
 * Automatically cancels any previous sync in progress
 * @param walletAddress - Main wallet address
 * @param ordAddress - Ordinals address
 * @param identityAddress - Identity address
 * @param accountId - Account ID for scoping data (optional, defaults to 1)
 * @returns Object with total balance and sync results, or undefined if cancelled
 */
export async function syncWallet(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string,
  accountId?: number,
  walletPubKey?: string
): Promise<{ total: number; results: SyncResult[] } | undefined> {
  // Acquire sync lock to prevent database race conditions
  // This ensures only one sync runs at a time
  const releaseLock = await acquireSyncLock(accountId ?? 1)

  // Start new sync (cancels any previous sync)
  const token = startNewSync()

  try {
    // Recover any UTXOs stuck in 'pending' state for more than 5 minutes
    // These can occur when a broadcast fails after marking UTXOs as pending
    try {
      const pendingResult = await getPendingUtxos(5 * 60 * 1000)
      if (!pendingResult.ok) {
        syncLogger.warn('[SYNC] Failed to query pending UTXOs', { error: pendingResult.error.message })
      } else if (pendingResult.value.length > 0) {
        syncLogger.warn(`[SYNC] Found ${pendingResult.value.length} stuck pending UTXOs — rolling back`)
        const rollbackResult = await rollbackPendingSpend(pendingResult.value.map(u => ({ txid: u.txid, vout: u.vout })))
        if (!rollbackResult.ok) {
          syncLogger.warn('[SYNC] Failed to rollback pending UTXOs', { error: rollbackResult.error.message })
        }
      }
    } catch (error) {
      syncLogger.warn('[SYNC] Failed to recover pending UTXOs', { error: String(error) })
    }

    // Sync derived addresses FIRST (most important for correct balance)
    let derivedAddresses: DerivedAddress[]
    try {
      derivedAddresses = await getDerivedAddressesFromDB(accountId)
    } catch (e) {
      syncLogger.error('[SYNC] DB query failed: getDerivedAddressesFromDB', e)
      throw new Error(`Database query failed (derived addresses): ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!Array.isArray(derivedAddresses)) {
      syncLogger.warn('[SYNC] getDerivedAddressesFromDB returned non-array, defaulting to empty', { type: typeof derivedAddresses })
      derivedAddresses = []
    }
    syncLogger.debug(`[SYNC] Found ${derivedAddresses.length} derived addresses in database`)

    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled before starting')
      return undefined
    }

    const addresses: AddressInfo[] = []

    // Add derived addresses first (priority)
    // Note: the wif field in AddressInfo is not used during sync (syncAddress does
    // not sign anything). WIF re-derivation happens at spend time in useWalletSend /
    // getAllSpendableUTXOs. We intentionally omit it here to avoid routing key
    // material through the sync infrastructure (S-19).
    for (const derived of derivedAddresses) {
      syncLogger.debug(`[SYNC] Adding derived address to sync (priority): ${derived.address}`)
      addresses.push({
        address: derived.address,
        basket: BASKETS.DERIVED,
        accountId
      })
    }

    // Then add main addresses
    addresses.push(
      { address: walletAddress, basket: BASKETS.DEFAULT, accountId },
      { address: ordAddress, basket: BASKETS.ORDINALS, accountId },
      { address: identityAddress, basket: BASKETS.IDENTITY, accountId }
    )

    syncLogger.debug(`[SYNC] Total addresses to sync: ${addresses.length}`)
    const results = await syncAllAddresses(addresses, token)

    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled during sync')
      return undefined
    }

    // Sync transaction history for main + ordinals addresses (ordinals receive at ordAddress)
    // Identity address excluded to reduce API calls; derived addresses included for payments
    const txHistoryAddresses = [walletAddress, ordAddress, ...derivedAddresses.map(d => d.address)]
    // All wallet addresses for accurate input matching in calculateTxAmount
    const allWalletAddresses = [walletAddress, ordAddress, identityAddress, ...derivedAddresses.map(d => d.address)]
    syncLogger.debug(`[SYNC] Syncing transaction history for ${txHistoryAddresses.length} addresses (account=${accountId ?? 1})`)

    // Re-check cancellation before starting expensive tx history sync loop
    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled before transaction history sync')
      return undefined
    }

    for (const addr of txHistoryAddresses) {
      if (token.isCancelled) break
      try {
        await syncTransactionHistory(addr, accountId, allWalletAddresses, walletPubKey)
        // Cancellable delay to avoid rate limiting — aborts immediately on cancellation
        // instead of waiting the full delay when the user switches accounts
        try {
          await cancellableDelay(RATE_LIMITS.addressSyncDelay, token)
        } catch { break } // CancellationError — exit the loop
      } catch (e) {
        syncLogger.warn(`Failed to sync tx history for ${addr.slice(0,12)}...`, { error: String(e) })
      }
    }

    // Backfill any transactions that were stored with NULL amounts
    // (common after 12-word restore when API rate limits cause failures)
    if (!token.isCancelled) {
      await backfillNullAmounts(allWalletAddresses, accountId)
    }

    // Resolve pending transactions that may have been missed by the history limit.
    // The history sync slices to the most recent N txs per address — transactions
    // broadcast just before older ones fill the limit (e.g. unlock after 30 prior txs)
    // may not appear in the sliced window and never get status updated to confirmed.
    if (!token.isCancelled) {
      await resolvePendingTransactions(accountId)
    }

    // Void phantom locks — DB lock records whose txid doesn't exist on-chain.
    // These are created when a broadcast failure (e.g. txn-mempool-conflict) was
    // falsely treated as success, writing a lock with a locally-computed txid that
    // was never actually broadcast. A 404 from WoC confirms the tx never existed.
    //
    // Uses direct DELETE by primary key — previous approach via markLockUnlockedByTxid
    // silently updated 0 rows due to account_id subquery mismatches between the
    // locks and utxos tables.
    if (!token.isCancelled) {
      try {
        const woc = getWocClient()
        const dbLocks = await getLocks(0, accountId)
        syncLogger.info('[SYNC] Phantom lock check: scanning locks', { count: dbLocks.length, accountId })

        for (const lock of dbLocks) {
          if (token.isCancelled) break
          const { txid, vout } = lock.utxo
          const utxoId = lock.utxo.id
          syncLogger.debug('[SYNC] Checking lock on-chain', { txid: txid.slice(0, 12), vout })

          const txResult = await woc.getTransactionDetailsSafe(txid)

          if (!txResult.ok) {
            syncLogger.info('[SYNC] Lock tx fetch failed', {
              txid: txid.slice(0, 12),
              code: txResult.error.code,
              status: txResult.error.status,
              message: txResult.error.message
            })
          }

          if (!txResult.ok && txResult.error.status === 404) {
            syncLogger.warn('[SYNC] PHANTOM DETECTED — purging lock, UTXO, and transaction', {
              txid: txid.slice(0, 12), vout, utxoId
            })

            // Direct DELETE by primary key — bypasses account_id subquery entirely
            const db = getDatabase()
            await db.execute('DELETE FROM locks WHERE utxo_id = $1', [utxoId])
            await db.execute('DELETE FROM utxos WHERE id = $1', [utxoId])
            await db.execute('DELETE FROM transaction_labels WHERE txid = $1', [txid])
            await db.execute('DELETE FROM transactions WHERE txid = $1', [txid])

            syncLogger.warn('[SYNC] Phantom lock fully purged from all tables', { txid: txid.slice(0, 12) })
          }
        }
      } catch (phantomErr) {
        syncLogger.warn('[SYNC] Phantom lock cleanup failed (non-fatal)', { error: String(phantomErr) })
      }
    }

    // Final cancellation check before computing results and updating timestamps.
    // If cancelled, the DB writes above already stopped — skip the final bookkeeping
    // to avoid writing stale sync timestamps for an account that's no longer active.
    if (token.isCancelled) {
      syncLogger.debug('[SYNC] Cancelled before final balance calculation')
      return undefined
    }

    // Update sync timestamps for derived addresses
    for (const derived of derivedAddresses) {
      if (token.isCancelled) break
      const result = results.find(r => r.address === derived.address)
      if (result) {
        await updateDerivedAddressSyncTime(derived.address)
      }
    }

    const total = results.reduce((sum, r) => sum + r.totalBalance, 0)

    return { total, results }
  } catch (error) {
    if (isCancellationError(error)) {
      syncLogger.debug('[SYNC] Wallet sync cancelled')
      return undefined
    }
    throw error
  } finally {
    // Always release the lock and clear per-sync caches when done
    clearTxDetailCache()
    releaseLock()
  }
}

/**
 * Check if initial sync is needed
 */
export async function needsInitialSync(addresses: string[], accountId?: number): Promise<boolean> {
  // First check: does sync_state say any address has never been synced for this account?
  for (const addr of addresses) {
    const lastHeightResult = await getLastSyncedHeight(addr, accountId)
    const lastHeight = lastHeightResult.ok ? lastHeightResult.value : 0
    if (lastHeight === 0) {
      return true
    }
  }

  // Second check: sync_state may be stale from a previous install or account ID change.
  // If sync_state says "already synced" but the account has zero transactions in the DB,
  // force a re-sync to repopulate from the blockchain.
  if (accountId !== undefined) {
    const txCountResult = await getAllTransactions(accountId)
    const hasTxs = txCountResult.ok && txCountResult.value.length > 0
    if (!hasTxs) {
      syncLogger.info('[SYNC] sync_state shows synced but no transactions found for account — forcing re-sync', { accountId })
      return true
    }
  }

  return false
}

/**
 * Get the most recent sync timestamp for any address in this account.
 * Returns 0 if never synced. Used to determine if background sync is needed.
 */
export async function getLastSyncTimeForAccount(accountId: number): Promise<number> {
  const { getAllSyncStates } = await import('../../infrastructure/database/syncRepository')
  const result = await getAllSyncStates(accountId)
  if (!result.ok || result.value.length === 0) return 0
  return Math.max(...result.value.map(s => s.syncedAt))
}

/**
 * Clear sync timestamps for an account so it's treated as "stale" on next
 * visit. Preserves last_synced_height for incremental sync efficiency.
 * Used after a background pre-sync to ensure the staleness check fires a
 * fresh API fetch when the user actually switches to that account.
 */
export async function clearSyncTimesForAccount(accountId: number): Promise<void> {
  const { clearSyncTimesForAccount: clearFn } = await import('../../infrastructure/database/syncRepository')
  await clearFn(accountId)
}

/**
 * Restore wallet - full sync that rebuilds the database from blockchain
 * This is what happens when you restore from 12 words
 * @param walletAddress - Main wallet address
 * @param ordAddress - Ordinals address
 * @param identityAddress - Identity address
 * @param accountId - Account ID for scoping data
 */
export async function restoreFromBlockchain(
  walletAddress: string,
  ordAddress: string,
  identityAddress: string,
  accountId?: number,
  walletPubKey?: string
): Promise<{ total: number; results: SyncResult[] }> {
  syncLogger.info('Starting wallet restore from blockchain...')

  // Perform full sync
  const result = await syncWallet(walletAddress, ordAddress, identityAddress, accountId, walletPubKey)

  syncLogger.info(`Restore complete: ${result?.total ?? 0} total satoshis found`)
  if (result) {
    syncLogger.debug('Results', { results: result.results })
  }

  if (!result) {
    throw new Error('Wallet restore was cancelled')
  }
  return result
}
