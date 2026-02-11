/**
 * Lock Repository
 *
 * CRUD operations for time-locked outputs.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../logger'
import type { Lock, UTXO } from './types'
import type { LockRow, LockWithUTXORow } from '../database-types'

/**
 * Add a time-locked output
 */
export async function addLock(lock: Omit<Lock, 'id'>, accountId?: number): Promise<number> {
  const database = getDatabase()

  const result = await database.execute(
    `INSERT INTO locks (utxo_id, unlock_block, lock_block, ordinal_origin, created_at, account_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [lock.utxoId, lock.unlockBlock, lock.lockBlock || null, lock.ordinalOrigin || null, lock.createdAt, accountId ?? 1]
  )

  return result.lastInsertId as number
}

/**
 * Idempotently add a lock — skips if a lock already exists for this utxo_id.
 * Safe to call repeatedly during sync/restore without causing duplicate errors.
 */
export async function addLockIfNotExists(
  lock: Omit<Lock, 'id'>,
  accountId?: number
): Promise<number> {
  const database = getDatabase()

  const existing = await database.select<{ id: number }[]>(
    'SELECT id FROM locks WHERE utxo_id = $1',
    [lock.utxoId]
  )

  if (existing.length > 0) {
    return existing[0]!.id
  }

  return addLock(lock, accountId)
}

/**
 * Get all locks with UTXO details, optionally scoped to an account
 */
export async function getLocks(currentHeight: number, accountId?: number): Promise<(Lock & { utxo: UTXO })[]> {
  const database = getDatabase()

  const query = accountId !== undefined && accountId !== null
    ? `SELECT l.*, u.txid, u.vout, u.satoshis, u.locking_script, u.basket, u.address
       FROM locks l
       INNER JOIN utxos u ON l.utxo_id = u.id
       WHERE l.unlocked_at IS NULL AND l.account_id = $1
       ORDER BY l.unlock_block ASC`
    : `SELECT l.*, u.txid, u.vout, u.satoshis, u.locking_script, u.basket, u.address
       FROM locks l
       INNER JOIN utxos u ON l.utxo_id = u.id
       WHERE l.unlocked_at IS NULL
       ORDER BY l.unlock_block ASC`

  const params = accountId !== undefined && accountId !== null ? [accountId] : []
  const rows = await database.select<LockWithUTXORow[]>(query, params)

  return rows.map(row => ({
    id: row.id,
    utxoId: row.utxo_id,
    unlockBlock: row.unlock_block,
    lockBlock: row.lock_block ?? undefined,
    ordinalOrigin: row.ordinal_origin ?? undefined,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at ?? undefined,
    utxo: {
      id: row.utxo_id,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      lockingScript: row.locking_script,
      address: row.address ?? undefined,
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
  dbLogger.debug(`[DB] Marked lock as unlocked: ${txid}:${vout}`)
}

/**
 * Backfill lock_block for locks that were created before migration 014
 */
export async function updateLockBlock(txid: string, vout: number, lockBlock: number): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `UPDATE locks SET lock_block = $1
     WHERE utxo_id IN (SELECT id FROM utxos WHERE txid = $2 AND vout = $3)
     AND lock_block IS NULL`,
    [lockBlock, txid, vout]
  )
  dbLogger.debug(`[DB] Backfilled lock_block: ${txid}:${vout} -> ${lockBlock}`)
}

/**
 * Get all locks for export
 */
export async function getAllLocks(): Promise<Lock[]> {
  const database = getDatabase()

  const rows = await database.select<LockRow[]>('SELECT * FROM locks')

  return rows.map(row => ({
    id: row.id,
    utxoId: row.utxo_id,
    unlockBlock: row.unlock_block,
    lockBlock: row.lock_block ?? undefined,
    ordinalOrigin: row.ordinal_origin ?? undefined,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at ?? undefined
  }))
}
