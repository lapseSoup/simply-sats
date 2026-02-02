/**
 * Database Service for Simply Sats
 *
 * Provides persistent storage for UTXOs, transactions, baskets, and locks.
 * This is the foundation for true BRC-100 compliance - tracking UTXOs locally
 * instead of relying on external APIs.
 */

import Database from '@tauri-apps/plugin-sql'

// Database instance (singleton)
let db: Database | null = null

// UTXO type matching database schema
export interface UTXO {
  id?: number
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  basket: string
  spendable: boolean
  createdAt: number
  spentAt?: number
  spentTxid?: string
  tags?: string[]
}

// Transaction type
export interface Transaction {
  id?: number
  txid: string
  rawTx?: string
  description?: string
  createdAt: number
  confirmedAt?: number
  blockHeight?: number
  status: 'pending' | 'confirmed' | 'failed'
  labels?: string[]
}

// Lock type (for time-locked outputs)
export interface Lock {
  id?: number
  utxoId: number
  unlockBlock: number
  ordinalOrigin?: string
  createdAt: number
  unlockedAt?: number
}

// Basket type
export interface Basket {
  id?: number
  name: string
  description?: string
  createdAt: number
}

/**
 * Initialize database connection
 */
export async function initDatabase(): Promise<Database> {
  if (db) return db

  db = await Database.load('sqlite:simplysats.db')
  console.log('Database initialized')
  return db
}

/**
 * Get database instance (must call initDatabase first)
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

// ============================================
// UTXO Operations
// ============================================

/**
 * Add a new UTXO to the database
 */
