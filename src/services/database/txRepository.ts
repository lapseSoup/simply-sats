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
 * @param tx - Transaction data
 * @param accountId - Account ID (defaults to 1 for backwards compat)
 */
export async function addTransaction(tx: Omit<Transaction, 'id'>, accountId?: number): Promise<string> {
  const database = getDatabase()
  const accId = accountId ?? 1

  // Use INSERT OR IGNORE to not overwrite existing transactions
  await database.execute(
    `INSERT OR IGNORE INTO transactions (txid, raw_tx, description, created_at, confirmed_at, block_height, status, amount, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status, tx.amount ?? null, accId]
  )

  // If amount was provided and row already existed, update the amount
  // Fixes NULL amounts AND incorrect 0 amounts (from rate-limited API calls during restore)
  // Scope by account_id to avoid updating other accounts' rows for the same txid
  if (tx.amount !== undefined) {
    await database.execute(
      'UPDATE transactions SET amount = $1 WHERE txid = $2 AND account_id = $3 AND (amount IS NULL OR (amount = 0 AND $1 != 0))',
      [tx.amount, tx.txid, accId]
    )
  }

  // Update block_height and status when a pending tx gets confirmed
  if (tx.blockHeight && tx.status === 'confirmed') {
    await database.execute(
      `UPDATE transactions SET block_height = $1, status = 'confirmed'
       WHERE txid = $2 AND account_id = $3 AND (block_height IS NULL OR status = 'pending')`,
      [tx.blockHeight, tx.txid, accId]
    )
  }

  // Add labels if provided (scoped by account_id)
  if (tx.labels && tx.labels.length > 0) {
    for (const label of tx.labels) {
      await database.execute(
        'INSERT OR IGNORE INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
        [tx.txid, label, accId]
      )
    }
  }

  return tx.txid
}

/**
 * Add or update a transaction (will update fields if exists)
 * @param tx - Transaction data
 * @param accountId - Account ID (defaults to 1 for backwards compat)
 */
export async function upsertTransaction(tx: Omit<Transaction, 'id'>, accountId?: number): Promise<string> {
  const database = getDatabase()
  const accId = accountId ?? 1

  // First try to insert
  await database.execute(
    `INSERT OR IGNORE INTO transactions (txid, raw_tx, description, created_at, confirmed_at, block_height, status, amount, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status, tx.amount ?? null, accId]
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
    paramIndex++
    params.push(accId)
    await database.execute(
      `UPDATE transactions SET ${updates.join(', ')} WHERE txid = $${paramIndex - 1} AND account_id = $${paramIndex}`,
      params
    )
  }

  // Add labels if provided (scoped by account_id)
  if (tx.labels && tx.labels.length > 0) {
    for (const label of tx.labels) {
      await database.execute(
        'INSERT OR IGNORE INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
        [tx.txid, label, accId]
      )
    }
  }

  return tx.txid
}

/**
 * Get all transactions from database for a specific account
 * Orders pending (unconfirmed) transactions first, then by block height descending
 * @param limit - Maximum number of transactions to return
 * @param accountId - Account ID to filter by (optional)
 */
