/**
 * Shared sync helper utilities used by useSyncData and useSyncOrchestration.
 *
 * Extracted to eliminate duplication between the two hook files.
 */

import { getCachedOrdinals } from '../services/ordinalCache'
import { getOrdinalsFromDatabase } from '../services/sync'
import { syncLogger } from '../services/logger'
import type { TxHistoryItem } from '../contexts/SyncContext'

/** Sort transactions: unconfirmed first, then by block height descending, createdAt tiebreaker */
export function compareTxByHeight(a: TxHistoryItem, b: TxHistoryItem): number {
  const aH = a.height || 0, bH = b.height || 0
  if (aH === 0 && bH !== 0) return -1
  if (bH === 0 && aH !== 0) return 1
  if (aH === 0 && bH === 0) return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  return bH - aH
}

/**
 * Merge synthetic TxHistoryItems for ordinal receives whose txids are not in
 * the DB transactions table. Uses real block heights from ordinal_cache when
 * available; falls back to -1 sentinel for ordinals without cached height.
 * Mutates `dbTxHistory` in place. No API calls -- reads from local SQLite only.
 */
export async function mergeOrdinalTxEntries(
  dbTxHistory: TxHistoryItem[],
  accountId: number | null
): Promise<void> {
  // Map<txid, blockHeight> -- -1 sentinel means height unknown
  const ordinalTxidHeights = new Map<string, number>()
  try {
    const cachedOrds = await getCachedOrdinals(accountId ?? undefined)
    if (cachedOrds.length > 0) {
      for (const c of cachedOrds) ordinalTxidHeights.set(c.txid, c.blockHeight ?? -1)
    } else {
      const dbOrds = await getOrdinalsFromDatabase(accountId ?? undefined)
      for (const o of dbOrds) ordinalTxidHeights.set(o.txid, -1)  // utxos table has no height
    }
  } catch (e) { syncLogger.warn('mergeOrdinalTxEntries failed', { error: String(e) }) }

  const dbTxidSet = new Set(dbTxHistory.map(tx => tx.tx_hash))
  for (const [txid, height] of ordinalTxidHeights) {
    if (!dbTxidSet.has(txid)) {
      dbTxHistory.push({ tx_hash: txid, height, amount: 1, createdAt: 0 })
    }
  }
}
