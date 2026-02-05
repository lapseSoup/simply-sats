/**
 * Transaction Repository
 *
 * CRUD operations for transactions and labels.
 */

import { getDatabase } from './connection'
import type { Transaction } from './types'
import type { TransactionRow, SqlParams } from '../database-types'

/**
 * Add a new transaction (won't overwrite if exists)
 */
export async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
  const database = getDatabase()

  // Use INSERT OR IGNORE to not overwrite existing transactions
  await database.execute(
    `INSERT OR IGNORE INTO transactions (txid, raw_tx, description, created_at, confirmed_at, block_height, status, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status, tx.amount ?? null]
  )

  // If amount was provided and row already existed, update the amount
  if (tx.amount !== undefined) {
    await database.execute(
      'UPDATE transactions SET amount = COALESCE(amount, $1) WHERE txid = $2 AND amount IS NULL',
      [tx.amount, tx.txid]
    )
  }

  // Add labels if provided
  if (tx.labels && tx.labels.length > 0) {
    for (const label of tx.labels) {
      await database.execute(
        'INSERT OR IGNORE INTO transaction_labels (txid, label) VALUES ($1, $2)',
        [tx.txid, label]
      )
    }
  }

  return tx.txid
}

/**
 * Add or update a transaction (will update fields if exists)
 */
export async function upsertTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
  const database = getDatabase()

  // First try to insert
  await database.execute(
    `INSERT OR IGNORE INTO transactions (txid, raw_tx, description, created_at, confirmed_at, block_height, status, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status, tx.amount ?? null]
  )

  // Then update any provided fields (preserves existing data for null fields)
  const updates: string[] = []
  const params: SqlParams = []
  let paramIndex = 1

  if (tx.rawTx !== undefined) {
    updates.push(`raw_tx = $${paramIndex++}`)
    params.push(tx.rawTx)
  }
  if (tx.description !== undefined) {
    updates.push(`description = $${paramIndex++}`)
    params.push(tx.description)
  }
  if (tx.blockHeight !== undefined) {
    updates.push(`block_height = $${paramIndex++}`)
    params.push(tx.blockHeight)
  }
  if (tx.status !== undefined) {
    updates.push(`status = $${paramIndex++}`)
    params.push(tx.status)
  }
  if (tx.amount !== undefined) {
    updates.push(`amount = $${paramIndex++}`)
    params.push(tx.amount)
  }

  if (updates.length > 0) {
    params.push(tx.txid)
    await database.execute(
      `UPDATE transactions SET ${updates.join(', ')} WHERE txid = $${paramIndex}`,
      params
    )
  }

  // Add labels if provided
  if (tx.labels && tx.labels.length > 0) {
    for (const label of tx.labels) {
      await database.execute(
        'INSERT OR IGNORE INTO transaction_labels (txid, label) VALUES ($1, $2)',
        [tx.txid, label]
      )
    }
  }

  return tx.txid
}

/**
 * Get all transactions from database
 */
export async function getAllTransactions(limit = 30): Promise<Transaction[]> {
  const database = getDatabase()

  const rows = await database.select<TransactionRow[]>(
    `SELECT * FROM transactions ORDER BY block_height DESC, created_at DESC LIMIT $1`,
    [limit]
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
    blockHeight: row.block_height ?? undefined,
    status: row.status,
    amount: row.amount ?? undefined
  }))
}

/**
 * Update transaction amount
 */
export async function updateTransactionAmount(txid: string, amount: number): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE transactions SET amount = $1 WHERE txid = $2',
    [amount, txid]
  )
}

/**
 * Get transactions by label
 */
export async function getTransactionsByLabel(label: string): Promise<Transaction[]> {
  const database = getDatabase()

  const rows = await database.select<TransactionRow[]>(
    `SELECT t.* FROM transactions t
     INNER JOIN transaction_labels tl ON t.txid = tl.txid
     WHERE tl.label = $1
     ORDER BY t.created_at DESC`,
    [label]
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
    blockHeight: row.block_height ?? undefined,
    status: row.status
  }))
}

/**
 * Update transaction status
 */
export async function updateTransactionStatus(
  txid: string,
  status: 'pending' | 'confirmed' | 'failed',
  blockHeight?: number
): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE transactions SET status = $1, confirmed_at = $2, block_height = $3 WHERE txid = $4',
    [status, status === 'confirmed' ? Date.now() : null, blockHeight || null, txid]
  )
}
