/**
 * UTXO Repository
 *
 * CRUD operations for UTXOs and pending spend management.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../logger'
import type { UTXO } from './types'
import type {
  UTXORow,
  UTXOExistsRow,
  UTXOVerifyRow,
  PendingUTXORow,
  AddressCheckRow,
  SpendingStatusCheckRow,
  BalanceSumRow,
  SqlParams
} from '../database-types'

// ============================================
// Migration Helpers
// ============================================

/**
 * Ensure the address column exists (migration)
 */
async function ensureAddressColumn(): Promise<void> {
  const database = getDatabase()
  try {
    // Check if column exists by trying to select it
    await database.select<AddressCheckRow[]>('SELECT address FROM utxos LIMIT 1')
  } catch {
    // Column doesn't exist, add it
    dbLogger.debug('[DB] Adding address column to utxos table...')
    await database.execute('ALTER TABLE utxos ADD COLUMN address TEXT')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address)')
  }
}

/**
 * Ensure the spending_status column exists (migration)
 */
async function ensureSpendingStatusColumn(): Promise<void> {
  const database = getDatabase()
  try {
    // Check if column exists by trying to select it
    await database.select<SpendingStatusCheckRow[]>('SELECT spending_status FROM utxos LIMIT 1')
  } catch {
    // Column doesn't exist, add it
    dbLogger.debug('[DB] Adding spending_status columns to utxos table...')
    await database.execute("ALTER TABLE utxos ADD COLUMN spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent'))")
    await database.execute('ALTER TABLE utxos ADD COLUMN pending_spending_txid TEXT')
    await database.execute('ALTER TABLE utxos ADD COLUMN pending_since INTEGER')
    await database.execute("CREATE INDEX IF NOT EXISTS idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending'")
  }
}

// ============================================
// UTXO CRUD Operations
// ============================================

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
  const existing = await database.select<UTXOExistsRow[]>(
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
        dbLogger.debug(`[DB] Updating derived UTXO ${utxo.txid.slice(0,8)}:${utxo.vout} - clearing spent_at, spendable=${spendableValue}`)
        await database.execute(
          'UPDATE utxos SET address = COALESCE($1, address), spendable = $2, spent_at = NULL WHERE id = $3',
          [utxo.address, spendableValue, ex.id]
        )
      }
      return ex.id
    }

    // Case 2: New is 'derived', existing is not - UPGRADE to derived
    if (utxo.basket === 'derived') {
      dbLogger.debug(`[DB] Upgrading ${utxo.txid.slice(0,8)}:${utxo.vout} to derived, spendable=${spendableValue}`)
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
  dbLogger.debug(`[DB] INSERT: ${utxo.txid.slice(0,8)}:${utxo.vout} ${utxo.satoshis}sats basket=${utxo.basket} spendable=${utxo.spendable}`)
  const result = await database.execute(
    `INSERT INTO utxos (txid, vout, satoshis, locking_script, address, basket, spendable, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [utxo.txid, utxo.vout, utxo.satoshis, utxo.lockingScript, utxo.address, utxo.basket, utxo.spendable ? 1 : 0, utxo.createdAt]
  )

  const utxoId = result.lastInsertId as number
  dbLogger.debug(`[DB] INSERT OK: id=${utxoId}`)

  // Verify the insert by reading it back
  const verify = await database.select<UTXOVerifyRow[]>('SELECT id, basket, spendable FROM utxos WHERE id = $1', [utxoId])
  dbLogger.debug(`[DB] VERIFY: id=${verify[0]?.id} basket=${verify[0]?.basket} spendable=${verify[0]?.spendable}`)

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

  const rows = await database.select<UTXORow[]>(query, [basket])

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
      spentAt: row.spent_at ?? undefined,
      spentTxid: row.spent_txid ?? undefined,
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

  const rows = await database.select<UTXORow[]>(
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

  const rows = await database.select<UTXORow[]>(
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
  const rows = await database.select<PendingUTXORow[]>(
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

// ============================================
// Balance Operations
// ============================================

/**
 * Get total balance from database
 * Excludes UTXOs that are pending (being spent) to prevent double-counting
 */
export async function getBalanceFromDB(basket?: string): Promise<number> {
  const database = getDatabase()

  let query = "SELECT SUM(satoshis) as total FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
  const params: SqlParams = []

  if (basket) {
    query += ' AND basket = $1'
    params.push(basket)
  }

  const result = await database.select<BalanceSumRow[]>(query, params)
  return result[0]?.total || 0
}

// ============================================
// Maintenance Operations
// ============================================

/**
 * Get all UTXOs for export
 */
export async function getAllUTXOs(): Promise<UTXO[]> {
  const database = getDatabase()

  const rows = await database.select<UTXORow[]>('SELECT * FROM utxos')

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
      address: row.address ?? undefined,
      basket: row.basket,
      spendable: row.spendable === 1,
      createdAt: row.created_at,
      spentAt: row.spent_at ?? undefined,
      spentTxid: row.spent_txid ?? undefined,
      tags: tags.map(t => t.tag)
    })
  }

  return utxos
}

/**
 * Toggle a UTXO's frozen status
 * When frozen=true, the UTXO becomes unspendable
 * When frozen=false, the UTXO becomes spendable again
 */
export async function toggleUtxoFrozen(
  txid: string,
  vout: number,
  frozen: boolean
): Promise<void> {
  const database = getDatabase()
  const spendable = frozen ? 0 : 1

  dbLogger.debug(`[DB] Setting UTXO ${txid.slice(0, 8)}:${vout} frozen=${frozen} (spendable=${spendable})`)

  await database.execute(
    'UPDATE utxos SET spendable = $1 WHERE txid = $2 AND vout = $3',
    [spendable, txid, vout]
  )
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
    dbLogger.info(`[DB] Repaired ${fixed} UTXOs - set spendable=1`)
  }

  return fixed
}
