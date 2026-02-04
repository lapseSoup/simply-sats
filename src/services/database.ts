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
  address?: string  // The address this UTXO belongs to (optional for backwards compat)
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
  amount?: number  // Net satoshis: positive = received, negative = sent
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

/**
 * Execute multiple database operations within a transaction
 * If any operation fails, all changes are rolled back
 */
export async function withTransaction<T>(
  operations: () => Promise<T>
): Promise<T> {
  const database = getDatabase()

  try {
    await database.execute('BEGIN TRANSACTION')
    const result = await operations()
    await database.execute('COMMIT')
    return result
  } catch (error) {
    await database.execute('ROLLBACK')
    throw error
  }
}

// ============================================
// UTXO Operations
// ============================================

/**
 * Ensure the address column exists (migration)
 */
async function ensureAddressColumn(): Promise<void> {
  const database = getDatabase()
  try {
    // Check if column exists by trying to select it
    await database.select<any[]>('SELECT address FROM utxos LIMIT 1')
  } catch {
    // Column doesn't exist, add it
    console.log('[DB] Adding address column to utxos table...')
    await database.execute('ALTER TABLE utxos ADD COLUMN address TEXT')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address)')
  }
}

/**
 * Add a new UTXO to the database
 *
 * RULES:
 * 1. If UTXO doesn't exist, INSERT it
 * 2. If UTXO exists with 'derived' basket, keep 'derived' (it has correct key info)
 * 3. If adding as 'derived' and existing is not, UPGRADE to 'derived'
 * 4. ALWAYS ensure spendable=1 for regular UTXOs (not locks)
 * 5. ALWAYS update address/locking_script when upgrading to derived
 */