export async function getAllTransactions(limit = 30, accountId?: number): Promise<Transaction[]> {
  const database = getDatabase()

  let query = `SELECT * FROM transactions`
  const params: SqlParams = []
  let paramIndex = 1

  // Filter by account ID if provided (check for both undefined AND null)
  if (accountId !== undefined && accountId !== null) {
    query += ` WHERE account_id = $${paramIndex++}`
    params.push(accountId)
  }

  query += ` ORDER BY
       CASE WHEN block_height IS NULL THEN 0 ELSE 1 END,
       block_height DESC,
       created_at DESC
     LIMIT $${paramIndex}`
  params.push(limit)

  // Order: pending transactions first (NULL block_height), then confirmed by height DESC
  const rows = await database.select<TransactionRow[]>(query, params)

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
 * @param txid - Transaction ID
 * @param amount - Amount in satoshis
 * @param accountId - Account ID to scope update (defaults to 1)
 */
export async function updateTransactionAmount(txid: string, amount: number, accountId?: number): Promise<void> {
  const database = getDatabase()
  const accId = accountId ?? 1

  await database.execute(
    'UPDATE transactions SET amount = $1 WHERE txid = $2 AND account_id = $3',
    [amount, txid, accId]
  )
}

/**
 * Get transactions by label
 */
export async function getTransactionsByLabel(label: string, accountId?: number): Promise<Transaction[]> {
  const database = getDatabase()

  const query = accountId !== undefined && accountId !== null
    ? `SELECT t.* FROM transactions t
       INNER JOIN transaction_labels tl ON t.txid = tl.txid AND tl.account_id = t.account_id
       WHERE tl.label = $1 AND t.account_id = $2
       ORDER BY t.created_at DESC`
    : `SELECT t.* FROM transactions t
       INNER JOIN transaction_labels tl ON t.txid = tl.txid
       WHERE tl.label = $1
       ORDER BY t.created_at DESC`

  const params = accountId !== undefined && accountId !== null
    ? [label, accountId]
    : [label]

  const rows = await database.select<TransactionRow[]>(query, params)

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
 * @param txid - Transaction ID
 * @param status - New status
 * @param blockHeight - Block height (for confirmed)
 * @param accountId - Account ID to scope update (defaults to 1)
 */
export async function updateTransactionStatus(
  txid: string,
  status: 'pending' | 'confirmed' | 'failed',
  blockHeight?: number,
  accountId?: number
): Promise<void> {
  const database = getDatabase()
  const accId = accountId ?? 1

  await database.execute(
    'UPDATE transactions SET status = $1, confirmed_at = $2, block_height = $3 WHERE txid = $4 AND account_id = $5',
    [status, status === 'confirmed' ? Date.now() : null, blockHeight || null, txid, accId]
  )
}

/**
 * Update labels for a transaction (replaces existing labels)
 * @param txid - Transaction ID
 * @param labels - New labels to set
 * @param accountId - If provided, validates txid belongs to this account before modifying
 */
export async function updateTransactionLabels(
  txid: string,
  labels: string[],
  accountId?: number
): Promise<void> {
  const database = getDatabase()

  const accId = accountId ?? 1

  // Verify the txid belongs to this account
  const rows = await database.select<{ txid: string }[]>(
    'SELECT txid FROM transactions WHERE txid = $1 AND account_id = $2 LIMIT 1',
    [txid, accId]
  )
  if (rows.length === 0) return // txid doesn't belong to this account — no-op

  // Delete existing labels for this txid AND account_id (scoped — won't touch other accounts)
  await database.execute(
    'DELETE FROM transaction_labels WHERE txid = $1 AND account_id = $2',
    [txid, accId]
  )

  // Insert new labels (scoped by account_id)
  for (const label of labels) {
    if (label.trim()) {
      await database.execute(
        'INSERT INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
        [txid, label.trim(), accId]
      )
    }
  }
}

/**
 * Get all distinct labels for an account (for autosuggest)
 */
export async function getAllLabels(accountId?: number): Promise<string[]> {
  const database = getDatabase()

  const rows = await database.select<{ label: string }[]>(
    accountId
      ? `SELECT DISTINCT label FROM transaction_labels
         WHERE account_id = $1
         ORDER BY label ASC`
      : `SELECT DISTINCT label FROM transaction_labels ORDER BY label ASC`,
    accountId ? [accountId] : []
  )

  return rows.map(row => row.label)
}

/**
 * Get the most frequently used labels (by count of transactions), excluding system labels
 */
export async function getTopLabels(limit = 3, accountId?: number): Promise<string[]> {
  const database = getDatabase()
  const systemLabels = ['lock', 'unlock']
  const placeholders = systemLabels.map((_, i) => `$${i + 1}`).join(', ')

  const rows = await database.select<{ label: string }[]>(
    accountId !== undefined && accountId !== null
      ? `SELECT label, COUNT(*) as cnt FROM transaction_labels
         WHERE label NOT IN (${placeholders}) AND account_id = $${systemLabels.length + 1}
         GROUP BY label ORDER BY cnt DESC LIMIT $${systemLabels.length + 2}`
      : `SELECT label, COUNT(*) as cnt FROM transaction_labels
         WHERE label NOT IN (${placeholders})
         GROUP BY label ORDER BY cnt DESC LIMIT $${systemLabels.length + 1}`,
    accountId !== undefined && accountId !== null
      ? [...systemLabels, accountId, limit]
      : [...systemLabels, limit]
  )

  return rows.map(row => row.label)
}

/**
 * Get labels for a specific transaction
 * @param txid - Transaction ID
 * @param accountId - If provided, only returns labels for txids owned by this account
 */
export async function getTransactionLabels(txid: string, accountId?: number): Promise<string[]> {
  const database = getDatabase()

  const rows = await database.select<{ label: string }[]>(
    accountId !== undefined && accountId !== null
      ? `SELECT label FROM transaction_labels
         WHERE txid = $1 AND account_id = $2`
      : 'SELECT label FROM transaction_labels WHERE txid = $1',
    accountId !== undefined && accountId !== null ? [txid, accountId] : [txid]
  )

  return rows.map(row => row.label)
}

/**
 * Get a single transaction by txid (always scoped to account)
 * @param txid - Transaction ID
 * @param accountId - Account ID (required — no cross-account queries)
 */
export async function getTransactionByTxid(txid: string, accountId: number): Promise<Transaction | null> {
  const database = getDatabase()

  const rows = await database.select<TransactionRow[]>(
    'SELECT * FROM transactions WHERE txid = $1 AND account_id = $2 LIMIT 1',
    [txid, accountId]
  )

  if (rows.length === 0) return null

  const row = rows[0]!
  return {
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
    blockHeight: row.block_height ?? undefined,
    status: row.status as 'pending' | 'confirmed' | 'failed',
    amount: row.amount ?? undefined
  }
}

/**
 * Search transactions that have ALL of the given labels (AND logic)
 * Uses dynamic INNER JOINs so a tx must have every label to match.
 * Optional freeText filters additionally on txid/description.
 */
export async function searchTransactionsByLabels(
  labels: string[],
  freeText?: string,
  accountId?: number,
  limit: number = 50
): Promise<Transaction[]> {
  const database = getDatabase()
  const params: SqlParams = []
  let paramIndex = 1

  // Build FROM clause with one INNER JOIN per label
  let fromClause = 'FROM transactions t'
  const whereConditions: string[] = []

  for (let i = 0; i < labels.length; i++) {
    const alias = `tl${i}`
    fromClause += ` INNER JOIN transaction_labels ${alias} ON t.txid = ${alias}.txid AND ${alias}.account_id = t.account_id`
    whereConditions.push(`${alias}.label = $${paramIndex++}`)
    params.push(labels[i]!)
  }

  if (accountId) {
    whereConditions.push(`t.account_id = $${paramIndex++}`)
    params.push(accountId)
  }

  if (freeText && freeText.trim()) {
    const searchTerm = `%${freeText.trim()}%`
    whereConditions.push(`(t.txid LIKE $${paramIndex} OR t.description LIKE $${paramIndex})`)
    paramIndex++
    params.push(searchTerm)
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : ''

  params.push(limit)
  const query = `SELECT DISTINCT t.id, t.txid, t.raw_tx, t.description, t.created_at, t.confirmed_at,
          t.block_height, t.status, t.amount, t.account_id
   ${fromClause}
   ${whereClause}
   ORDER BY t.created_at DESC
   LIMIT $${paramIndex}`

  const rows = await database.select<TransactionRow[]>(query, params)

  return rows.map(row => ({
    txid: row.txid,
    rawTx: row.raw_tx || undefined,
    description: row.description || undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || undefined,
    blockHeight: row.block_height || undefined,
    status: row.status as 'pending' | 'confirmed' | 'failed',
    amount: row.amount || undefined
  }))
}

/**
 * Search transactions by txid or label (partial match)
 */
export async function searchTransactions(
  query: string,
  accountId?: number,
  limit: number = 50
): Promise<Transaction[]> {
  const database = getDatabase()
  const searchTerm = `%${query}%`

  const rows = await database.select<TransactionRow[]>(
    `SELECT DISTINCT t.id, t.txid, t.raw_tx, t.description, t.created_at, t.confirmed_at,
            t.block_height, t.status, t.amount, t.account_id
     FROM transactions t
     LEFT JOIN transaction_labels tl ON t.txid = tl.txid AND tl.account_id = t.account_id
     WHERE ${accountId ? 't.account_id = $1 AND' : ''} (t.txid LIKE ${accountId ? '$2' : '$1'} OR tl.label LIKE ${accountId ? '$2' : '$1'} OR t.description LIKE ${accountId ? '$2' : '$1'})
     ORDER BY t.created_at DESC
     LIMIT ${accountId ? '$3' : '$2'}`,
    accountId ? [accountId, searchTerm, limit] : [searchTerm, limit]
  )

  return rows.map(row => ({
    txid: row.txid,
    rawTx: row.raw_tx || undefined,
    description: row.description || undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at || undefined,
    blockHeight: row.block_height || undefined,
    status: row.status as 'pending' | 'confirmed' | 'failed',
    amount: row.amount || undefined
  }))
}

/**
 * Get txids of all pending (unconfirmed) transactions for an account
 * Used by sync to protect change UTXOs from recently broadcast transactions
 */
export async function getPendingTransactionTxids(accountId?: number): Promise<Set<string>> {
  const database = getDatabase()

  let query = "SELECT txid FROM transactions WHERE status = 'pending'"
  const params: SqlParams = []

  if (accountId !== undefined) {
    query += ' AND account_id = $1'
    params.push(accountId)
  }

  const rows = await database.select<{ txid: string }[]>(query, params)
  return new Set(rows.map(r => r.txid))
}

/**
 * Delete all transactions and their labels for a specific account.
 * Used for data cleanup — the sync process will rebuild correct data.
 * @param accountId - Account ID whose transactions to delete
 */
export async function deleteTransactionsForAccount(accountId: number): Promise<number> {
  const database = getDatabase()

  // Delete labels for this account directly (account_id column now exists on transaction_labels)
  await database.execute(
    'DELETE FROM transaction_labels WHERE account_id = $1',
    [accountId]
  )

  // Delete the transactions themselves
  await database.execute(
    'DELETE FROM transactions WHERE account_id = $1',
    [accountId]
  )

  // Return isn't available from execute, but caller can verify via getAllTransactions
  return 0
}
