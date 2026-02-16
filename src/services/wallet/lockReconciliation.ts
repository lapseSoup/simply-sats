/**
 * Lock reconciliation logic — extracted from WalletContext.fetchData
 *
 * Pure service module: merges detected on-chain locks with preloaded DB locks,
 * estimates lock blocks, persists new locks to the database, and auto-labels
 * lock transactions. No React dependencies.
 */

import type { LockedUTXO } from './types'
import {
  updateLockBlock,
  addUTXO,
  addLockIfNotExists,
  getTransactionLabels,
  updateTransactionLabels,
  getTransactionByTxid,
  upsertTransaction
} from '../database'
import { walletLogger } from '../logger'

/** Average block interval in milliseconds (used for lockBlock estimation) */
const AVG_BLOCK_MS = 600_000

/**
 * Merge detected on-chain locks with preloaded DB locks.
 *
 * For each detected lock that also exists in preloadedLocks:
 *   - Uses the earlier createdAt timestamp
 *   - Estimates lockBlock from mempool timing if not already known
 *   - Backfills lockBlock to the database when estimated
 *
 * Returns the merged list (same length as detectedLocks).
 */
function mergeWithPreloaded(
  detectedLocks: LockedUTXO[],
  preloadedLocks: LockedUTXO[]
): LockedUTXO[] {
  const preloadMap = new Map(
    preloadedLocks.map(l => [`${l.txid}:${l.vout}`, l])
  )

  return detectedLocks.map(lock => {
    const preloaded = preloadMap.get(`${lock.txid}:${lock.vout}`)
    if (!preloaded) return lock

    const earlierCreatedAt = Math.min(lock.createdAt, preloaded.createdAt)
    let estimatedLockBlock = preloaded.lockBlock || lock.lockBlock
    if (!estimatedLockBlock && lock.confirmationBlock && earlierCreatedAt < lock.createdAt) {
      const mempoolMs = lock.createdAt - earlierCreatedAt
      const mempoolBlocks = Math.round(mempoolMs / AVG_BLOCK_MS)
      estimatedLockBlock = lock.confirmationBlock - mempoolBlocks
    }

    // Backfill lockBlock to DB (fire-and-forget)
    if (estimatedLockBlock && !preloaded.lockBlock) {
      updateLockBlock(lock.txid, lock.vout, estimatedLockBlock).catch(e => {
        walletLogger.warn('Failed to backfill lock_block', {
          txid: lock.txid, vout: lock.vout, error: String(e)
        })
      })
    }

    return {
      ...lock,
      lockBlock: estimatedLockBlock,
      createdAt: earlierCreatedAt
    }
  })
}

/**
 * Persist detected locks to the database (best-effort per lock).
 */
async function persistLocks(
  mergedLocks: LockedUTXO[],
  accountId: number | undefined
): Promise<void> {
  for (const lock of mergedLocks) {
    try {
      const utxoId = await addUTXO({
        txid: lock.txid,
        vout: lock.vout,
        satoshis: lock.satoshis,
        lockingScript: lock.lockingScript,
        basket: 'locks',
        spendable: false,
        createdAt: lock.createdAt
      }, accountId)
      await addLockIfNotExists({
        utxoId,
        unlockBlock: lock.unlockBlock,
        lockBlock: lock.lockBlock,
        createdAt: lock.createdAt
      }, accountId)
    } catch (_e) {
      // Best-effort — duplicate key or other transient error
    }
  }
}

/**
 * Auto-label lock transactions in the database.
 *
 * For each merged lock:
 *   - Ensures the 'lock' label is present
 *   - Adds a description if missing
 *   - Fixes the amount sign if it was positive (should be negative for locks)
 */
async function autoLabelLockTransactions(
  mergedLocks: LockedUTXO[],
  accountId: number
): Promise<void> {
  for (const lock of mergedLocks) {
    try {
      const existingLabels = await getTransactionLabels(lock.txid, accountId)
      if (!existingLabels.includes('lock')) {
        await updateTransactionLabels(lock.txid, [...existingLabels, 'lock'], accountId)
      }
      const dbTx = await getTransactionByTxid(lock.txid, accountId)
      if (dbTx) {
        const needsAmountFix = dbTx.amount !== undefined && dbTx.amount > 0
        const needsDescription = !dbTx.description

        if (needsDescription || needsAmountFix) {
          await upsertTransaction({
            txid: dbTx.txid,
            createdAt: dbTx.createdAt,
            status: dbTx.status,
            ...(needsDescription && {
              description: `Locked ${lock.satoshis} sats until block ${lock.unlockBlock}`
            }),
            ...(needsAmountFix && {
              amount: -lock.satoshis
            })
          }, accountId)
        }
      }
    } catch (_e) {
      // Best-effort
    }
  }
}

/**
 * Combine mergedLocks with existing locks (e.g. from React state).
 *
 * Detected (merged) locks take priority. Any existing locks whose outpoint
 * is NOT in the detected set are preserved (e.g. optimistic locks not yet on-chain).
 *
 * Exported so WalletContext can use it inside a React state updater function.
 */
export function combineLocksWithExisting(
  mergedLocks: LockedUTXO[],
  existingLocks: LockedUTXO[]
): LockedUTXO[] {
  const detectedMap = new Map(
    mergedLocks.map(l => [`${l.txid}:${l.vout}`, l])
  )
  for (const existing of existingLocks) {
    const key = `${existing.txid}:${existing.vout}`
    if (!detectedMap.has(key)) {
      detectedMap.set(key, existing)
    }
  }
  return Array.from(detectedMap.values())
}

/**
 * Reconcile detected on-chain locks with preloaded DB locks.
 *
 * Orchestrates the reconciliation pipeline:
 * 1. Merge detected locks with preloaded DB locks (backfill lockBlock)
 * 2. Persist new locks to the database
 * 3. Auto-label lock transactions
 *
 * Returns the merged locks. The caller is responsible for combining these
 * with current React state using combineLocksWithExisting() inside a
 * functional state updater to avoid stale-closure issues.
 *
 * @param detectedLocks - Locks freshly detected from on-chain UTXOs
 * @param preloadedLocks - Locks loaded from the database during fetchData
 * @param accountId - Active account ID (used for DB operations)
 * @returns Merged locks (detected + preloaded data backfilled)
 */
export async function reconcileLocks(
  detectedLocks: LockedUTXO[],
  preloadedLocks: LockedUTXO[],
  accountId: number | undefined
): Promise<LockedUTXO[]> {
  const mergedLocks = mergeWithPreloaded(detectedLocks, preloadedLocks)

  // Persist and label in parallel (both are best-effort)
  await Promise.all([
    persistLocks(mergedLocks, accountId || undefined),
    autoLabelLockTransactions(mergedLocks, accountId || 1)
  ])

  return mergedLocks
}