export async function addUTXO(utxo: Omit<UTXO, 'id'>): Promise<number> {
  const database = getDatabase()

  const result = await database.execute(
    `INSERT INTO utxos (txid, vout, satoshis, locking_script, basket, spendable, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [utxo.txid, utxo.vout, utxo.satoshis, utxo.lockingScript, utxo.basket, utxo.spendable ? 1 : 0, utxo.createdAt]
  )

  const utxoId = result.lastInsertId as number

  // Add tags if provided
  if (utxo.tags && utxo.tags.length > 0) {
    for (const tag of utxo.tags) {
      await database.execute(
        'INSERT OR IGNORE INTO utxo_tags (utxo_id, tag) VALUES ($1, $2)',
        [utxoId, tag]
      )
    }
  }

  return utxoId
}

/**
 * Get UTXOs by basket
 */
export async function getUTXOsByBasket(basket: string, spendableOnly = true): Promise<UTXO[]> {
  const database = getDatabase()

  let query = 'SELECT * FROM utxos WHERE basket = $1'
  if (spendableOnly) {
    query += ' AND spendable = 1 AND spent_at IS NULL'
  }

  const rows = await database.select<any[]>(query, [basket])

  // Fetch tags for each UTXO
  const utxos: UTXO[] = []
  for (const row of rows) {
    const tags = await database.select<{tag: string}[]>(
      'SELECT tag FROM utxo_tags WHERE utxo_id = $1',
      [row.id]
    )

    utxos.push({
      id: row.id,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      lockingScript: row.locking_script,
      basket: row.basket,
      spendable: row.spendable === 1,
      createdAt: row.created_at,
      spentAt: row.spent_at,
      spentTxid: row.spent_txid,
      tags: tags.map(t => t.tag)
    })
  }

  return utxos
}

/**
 * Get all spendable UTXOs
 */
export async function getSpendableUTXOs(): Promise<UTXO[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>(
    'SELECT * FROM utxos WHERE spendable = 1 AND spent_at IS NULL'
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    vout: row.vout,
    satoshis: row.satoshis,
    lockingScript: row.locking_script,
    basket: row.basket,
    spendable: true,
    createdAt: row.created_at,
    tags: []
  }))
}

/**
 * Mark a UTXO as spent
 */
export async function markUTXOSpent(txid: string, vout: number, spentTxid: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE utxos SET spent_at = $1, spent_txid = $2 WHERE txid = $3 AND vout = $4',
    [Date.now(), spentTxid, txid, vout]
  )
}

/**
 * Get total balance from database
 */
export async function getBalanceFromDB(basket?: string): Promise<number> {
  const database = getDatabase()

  let query = 'SELECT SUM(satoshis) as total FROM utxos WHERE spendable = 1 AND spent_at IS NULL'
  const params: any[] = []

  if (basket) {
    query += ' AND basket = $1'
    params.push(basket)
  }

  const result = await database.select<{total: number}[]>(query, params)
  return result[0]?.total || 0
}

// ============================================
// Transaction Operations
// ============================================

/**
 * Add a new transaction
 */
export async function addTransaction(tx: Omit<Transaction, 'id'>): Promise<string> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO transactions (txid, raw_tx, description, created_at, confirmed_at, block_height, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status]
  )

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

  const rows = await database.select<any[]>(
    `SELECT * FROM transactions ORDER BY block_height DESC, created_at DESC LIMIT $1`,
    [limit]
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx,
    description: row.description,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    blockHeight: row.block_height,
    status: row.status
  }))
}

/**
 * Get transactions by label
 */
export async function getTransactionsByLabel(label: string): Promise<Transaction[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>(
    `SELECT t.* FROM transactions t
     INNER JOIN transaction_labels tl ON t.txid = tl.txid
     WHERE tl.label = $1
     ORDER BY t.created_at DESC`,
    [label]
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx,
    description: row.description,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    blockHeight: row.block_height,
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

// ============================================
// Lock Operations
// ============================================

/**
 * Add a time-locked output
 */
export async function addLock(lock: Omit<Lock, 'id'>): Promise<number> {
  const database = getDatabase()

  const result = await database.execute(
    `INSERT INTO locks (utxo_id, unlock_block, ordinal_origin, created_at)
     VALUES ($1, $2, $3, $4)`,
    [lock.utxoId, lock.unlockBlock, lock.ordinalOrigin || null, lock.createdAt]
  )

  return result.lastInsertId as number
}

/**
 * Get all locks with UTXO details
 */
export async function getLocks(currentHeight: number): Promise<(Lock & { utxo: UTXO })[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>(
    `SELECT l.*, u.txid, u.vout, u.satoshis, u.locking_script, u.basket
     FROM locks l
     INNER JOIN utxos u ON l.utxo_id = u.id
     WHERE l.unlocked_at IS NULL
     ORDER BY l.unlock_block ASC`
  )

  return rows.map(row => ({
    id: row.id,
    utxoId: row.utxo_id,
    unlockBlock: row.unlock_block,
    ordinalOrigin: row.ordinal_origin,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at,
    utxo: {
      id: row.utxo_id,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      lockingScript: row.locking_script,
      basket: row.basket,
      spendable: currentHeight >= row.unlock_block,
      createdAt: row.created_at,
      tags: []
    }
  }))
}

/**
 * Mark a lock as unlocked
 */
export async function markLockUnlocked(lockId: number): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE locks SET unlocked_at = $1 WHERE id = $2',
    [Date.now(), lockId]
  )
}

// ============================================
// Sync Operations
// ============================================

/**
 * Get last synced height for an address
 */
export async function getLastSyncedHeight(address: string): Promise<number> {
  const database = getDatabase()

  const result = await database.select<{last_synced_height: number}[]>(
    'SELECT last_synced_height FROM sync_state WHERE address = $1',
    [address]
  )

  return result[0]?.last_synced_height || 0
}

/**
 * Update sync state for an address
 */
export async function updateSyncState(address: string, height: number): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO sync_state (address, last_synced_height, last_synced_at)
     VALUES ($1, $2, $3)`,
    [address, height, Date.now()]
  )
}

// ============================================
// Basket Operations
// ============================================

/**
 * Get all baskets
 */
export async function getBaskets(): Promise<Basket[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>('SELECT * FROM baskets ORDER BY name')

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at
  }))
}

/**
 * Create a new basket
 */
export async function createBasket(name: string, description?: string): Promise<number> {
  const database = getDatabase()

  const result = await database.execute(
    'INSERT INTO baskets (name, description, created_at) VALUES ($1, $2, $3)',
    [name, description || null, Date.now()]
  )

  return result.lastInsertId as number
}

// ============================================
// Database Export/Import
// ============================================

export interface DatabaseBackup {
  version: number
  exportedAt: number
  utxos: UTXO[]
  transactions: Transaction[]
  locks: Lock[]
  baskets: Basket[]
  syncState: { address: string; height: number; syncedAt: number }[]
}

/**
 * Export entire database as JSON
 */