export async function addUTXO(utxo: Omit<UTXO, 'id'>): Promise<number> {
  const database = getDatabase()

  // Ensure migration is done
  await ensureAddressColumn()

  // Check if UTXO already exists - get ALL relevant fields
  const existing = await database.select<any[]>(
    'SELECT id, basket, address, spendable, spent_at FROM utxos WHERE txid = $1 AND vout = $2',
    [utxo.txid, utxo.vout]
  )

  if (existing.length > 0) {
    const ex = existing[0]
    const spendableValue = utxo.spendable ? 1 : 0

    // CRITICAL: If we're re-syncing a UTXO that exists on-chain, it's NOT spent!
    // Always clear spent_at and ensure spendable is correct when adding a UTXO
    // that was found on the blockchain

    // Case 1: Existing is 'derived' - keep derived, but ensure it's spendable and not marked spent
    if (ex.basket === 'derived') {
      // Always ensure spendable=1 and spent_at=NULL for UTXOs found on chain
      if (!ex.address || ex.spendable !== spendableValue || ex.spent_at !== null) {
        console.log(`[DB] Updating derived UTXO ${utxo.txid.slice(0,8)}:${utxo.vout} - clearing spent_at, spendable=${spendableValue}`)
        await database.execute(
          'UPDATE utxos SET address = COALESCE($1, address), spendable = $2, spent_at = NULL WHERE id = $3',
          [utxo.address, spendableValue, ex.id]
        )
      }
      return ex.id
    }

    // Case 2: New is 'derived', existing is not - UPGRADE to derived
    if (utxo.basket === 'derived') {
      console.log(`[DB] Upgrading ${utxo.txid.slice(0,8)}:${utxo.vout} to derived, spendable=${spendableValue}`)
      await database.execute(
        'UPDATE utxos SET basket = $1, address = $2, locking_script = $3, spendable = $4, spent_at = NULL WHERE id = $5',
        ['derived', utxo.address, utxo.lockingScript, spendableValue, ex.id]
      )
      return ex.id
    }

    // Case 3: Same or compatible basket - update address if needed, ensure spendable and not spent
    if (!ex.address || ex.spendable !== spendableValue || ex.spent_at !== null) {
      await database.execute(
        'UPDATE utxos SET address = COALESCE($1, address), spendable = $2, spent_at = NULL WHERE id = $3',
        [utxo.address, spendableValue, ex.id]
      )
    }
    return ex.id
  }

  // UTXO doesn't exist - INSERT it
  console.log(`[DB] INSERT: ${utxo.txid.slice(0,8)}:${utxo.vout} ${utxo.satoshis}sats basket=${utxo.basket} spendable=${utxo.spendable}`)
  const result = await database.execute(
    `INSERT INTO utxos (txid, vout, satoshis, locking_script, address, basket, spendable, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [utxo.txid, utxo.vout, utxo.satoshis, utxo.lockingScript, utxo.address, utxo.basket, utxo.spendable ? 1 : 0, utxo.createdAt]
  )

  const utxoId = result.lastInsertId as number
  console.log(`[DB] INSERT OK: id=${utxoId}`)

  // Verify the insert by reading it back
  const verify = await database.select<any[]>('SELECT id, basket, spendable FROM utxos WHERE id = $1', [utxoId])
  console.log(`[DB] VERIFY: id=${verify[0]?.id} basket=${verify[0]?.basket} spendable=${verify[0]?.spendable}`)

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
 * When spendableOnly is true, excludes pending UTXOs to prevent race conditions
 */
export async function getUTXOsByBasket(basket: string, spendableOnly = true): Promise<UTXO[]> {
  const database = getDatabase()

  let query = 'SELECT * FROM utxos WHERE basket = $1'
  if (spendableOnly) {
    query += " AND spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
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
      address: row.address || '',
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
 * Get all spendable UTXOs across all baskets
 * Excludes UTXOs that are pending (being spent) to prevent race conditions
 */
export async function getSpendableUTXOs(): Promise<UTXO[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>(
    "SELECT * FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    vout: row.vout,
    satoshis: row.satoshis,
    lockingScript: row.locking_script,
    address: row.address || '',
    basket: row.basket,
    spendable: true,
    createdAt: row.created_at,
    tags: []
  }))
}

/**
 * Get spendable UTXOs for a specific address
 * Excludes UTXOs that are pending (being spent) to prevent race conditions
 */
export async function getSpendableUTXOsByAddress(address: string): Promise<UTXO[]> {
  const database = getDatabase()

  const rows = await database.select<any[]>(
    "SELECT * FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent') AND address = $1",
    [address]
  )

  return rows.map(row => ({
    id: row.id,
    txid: row.txid,
    vout: row.vout,
    satoshis: row.satoshis,
    lockingScript: row.locking_script,
    address: row.address || '',
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
    'UPDATE utxos SET spent_at = $1, spent_txid = $2, spending_status = $3 WHERE txid = $4 AND vout = $5',
    [Date.now(), spentTxid, 'spent', txid, vout]
  )
}

// ============================================
// Pending Spend Operations (Race Condition Prevention)
// ============================================

/**
 * Ensure the spending_status column exists (migration)
 */
async function ensureSpendingStatusColumn(): Promise<void> {
  const database = getDatabase()
  try {
    // Check if column exists by trying to select it
    await database.select<any[]>('SELECT spending_status FROM utxos LIMIT 1')
  } catch {
    // Column doesn't exist, add it
    console.log('[DB] Adding spending_status columns to utxos table...')
    await database.execute("ALTER TABLE utxos ADD COLUMN spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent'))")
    await database.execute('ALTER TABLE utxos ADD COLUMN pending_spending_txid TEXT')
    await database.execute('ALTER TABLE utxos ADD COLUMN pending_since INTEGER')
    await database.execute("CREATE INDEX IF NOT EXISTS idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending'")
  }
}

/**
 * Mark UTXOs as pending spend (BEFORE broadcast)
 * This prevents race conditions where a crash after broadcast but before
 * marking as spent could cause double-spend attempts.
 */
export async function markUtxosPendingSpend(
  utxos: Array<{ txid: string; vout: number }>,
  pendingTxid: string
): Promise<void> {
  await ensureSpendingStatusColumn()
  const database = getDatabase()

  for (const utxo of utxos) {
    await database.execute(
      `UPDATE utxos
       SET spending_status = 'pending',
           pending_spending_txid = $1,
           pending_since = $2
       WHERE txid = $3 AND vout = $4 AND (spending_status = 'unspent' OR spending_status IS NULL)`,
      [pendingTxid, Date.now(), utxo.txid, utxo.vout]
    )
  }
}

/**
 * Confirm UTXOs as spent (AFTER successful broadcast)
 */
export async function confirmUtxosSpent(
  utxos: Array<{ txid: string; vout: number }>,
  spendingTxid: string
): Promise<void> {
  const database = getDatabase()

  for (const utxo of utxos) {
    await database.execute(
      `UPDATE utxos
       SET spending_status = 'spent',
           spent_at = $1,
           spent_txid = $2,
           pending_spending_txid = NULL,
           pending_since = NULL
       WHERE txid = $3 AND vout = $4`,
      [Date.now(), spendingTxid, utxo.txid, utxo.vout]
    )
  }
}

/**
 * Rollback pending spend (if broadcast FAILS)
 */
export async function rollbackPendingSpend(
  utxos: Array<{ txid: string; vout: number }>
): Promise<void> {
  const database = getDatabase()

  for (const utxo of utxos) {
    await database.execute(
      `UPDATE utxos
       SET spending_status = 'unspent',
           pending_spending_txid = NULL,
           pending_since = NULL
       WHERE txid = $1 AND vout = $2 AND spending_status = 'pending'`,
      [utxo.txid, utxo.vout]
    )
  }
}

/**
 * Get UTXOs that are stuck in pending state (for recovery)
 * UTXOs pending for more than the specified timeout are considered stuck.
 */
export async function getPendingUtxos(timeoutMs: number = 300000): Promise<Array<{
  txid: string
  vout: number
  satoshis: number
  pendingTxid: string
  pendingSince: number
}>> {
  await ensureSpendingStatusColumn()
  const database = getDatabase()

  const cutoff = Date.now() - timeoutMs
  const rows = await database.select<any[]>(
    `SELECT txid, vout, satoshis, pending_spending_txid, pending_since
     FROM utxos
     WHERE spending_status = 'pending' AND pending_since < $1`,
    [cutoff]
  )

  return rows.map(row => ({
    txid: row.txid,
    vout: row.vout,
    satoshis: row.satoshis,
    pendingTxid: row.pending_spending_txid,
    pendingSince: row.pending_since
  }))
}

/**
 * Get total balance from database
 * Excludes UTXOs that are pending (being spent) to prevent double-counting
 */
export async function getBalanceFromDB(basket?: string): Promise<number> {
  const database = getDatabase()

  let query = "SELECT SUM(satoshis) as total FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
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
  const params: any[] = []
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
    status: row.status,
    amount: row.amount
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
    `SELECT l.*, u.txid, u.vout, u.satoshis, u.locking_script, u.basket, u.address
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
      address: row.address,
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

/**
 * Mark a lock as unlocked by its UTXO txid and vout
 */
export async function markLockUnlockedByTxid(txid: string, vout: number): Promise<void> {
  const database = getDatabase()

  // Find the lock by joining with utxos table
  await database.execute(
    `UPDATE locks SET unlocked_at = $1
     WHERE utxo_id IN (SELECT id FROM utxos WHERE txid = $2 AND vout = $3)
     AND unlocked_at IS NULL`,
    [Date.now(), txid, vout]
  )
  console.log(`[DB] Marked lock as unlocked: ${txid}:${vout}`)
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
  derivedAddresses?: DerivedAddress[]  // Added in version 2
  contacts?: Contact[]  // Added in version 3
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
      address: row.address,
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

  // Get derived addresses
  const derivedAddresses = await getDerivedAddresses()

  // Get contacts
  const contacts = await getContacts()

  return {
    version: 3,  // Updated to include contacts
    exportedAt: Date.now(),
    utxos,
    transactions,
    locks,
    baskets,
    syncState,
    derivedAddresses,
    contacts
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

  // Import derived addresses (if present - version 2+)
  if (backup.derivedAddresses && backup.derivedAddresses.length > 0) {
    await ensureDerivedAddressesTable()
    for (const derived of backup.derivedAddresses) {
      await database.execute(
        `INSERT OR REPLACE INTO derived_addresses (address, sender_pubkey, invoice_number, private_key_wif, label, created_at, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [derived.address, derived.senderPubkey, derived.invoiceNumber, derived.privateKeyWif, derived.label || null, derived.createdAt, derived.lastSyncedAt || null]
      )
    }
    console.log('Imported', backup.derivedAddresses.length, 'derived addresses')
  }

  // Import contacts (if present - version 3+)
  if (backup.contacts && backup.contacts.length > 0) {
    await ensureContactsTable()
    for (const contact of backup.contacts) {
      await database.execute(
        `INSERT OR REPLACE INTO contacts (pubkey, label, created_at)
         VALUES ($1, $2, $3)`,
        [contact.pubkey, contact.label, contact.createdAt]
      )
    }
    console.log('Imported', backup.contacts.length, 'contacts')
  }

  console.log('Database import complete')
}

/**
 * Clear all data from database (for new wallet creation)
 */
export async function clearDatabase(): Promise<void> {
  const database = getDatabase()

  await database.execute('DELETE FROM utxo_tags')
  await database.execute('DELETE FROM transaction_labels')
  await database.execute('DELETE FROM locks')
  await database.execute('DELETE FROM utxos')
  await database.execute('DELETE FROM transactions')
  await database.execute('DELETE FROM baskets')
  await database.execute('DELETE FROM sync_state')
  // Also clear derived addresses
  try {
    await database.execute('DELETE FROM derived_addresses')
  } catch (_e) {
    // Table may not exist yet
  }

  // Also clear contacts
  try {
    await database.execute('DELETE FROM contacts')
  } catch (_e) {
    // Table may not exist yet
  }

  console.log('Database cleared')
}

/**
 * Clear UTXOs and sync state only (keeps derived addresses, contacts, transactions)
 * Use this to force a fresh resync from blockchain
 */
export async function resetUTXOs(): Promise<void> {
  const database = getDatabase()

  console.log('[DB] Resetting UTXOs and sync state...')
  await database.execute('DELETE FROM utxo_tags')
  await database.execute('DELETE FROM locks')
  await database.execute('DELETE FROM utxos')
  await database.execute('DELETE FROM sync_state')

  console.log('[DB] UTXOs reset complete - ready for fresh sync')
}

/**
 * Repair UTXOs - fix any broken spendable flags
 * Call this to fix UTXOs that should be spendable but aren't
 */
export async function repairUTXOs(): Promise<number> {
  const database = getDatabase()

  // Find UTXOs that are not in the locks basket but have spendable=0 and no spent_at
  // These are likely broken from previous bugs
  const result = await database.execute(
    `UPDATE utxos SET spendable = 1
     WHERE spendable = 0
     AND spent_at IS NULL
     AND basket != 'locks'`
  )

  const fixed = result.rowsAffected || 0
  if (fixed > 0) {
    console.log(`[DB] Repaired ${fixed} UTXOs - set spendable=1`)
  }

  return fixed
}

// ============================================
// Derived Addresses (BRC-42/43)
// ============================================

// Derived address type
export interface DerivedAddress {
  id?: number
  address: string
  senderPubkey: string
  invoiceNumber: string
  privateKeyWif: string
  label?: string
  createdAt: number
  lastSyncedAt?: number
}

/**
 * Run derived_addresses migration if table doesn't exist
 */
export async function ensureDerivedAddressesTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS derived_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL UNIQUE,
        sender_pubkey TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        private_key_wif TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        UNIQUE(sender_pubkey, invoice_number)
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_derived_addresses_address ON derived_addresses(address)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_derived_addresses_sender ON derived_addresses(sender_pubkey)')

    // Also ensure 'derived' basket exists
    await database.execute(
      "INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES ('derived', 'Received via derived addresses (BRC-42/43)', $1)",
      [Date.now()]
    )
  } catch (e) {
    console.error('Failed to ensure derived_addresses table:', e)
  }
}

/**
 * Add a derived address to track
 */
export async function addDerivedAddress(derivedAddr: Omit<DerivedAddress, 'id'>): Promise<number> {
  const database = getDatabase()

  console.log('[DB] Saving derived address:', {
    address: derivedAddr.address,
    invoiceNumber: derivedAddr.invoiceNumber,
    senderPubkey: derivedAddr.senderPubkey.substring(0, 16) + '...'
  })

  const result = await database.execute(
    `INSERT OR REPLACE INTO derived_addresses (address, sender_pubkey, invoice_number, private_key_wif, label, created_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      derivedAddr.address,
      derivedAddr.senderPubkey,
      derivedAddr.invoiceNumber,
      derivedAddr.privateKeyWif,
      derivedAddr.label || null,
      derivedAddr.createdAt,
      derivedAddr.lastSyncedAt || null
    ]
  )

  // Verify the save by checking total count
  const allAddresses = await getDerivedAddresses()
  console.log('[DB] Total derived addresses after save:', allAddresses.length)

  return result.lastInsertId as number
}

/**
 * Get all tracked derived addresses
 */
export async function getDerivedAddresses(): Promise<DerivedAddress[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<any[]>('SELECT * FROM derived_addresses ORDER BY created_at DESC')

    return rows.map(row => ({
      id: row.id,
      address: row.address,
      senderPubkey: row.sender_pubkey,
      invoiceNumber: row.invoice_number,
      privateKeyWif: row.private_key_wif,
      label: row.label,
      createdAt: row.created_at,
      lastSyncedAt: row.last_synced_at
    }))
  } catch (_e) {
    // Table may not exist yet
    return []
  }
}

/**
 * Get a derived address by its address string
 */
export async function getDerivedAddressByAddress(address: string): Promise<DerivedAddress | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<any[]>(
      'SELECT * FROM derived_addresses WHERE address = $1',
      [address]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      address: row.address,
      senderPubkey: row.sender_pubkey,
      invoiceNumber: row.invoice_number,
      privateKeyWif: row.private_key_wif,
      label: row.label,
      createdAt: row.created_at,
      lastSyncedAt: row.last_synced_at
    }
  } catch (_e) {
    return null
  }
}

/**
 * Update last synced time for a derived address
 */
export async function updateDerivedAddressSyncTime(address: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE derived_addresses SET last_synced_at = $1 WHERE address = $2',
    [Date.now(), address]
  )
}

/**
 * Delete a derived address
 */
export async function deleteDerivedAddress(address: string): Promise<void> {
  const database = getDatabase()

  await database.execute('DELETE FROM derived_addresses WHERE address = $1', [address])
}

/**
 * Export just the sender public keys for easy recovery
 * User only needs: 12 words + this list of sender pubkeys
 */
export async function exportSenderPubkeys(): Promise<string[]> {
  const derivedAddresses = await getDerivedAddresses()
  // Return unique sender pubkeys
  const pubkeys = new Set(derivedAddresses.map(d => d.senderPubkey))
  return Array.from(pubkeys)
}

/**
 * Get count of derived addresses for UI display
 */
export async function getDerivedAddressCount(): Promise<number> {
  const derivedAddresses = await getDerivedAddresses()
  return derivedAddresses.length
}

// ============================================
// Contacts (Sender Public Keys)
// ============================================

// Contact type - stores sender public keys with labels
export interface Contact {
  id?: number
  pubkey: string
  label: string
  createdAt: number
}

/**
 * Ensure contacts table exists
 */
export async function ensureContactsTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pubkey TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_contacts_pubkey ON contacts(pubkey)')
  } catch (e) {
    console.error('Failed to ensure contacts table:', e)
  }
}

