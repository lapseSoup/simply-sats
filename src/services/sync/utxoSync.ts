/**
 * UTXO Sync — UTXO fetching, DB persistence, and reconciliation
 *
 * Database-level UTXO operations: balance queries, spendable UTXO retrieval,
 * ordinals retrieval, lock mapping, transaction recording, and spend tracking.
 */

import { BASKETS } from '../../domain/types'
import type { LockedUTXO } from '../wallet/types'
import {
  getSpendableUTXOs,
  markUTXOSpent,
  upsertTransaction,
  type UTXO as DBUtxo
} from '../database'
import { syncLogger } from '../logger'

// Re-export pending spend functions from database for race condition prevention
export {
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos
} from '../database'

/**
 * Quick balance check - just sums current spendable UTXOs from database
 * Much faster than fetching from blockchain
 * @param basket - Optional basket filter
 * @param accountId - Account ID to filter by (optional)
 */
export async function getBalanceFromDatabase(basket?: string, accountId?: number): Promise<number> {
  const utxosResult = await getSpendableUTXOs(accountId)
  if (!utxosResult.ok) {
    syncLogger.warn('[BALANCE] Failed to query spendable UTXOs', { error: utxosResult.error.message })
    return 0
  }
  const utxos = utxosResult.value

  if (basket) {
    const filtered = utxos.filter(u => u.basket === basket)
    const balance = filtered.reduce((sum, u) => sum + u.satoshis, 0)
    syncLogger.debug(`[BALANCE] getBalanceFromDatabase('${basket}', account=${accountId}): ${filtered.length} UTXOs, ${balance} sats`)
    if (basket === 'derived' && filtered.length > 0) {
      syncLogger.debug('[BALANCE] Derived UTXOs', { utxos: filtered.map(u => ({ txid: u.txid.slice(0, 8), vout: u.vout, sats: u.satoshis, basket: u.basket })) })
    }
    return balance
  }

  return utxos.reduce((sum, u) => sum + u.satoshis, 0)
}

/**
 * Get UTXOs for spending from database
 * Returns UTXOs from the specified basket, sorted by value (smallest first for coin selection)
 * @param basket - The basket to filter by
 * @param accountId - Account ID to filter by (optional)
 */
export async function getSpendableUtxosFromDatabase(basket: string = BASKETS.DEFAULT, accountId?: number): Promise<DBUtxo[]> {
  const allUtxosResult = await getSpendableUTXOs(accountId)
  if (!allUtxosResult.ok) {
    syncLogger.warn('[DB] Failed to query spendable UTXOs', { error: allUtxosResult.error.message })
    return []
  }
  return allUtxosResult.value
    .filter(u => u.basket === basket)
    .sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Map database lock records to LockedUTXO format.
 * Used by WalletContext and SyncContext when preloading locks from DB.
 */
export function mapDbLocksToLockedUtxos(
  dbLocks: Awaited<ReturnType<typeof import('../database').getLocks>>,
  walletPubKey: string
): LockedUTXO[] {
  return dbLocks.map(lock => ({
    txid: lock.utxo.txid,
    vout: lock.utxo.vout,
    satoshis: lock.utxo.satoshis,
    lockingScript: lock.utxo.lockingScript,
    unlockBlock: lock.unlockBlock,
    publicKeyHex: walletPubKey,
    createdAt: lock.createdAt,
    lockBlock: lock.lockBlock
  }))
}

/**
 * Get ordinals from the database (ordinals basket)
 * Returns ordinals that are stored in the database from syncing
 * @param accountId - Account ID to filter by (optional)
 */
export async function getOrdinalsFromDatabase(accountId?: number): Promise<{ txid: string; vout: number; satoshis: number; origin: string }[]> {
  const allUtxosResult = await getSpendableUTXOs(accountId)
  if (!allUtxosResult.ok) {
    syncLogger.warn('[DB] Failed to query UTXOs for ordinals', { error: allUtxosResult.error.message })
    return []
  }
  const ordinalUtxos = allUtxosResult.value.filter(u => u.basket === BASKETS.ORDINALS)
  syncLogger.debug(`[Ordinals] Found ${ordinalUtxos.length} ordinals in database (account=${accountId})`)
  return ordinalUtxos.map(u => ({
    txid: u.txid,
    vout: u.vout,
    satoshis: u.satoshis,
    origin: `${u.txid}_${u.vout}`
  }))
}

/**
 * Record a transaction we sent
 * @param txid - Transaction ID
 * @param rawTx - Raw transaction hex
 * @param description - Transaction description
 * @param labels - Transaction labels
 * @param amount - Transaction amount in satoshis
 * @param accountId - Account ID for scoping data
 */
export async function recordSentTransaction(
  txid: string,
  rawTx: string,
  description: string,
  labels: string[] = [],
  amount?: number,
  accountId?: number
): Promise<void> {
  const result = await upsertTransaction({
    txid,
    rawTx,
    description,
    createdAt: Date.now(),
    status: 'pending',
    labels,
    amount
  }, accountId)
  if (!result.ok) {
    syncLogger.warn('recordSentTransaction: upsertTransaction failed', { txid, error: result.error.message })
  }
}

/**
 * Mark UTXOs as spent after sending a transaction
 */
export async function markUtxosSpent(
  utxos: { txid: string; vout: number }[],
  spendingTxid: string,
  accountId?: number
): Promise<void> {
  for (const utxo of utxos) {
    const markResult = await markUTXOSpent(utxo.txid, utxo.vout, spendingTxid, accountId)
    if (!markResult.ok) {
      syncLogger.warn('[DB] Failed to mark UTXO spent', { txid: utxo.txid, vout: utxo.vout, error: markResult.error.message })
    }
  }
}