export async function exportDatabase(): Promise<DatabaseBackup> {
  const database = getDatabase()

  // Get all UTXOs
  const utxoRows = await database.select<any[]>('SELECT * FROM utxos')
  const utxos: UTXO[] = []
  for (const row of utxoRows) {
    const tags = await database.select<{tag: string}[]>(
      'SELECT tag FROM utxo_tags WHERE utxo_id = $1',
      [row.id]
    )
    utxos.push({
      id: row.id,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      lockingScript: row.locking_script,
      basket: row.basket,
      spendable: row.spendable === 1,
      createdAt: row.created_at,
      spentAt: row.spent_at,
      spentTxid: row.spent_txid,
      tags: tags.map(t => t.tag)
    })
  }

  // Get all transactions
  const txRows = await database.select<any[]>('SELECT * FROM transactions')
  const transactions: Transaction[] = txRows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx,
    description: row.description,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    blockHeight: row.block_height,
    status: row.status
  }))

  // Get all locks
  const lockRows = await database.select<any[]>('SELECT * FROM locks')
  const locks: Lock[] = lockRows.map(row => ({
    id: row.id,
    utxoId: row.utxo_id,
    unlockBlock: row.unlock_block,
    ordinalOrigin: row.ordinal_origin,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at
  }))

  // Get all baskets
  const basketRows = await database.select<any[]>('SELECT * FROM baskets')
  const baskets: Basket[] = basketRows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at
  }))

  // Get sync state
  const syncRows = await database.select<any[]>('SELECT * FROM sync_state')
  const syncState = syncRows.map(row => ({
    address: row.address,
    height: row.last_synced_height,
    syncedAt: row.last_synced_at
  }))

  return {
    version: 1,
    exportedAt: Date.now(),
    utxos,
    transactions,
    locks,
    baskets,
    syncState
  }
}

/**
 * Import database from backup JSON
 */
export async function importDatabase(backup: DatabaseBackup): Promise<void> {
  const database = getDatabase()

  // Clear existing data
  await database.execute('DELETE FROM utxo_tags')
  await database.execute('DELETE FROM transaction_labels')
  await database.execute('DELETE FROM locks')
  await database.execute('DELETE FROM utxos')
  await database.execute('DELETE FROM transactions')
  await database.execute('DELETE FROM baskets')
  await database.execute('DELETE FROM sync_state')

  // Import baskets
  for (const basket of backup.baskets) {
    await database.execute(
      'INSERT INTO baskets (id, name, description, created_at) VALUES ($1, $2, $3, $4)',
      [basket.id, basket.name, basket.description || null, basket.createdAt]
    )
  }

  // Import UTXOs
  for (const utxo of backup.utxos) {
    await database.execute(
      `INSERT INTO utxos (id, txid, vout, satoshis, locking_script, basket, spendable, created_at, spent_at, spent_txid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [utxo.id, utxo.txid, utxo.vout, utxo.satoshis, utxo.lockingScript, utxo.basket, utxo.spendable ? 1 : 0, utxo.createdAt, utxo.spentAt || null, utxo.spentTxid || null]
    )
    // Import tags
    if (utxo.tags && utxo.tags.length > 0) {
      for (const tag of utxo.tags) {
        await database.execute(
          'INSERT INTO utxo_tags (utxo_id, tag) VALUES ($1, $2)',
          [utxo.id, tag]
        )
      }
    }
  }

  // Import transactions
  for (const tx of backup.transactions) {
    await database.execute(
      `INSERT INTO transactions (id, txid, raw_tx, description, created_at, confirmed_at, block_height, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tx.id, tx.txid, tx.rawTx || null, tx.description || null, tx.createdAt, tx.confirmedAt || null, tx.blockHeight || null, tx.status]
    )
  }

  // Import locks
  for (const lock of backup.locks) {
    await database.execute(
      `INSERT INTO locks (id, utxo_id, unlock_block, ordinal_origin, created_at, unlocked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [lock.id, lock.utxoId, lock.unlockBlock, lock.ordinalOrigin || null, lock.createdAt, lock.unlockedAt || null]
    )
  }

  // Import sync state
  for (const sync of backup.syncState) {
    await database.execute(
      'INSERT INTO sync_state (address, last_synced_height, last_synced_at) VALUES ($1, $2, $3)',
      [sync.address, sync.height, sync.syncedAt]
    )
  }

  console.log('Database import complete')
}