/**
 * Add a contact
 */
export async function addContact(contact: Omit<Contact, 'id'>): Promise<number> {
  const database = getDatabase()

  const result = await database.execute(
    `INSERT OR REPLACE INTO contacts (pubkey, label, created_at)
     VALUES ($1, $2, $3)`,
    [contact.pubkey, contact.label, contact.createdAt]
  )
  return result.lastInsertId as number
}

/**
 * Get all contacts
 */
export async function getContacts(): Promise<Contact[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<any[]>('SELECT * FROM contacts ORDER BY label ASC')

    return rows.map(row => ({
      id: row.id,
      pubkey: row.pubkey,
      label: row.label,
      createdAt: row.created_at
    }))
  } catch (_e) {
    // Table may not exist yet
    return []
  }
}

/**
 * Get a contact by pubkey
 */
export async function getContactByPubkey(pubkey: string): Promise<Contact | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<any[]>(
      'SELECT * FROM contacts WHERE pubkey = $1',
      [pubkey]
    )

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      id: row.id,
      pubkey: row.pubkey,
      label: row.label,
      createdAt: row.created_at
    }
  } catch (_e) {
    return null
  }
}

/**
 * Update a contact's label
 */
export async function updateContactLabel(pubkey: string, label: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE contacts SET label = $1 WHERE pubkey = $2',
    [label, pubkey]
  )
}

/**
 * Delete a contact
 */
export async function deleteContact(pubkey: string): Promise<void> {
  const database = getDatabase()

  await database.execute('DELETE FROM contacts WHERE pubkey = $1', [pubkey])
}

/**
 * Get next invoice number for a sender (increments for unique addresses)
 */
export async function getNextInvoiceNumber(senderPubkey: string): Promise<number> {
  const database = getDatabase()

  try {
    // Count existing derived addresses for this sender
    const rows = await database.select<{count: number}[]>(
      'SELECT COUNT(*) as count FROM derived_addresses WHERE sender_pubkey = $1',
      [senderPubkey]
    )
    return (rows[0]?.count || 0) + 1
  } catch (_e) {
    return 1
  }
}

// ============================================
// BRC-100 Action Results
// ============================================

/**
 * BRC-100 action result for tracking createAction outcomes
 */
export interface ActionResult {
  id?: number
  // Unique request ID from the BRC-100 request
  requestId: string
  // Type of action (createAction, signAction, etc.)
  actionType: string
  // Description from the request
  description: string
  // Origin app that requested this action
  origin?: string
  // Transaction ID if a transaction was created
  txid?: string
  // Whether the action was approved by user
  approved: boolean
  // Error message if action failed
  error?: string
  // JSON blob of input parameters
  inputParams?: string
  // JSON blob of output result
  outputResult?: string
  // When the action was requested
  requestedAt: number
  // When the action was completed/rejected
  completedAt?: number
}

/**
 * Ensure action_results table exists
 */
export async function ensureActionResultsTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS action_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        action_type TEXT NOT NULL,
        description TEXT,
        origin TEXT,
        txid TEXT,
        approved INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        input_params TEXT,
        output_result TEXT,
        requested_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_txid ON action_results(txid)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_origin ON action_results(origin)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_action_results_requested ON action_results(requested_at)')
  } catch (e) {
    console.error('Failed to ensure action_results table:', e)
  }
}

/**
 * Record a BRC-100 action request
 */
export async function recordActionRequest(action: Omit<ActionResult, 'id'>): Promise<number> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const result = await database.execute(
    `INSERT INTO action_results
     (request_id, action_type, description, origin, txid, approved, error, input_params, output_result, requested_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      action.requestId,
      action.actionType,
      action.description || null,
      action.origin || null,
      action.txid || null,
      action.approved ? 1 : 0,
      action.error || null,
      action.inputParams || null,
      action.outputResult || null,
      action.requestedAt,
      action.completedAt || null
    ]
  )

  return result.lastInsertId as number
}

/**
 * Update an action result after completion
 */
export async function updateActionResult(
  requestId: string,
  updates: Partial<Pick<ActionResult, 'txid' | 'approved' | 'error' | 'outputResult' | 'completedAt'>>
): Promise<void> {
  const database = getDatabase()

  const setClauses: string[] = []
  const params: any[] = []
  let paramIndex = 1

  if (updates.txid !== undefined) {
    setClauses.push(`txid = $${paramIndex++}`)
    params.push(updates.txid)
  }
  if (updates.approved !== undefined) {
    setClauses.push(`approved = $${paramIndex++}`)
    params.push(updates.approved ? 1 : 0)
  }
  if (updates.error !== undefined) {
    setClauses.push(`error = $${paramIndex++}`)
    params.push(updates.error)
  }
  if (updates.outputResult !== undefined) {
    setClauses.push(`output_result = $${paramIndex++}`)
    params.push(updates.outputResult)
  }
  if (updates.completedAt !== undefined) {
    setClauses.push(`completed_at = $${paramIndex++}`)
    params.push(updates.completedAt)
  }

  if (setClauses.length > 0) {
    params.push(requestId)
    await database.execute(
      `UPDATE action_results SET ${setClauses.join(', ')} WHERE request_id = $${paramIndex}`,
      params
    )
  }
}

/**
 * Get recent action results
 */
export async function getRecentActionResults(limit = 50): Promise<ActionResult[]> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<any[]>(
    'SELECT * FROM action_results ORDER BY requested_at DESC LIMIT $1',
    [limit]
  )

  return rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description,
    origin: row.origin,
    txid: row.txid,
    approved: row.approved === 1,
    error: row.error,
    inputParams: row.input_params,
    outputResult: row.output_result,
    requestedAt: row.requested_at,
    completedAt: row.completed_at
  }))
}

/**
 * Get action results by origin (app)
 */
export async function getActionResultsByOrigin(origin: string, limit = 50): Promise<ActionResult[]> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<any[]>(
    'SELECT * FROM action_results WHERE origin = $1 ORDER BY requested_at DESC LIMIT $2',
    [origin, limit]
  )

  return rows.map(row => ({
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description,
    origin: row.origin,
    txid: row.txid,
    approved: row.approved === 1,
    error: row.error,
    inputParams: row.input_params,
    outputResult: row.output_result,
    requestedAt: row.requested_at,
    completedAt: row.completed_at
  }))
}

/**
 * Get action result by transaction ID
 */
export async function getActionResultByTxid(txid: string): Promise<ActionResult | null> {
  await ensureActionResultsTable()
  const database = getDatabase()

  const rows = await database.select<any[]>(
    'SELECT * FROM action_results WHERE txid = $1',
    [txid]
  )

  if (rows.length === 0) return null

  const row = rows[0]
  return {
    id: row.id,
    requestId: row.request_id,
    actionType: row.action_type,
    description: row.description,
    origin: row.origin,
    txid: row.txid,
    approved: row.approved === 1,
    error: row.error,
    inputParams: row.input_params,
    outputResult: row.output_result,
    requestedAt: row.requested_at,
    completedAt: row.completed_at
  }
}
