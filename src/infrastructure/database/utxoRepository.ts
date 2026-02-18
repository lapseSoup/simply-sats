/**
 * UTXO Repository
 *
 * CRUD operations for UTXOs and pending spend management.
 * All exported functions return Result<T, DbError> for consistent error handling.
 */

import { getDatabase, withTransaction } from './connection'
import { dbLogger } from '../../services/logger'
import { type Result, ok, err } from '../../domain/types'
import { DbError } from '../../services/errors'
import type { UTXO } from './types'
import type {
  UTXORow,
  UTXOExistsRow,
  UTXOVerifyRow,
  PendingUTXORow,
  BalanceSumRow,
  SqlParams
} from './row-types'

// ============================================
// Migration Helpers
// ============================================

/**
 * Ensure a column exists by probing it; run DDL statements if missing.
 */
async function ensureColumn(probeColumn: string, ddlStatements: string[]): Promise<void> {
  const database = getDatabase()
  try {
    await database.select<Record<string, unknown>[]>(`SELECT ${probeColumn} FROM utxos LIMIT 1`)
  } catch {
    dbLogger.debug(`[DB] Adding ${probeColumn} column(s) to utxos table...`)
    for (const ddl of ddlStatements) {
      await database.execute(ddl)
    }
  }
}

async function ensureAddressColumn(): Promise<void> {
  await ensureColumn('address', [
    'ALTER TABLE utxos ADD COLUMN address TEXT',
    'CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address)'
  ])
}

async function ensureSpendingStatusColumn(): Promise<void> {
  await ensureColumn('spending_status', [
    "ALTER TABLE utxos ADD COLUMN spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent'))",
    'ALTER TABLE utxos ADD COLUMN pending_spending_txid TEXT',
    'ALTER TABLE utxos ADD COLUMN pending_since INTEGER',
    "CREATE INDEX IF NOT EXISTS idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending'"
  ])
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
export async function addUTXO(utxo: Omit<UTXO, 'id'>, accountId?: number): Promise<Result<number, DbError>> {
  try {
    const database = getDatabase()

    // Ensure migration is done
    await ensureAddressColumn()

    // Check if UTXO already exists - get ALL relevant fields
    const existing = await database.select<UTXOExistsRow[]>(
      'SELECT id, basket, address, spendable, spent_at, account_id FROM utxos WHERE txid = $1 AND vout = $2',
      [utxo.txid, utxo.vout]
    )

    if (existing.length > 0) {
      const ex = existing[0]!
      const spendableValue = utxo.spendable ? 1 : 0

      // S-7: Only migrate account_id if the address ownership check passes.
      // A UTXO's address must match the incoming address (or have no stored address)
      // before we reassign it to a different account. This prevents cross-account
      // UTXO reassignment when two accounts share an address (e.g. via address reuse).
      const addressMatches = !ex.address || !utxo.address || ex.address === utxo.address
      const accId = addressMatches ? (accountId ?? 1) : (ex.account_id ?? 1)

      if (!addressMatches) {
        dbLogger.warn(`[DB] Address mismatch on UTXO ${utxo.txid.slice(0,8)}:${utxo.vout} — keeping existing account_id (stored: ${ex.address}, incoming: ${utxo.address})`)
      }

      // CRITICAL: If we're re-syncing a UTXO that exists on-chain, it's NOT spent!
      // Always clear spent_at and ensure spendable is correct when adding a UTXO
      // that was found on the blockchain

      // Case 1: Existing is 'derived' - keep derived, but ensure it's spendable and unspent
      if (ex.basket === 'derived') {
        // ALWAYS reset spending state when a UTXO is confirmed on-chain — it's definitively unspent
        dbLogger.debug(`[DB] Updating derived UTXO ${utxo.txid.slice(0,8)}:${utxo.vout} - clearing spent/pending state, spendable=${spendableValue}, account=${accId}`)
        await database.execute(
          `UPDATE utxos SET address = COALESCE($1, address), spendable = $2, spent_at = NULL,
           spending_status = 'unspent', pending_spending_txid = NULL, pending_since = NULL,
           account_id = $3 WHERE id = $4`,
          [utxo.address, spendableValue, accId, ex.id]
        )
        return ok(ex.id)
      }

      // Case 2: New is 'derived', existing is not - UPGRADE to derived
      if (utxo.basket === 'derived') {
        dbLogger.debug(`[DB] Upgrading ${utxo.txid.slice(0,8)}:${utxo.vout} to derived, spendable=${spendableValue}, account=${accId}`)
        await database.execute(
          `UPDATE utxos SET basket = $1, address = $2, locking_script = $3, spendable = $4, spent_at = NULL,
           spending_status = 'unspent', pending_spending_txid = NULL, pending_since = NULL,
           account_id = $5 WHERE id = $6`,
          ['derived', utxo.address, utxo.lockingScript, spendableValue, accId, ex.id]
        )
        return ok(ex.id)
      }

      // Case 3: Same or compatible basket - ensure spendable and all spending state is clean
      // ALWAYS reset spending state when a UTXO is confirmed on-chain — it's definitively unspent
      await database.execute(
        `UPDATE utxos SET address = COALESCE($1, address), spendable = $2, spent_at = NULL,
         spending_status = 'unspent', pending_spending_txid = NULL, pending_since = NULL,
         account_id = $3 WHERE id = $4`,
        [utxo.address, spendableValue, accId, ex.id]
      )
      return ok(ex.id)
    }

    // UTXO doesn't exist - INSERT it
    const accId = accountId ?? 1 // Default to account 1 for backwards compatibility
    dbLogger.debug(`[DB] INSERT: ${utxo.txid.slice(0,8)}:${utxo.vout} ${utxo.satoshis}sats basket=${utxo.basket} spendable=${utxo.spendable} account=${accId}`)
    const result = await database.execute(
      `INSERT INTO utxos (txid, vout, satoshis, locking_script, address, basket, spendable, created_at, account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [utxo.txid, utxo.vout, utxo.satoshis, utxo.lockingScript, utxo.address, utxo.basket, utxo.spendable ? 1 : 0, utxo.createdAt, accId]
    )

    const utxoId = result.lastInsertId as number
    dbLogger.debug(`[DB] INSERT OK: id=${utxoId}`)

    // Verify the insert by reading it back
    const verify = await database.select<UTXOVerifyRow[]>('SELECT id, basket, spendable FROM utxos WHERE id = $1', [utxoId])
    dbLogger.debug(`[DB] VERIFY: id=${verify[0]?.id} basket=${verify[0]?.basket} spendable=${verify[0]?.spendable}`)

    // Add tags if provided
    if (utxo.tags && utxo.tags.length > 0) {
      for (const tag of utxo.tags) {
        try {
          await database.execute(
            'INSERT INTO utxo_tags (utxo_id, tag) VALUES ($1, $2)',
            [utxoId, tag]
          )
        } catch (error) {
          const msg = String(error)
          if (!msg.includes('UNIQUE') && !msg.includes('duplicate')) {
            dbLogger.warn('[DB] Failed to insert UTXO tag', { utxoId, tag, error: msg })
          }
        }
      }
    }

    return ok(utxoId)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'addUTXO'))
  }
}

/**
 * Get UTXOs by basket for a specific account
 * When spendableOnly is true, excludes pending UTXOs to prevent race conditions
 * @param basket - The basket name
 * @param spendableOnly - Whether to only return spendable UTXOs
 * @param accountId - The account ID to filter by (optional)
 */
export async function getUTXOsByBasket(basket: string, spendableOnly = true, accountId?: number): Promise<Result<UTXO[], DbError>> {
  try {
    const database = getDatabase()

    let query = 'SELECT * FROM utxos WHERE basket = $1'
    const params: SqlParams = [basket]

    if (spendableOnly) {
      query += " AND spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
    }

    if (accountId !== undefined) {
      query += ` AND account_id = $${params.length + 1}`
      params.push(accountId)
    }

    const rows = await database.select<UTXORow[]>(query, params)

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

    return ok(utxos)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getUTXOsByBasket'))
  }
}

/**
 * Get all spendable UTXOs across all baskets for a specific account
 * Excludes UTXOs that are pending (being spent) to prevent race conditions
 * @param accountId - The account ID to filter by (optional, defaults to all accounts for backwards compat)
 */
export async function getSpendableUTXOs(accountId?: number): Promise<Result<UTXO[], DbError>> {
  try {
    const database = getDatabase()

    // Ensure migration is done
    await ensureSpendingStatusColumn()

    let query = "SELECT * FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
    const params: SqlParams = []

    if (accountId !== undefined) {
      query += ' AND account_id = $1'
      params.push(accountId)
    }

    const rows = await database.select<UTXORow[]>(query, params)

    return ok(rows.map(row => ({
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
    })))
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getSpendableUTXOs'))
  }
}

/**
 * Get spendable UTXOs for a specific address
 * Excludes UTXOs that are pending (being spent) to prevent race conditions
 */
export async function getSpendableUTXOsByAddress(address: string): Promise<Result<UTXO[], DbError>> {
  try {
    const database = getDatabase()

    // Ensure migration is done
    await ensureSpendingStatusColumn()

    const rows = await database.select<UTXORow[]>(
      "SELECT * FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent') AND address = $1",
      [address]
    )

    return ok(rows.map(row => ({
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
    })))
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getSpendableUTXOsByAddress'))
  }
}

/**
 * Mark a UTXO as spent
 */
export async function markUTXOSpent(txid: string, vout: number, spentTxid: string, accountId?: number): Promise<Result<void, DbError>> {
  try {
    const database = getDatabase()

    if (accountId !== undefined) {
      await database.execute(
        'UPDATE utxos SET spent_at = $1, spent_txid = $2, spending_status = $3 WHERE txid = $4 AND vout = $5 AND account_id = $6',
        [Date.now(), spentTxid, 'spent', txid, vout, accountId]
      )
    } else {
      await database.execute(
        'UPDATE utxos SET spent_at = $1, spent_txid = $2, spending_status = $3 WHERE txid = $4 AND vout = $5',
        [Date.now(), spentTxid, 'spent', txid, vout]
      )
    }
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'markUTXOSpent'))
  }
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
): Promise<Result<void, DbError>> {
  try {
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
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'markUtxosPendingSpend'))
  }
}

/**
 * Confirm UTXOs as spent (AFTER successful broadcast)
 */
export async function confirmUtxosSpent(
  utxos: Array<{ txid: string; vout: number }>,
  spendingTxid: string
): Promise<Result<void, DbError>> {
  try {
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
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'confirmUtxosSpent'))
  }
}

/**
 * Rollback pending spend (if broadcast FAILS)
 */
export async function rollbackPendingSpend(
  utxos: Array<{ txid: string; vout: number }>
): Promise<Result<void, DbError>> {
  try {
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
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'rollbackPendingSpend'))
  }
}

/**
 * Get UTXOs that are stuck in pending state (for recovery)
 * UTXOs pending for more than the specified timeout are considered stuck.
 */
export async function getPendingUtxos(timeoutMs: number = 300000): Promise<Result<Array<{
  txid: string
  vout: number
  satoshis: number
  pendingTxid: string
  pendingSince: number
}>, DbError>> {
  try {
    await ensureSpendingStatusColumn()
    const database = getDatabase()

    const cutoff = Date.now() - timeoutMs
    const rows = await database.select<PendingUTXORow[]>(
      `SELECT txid, vout, satoshis, pending_spending_txid, pending_since
       FROM utxos
       WHERE spending_status = 'pending' AND pending_since < $1`,
      [cutoff]
    )

    return ok(rows.map(row => ({
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      pendingTxid: row.pending_spending_txid,
      pendingSince: row.pending_since
    })))
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getPendingUtxos'))
  }
}

/**
 * Look up a UTXO by its outpoint (txid + vout)
 * Used by sync to compute net transaction amounts via local UTXO data
 * @param txid - Transaction ID of the outpoint
 * @param vout - Output index
 * @param accountId - Optional account ID to scope the lookup
 */
export async function getUtxoByOutpoint(txid: string, vout: number, accountId?: number): Promise<Result<{ satoshis: number } | null, DbError>> {
  try {
    const database = getDatabase()
    let query = 'SELECT satoshis FROM utxos WHERE txid = $1 AND vout = $2'
    const params: SqlParams = [txid, vout]
    if (accountId !== undefined) {
      query += ' AND account_id = $3'
      params.push(accountId)
    }
    const rows = await database.select<{ satoshis: number }[]>(query, params)
    return ok(rows[0] ?? null)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getUtxoByOutpoint'))
  }
}

// ============================================
// Balance Operations
// ============================================

/**
 * Get total balance from database for a specific account
 * Excludes UTXOs that are pending (being spent) to prevent double-counting
 * @param basket - Optional basket filter
 * @param accountId - The account ID to filter by (optional)
 */
export async function getBalanceFromDB(basket?: string, accountId?: number): Promise<Result<number, DbError>> {
  try {
    const database = getDatabase()

    // Ensure migration is done
    await ensureSpendingStatusColumn()

    let query = "SELECT SUM(satoshis) as total FROM utxos WHERE spendable = 1 AND spent_at IS NULL AND (spending_status IS NULL OR spending_status = 'unspent')"
    const params: SqlParams = []
    let paramIndex = 1

    if (basket) {
      query += ` AND basket = $${paramIndex++}`
      params.push(basket)
    }

    if (accountId !== undefined) {
      query += ` AND account_id = $${paramIndex}`
      params.push(accountId)
    }

    const result = await database.select<BalanceSumRow[]>(query, params)
    return ok(result[0]?.total || 0)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getBalanceFromDB'))
  }
}

// ============================================
// Maintenance Operations
// ============================================

/**
 * Get all UTXOs for export or display (optionally filtered by account)
 * @param accountId - Optional account ID to filter by
 */
export async function getAllUTXOs(accountId?: number): Promise<Result<UTXO[], DbError>> {
  try {
    const database = getDatabase()

    let query = 'SELECT * FROM utxos'
    const params: SqlParams = []

    if (accountId !== undefined) {
      query += ' WHERE account_id = $1'
      params.push(accountId)
    }

    const rows = await database.select<UTXORow[]>(query, params)

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

    return ok(utxos)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'getAllUTXOs'))
  }
}

/**
 * Toggle a UTXO's frozen status
 * When frozen=true, the UTXO becomes unspendable
 * When frozen=false, the UTXO becomes spendable again
 */
export async function toggleUtxoFrozen(
  txid: string,
  vout: number,
  frozen: boolean,
  accountId?: number
): Promise<Result<void, DbError>> {
  try {
    const database = getDatabase()
    const spendable = frozen ? 0 : 1
    const frozenFlag = frozen ? 1 : 0

    dbLogger.debug(`[DB] Setting UTXO ${txid.slice(0, 8)}:${vout} frozen=${frozen} (spendable=${spendable})`)

    if (accountId !== undefined) {
      await database.execute(
        'UPDATE utxos SET spendable = $1, frozen = $2 WHERE txid = $3 AND vout = $4 AND account_id = $5',
        [spendable, frozenFlag, txid, vout, accountId]
      )
    } else {
      await database.execute(
        'UPDATE utxos SET spendable = $1, frozen = $2 WHERE txid = $3 AND vout = $4',
        [spendable, frozenFlag, txid, vout]
      )
    }
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'toggleUtxoFrozen'))
  }
}

/**
 * Repair UTXOs - fix any broken spendable flags
 * Call this to fix UTXOs that should be spendable but aren't.
 * Excludes frozen UTXOs (user-intentionally frozen) and lock-basket UTXOs.
 */
export async function repairUTXOs(accountId?: number): Promise<Result<number, DbError>> {
  try {
    const database = getDatabase()

    // Find UTXOs that are not in the locks basket, not frozen, but have spendable=0 and no spent_at
    // These are likely broken from previous bugs
    let result
    if (accountId !== undefined) {
      result = await database.execute(
        `UPDATE utxos SET spendable = 1
         WHERE spendable = 0
         AND spent_at IS NULL
         AND basket != 'locks'
         AND (frozen IS NULL OR frozen = 0)
         AND account_id = $1`,
        [accountId]
      )
    } else {
      result = await database.execute(
        `UPDATE utxos SET spendable = 1
         WHERE spendable = 0
         AND spent_at IS NULL
         AND basket != 'locks'
         AND (frozen IS NULL OR frozen = 0)`
      )
    }

    const fixed = result.rowsAffected || 0
    if (fixed > 0) {
      dbLogger.info(`[DB] Repaired ${fixed} UTXOs - set spendable=1`)
    }

    return ok(fixed)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'repairUTXOs'))
  }
}

/**
 * Clear all UTXOs for a specific account.
 * Used by Reset & Resync to rebuild UTXO state from chain.
 */
export async function clearUtxosForAccount(accountId: number): Promise<Result<void, DbError>> {
  try {
    const database = getDatabase()
    dbLogger.info(`[DB] Clearing all UTXOs for account ${accountId}`)
    await database.execute('DELETE FROM utxos WHERE account_id = $1', [accountId])
    return ok(undefined)
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'clearUtxosForAccount'))
  }
}

/**
 * Reassign ALL data from a legacy default account_id to the correct account.
 *
 * Before the accountId plumbing fix, lockBSV/unlockBSV and other operations
 * defaulted to account_id=1. When the actual account has a different ID (e.g. 23),
 * all that data becomes invisible to account-scoped queries. This function moves
 * ALL records (utxos, transactions, locks, ordinal_cache) from account_id=1 to
 * the specified target account.
 *
 * Safe to call multiple times — it's a no-op if no records need reassignment.
 */
export async function reassignAccountData(targetAccountId: number): Promise<Result<number, DbError>> {
  if (targetAccountId === 1) return ok(0) // Nothing to reassign

  try {
    return await withTransaction(async () => {
      const database = getDatabase()
      let totalFixed = 0

      // Reassign UTXOs
      const utxoResult = await database.execute(
        'UPDATE utxos SET account_id = $1 WHERE account_id = 1',
        [targetAccountId]
      )
      const utxoFixed = utxoResult.rowsAffected || 0
      totalFixed += utxoFixed

      // Reassign transactions
      const txResult = await database.execute(
        'UPDATE transactions SET account_id = $1 WHERE account_id = 1',
        [targetAccountId]
      )
      const txFixed = txResult.rowsAffected || 0
      totalFixed += txFixed

      // Reassign locks
      const lockResult = await database.execute(
        'UPDATE locks SET account_id = $1 WHERE account_id = 1',
        [targetAccountId]
      )
      const lockFixed = lockResult.rowsAffected || 0
      totalFixed += lockFixed

      // Reassign ordinal cache
      try {
        const ordResult = await database.execute(
          'UPDATE ordinal_cache SET account_id = $1 WHERE account_id = 1',
          [targetAccountId]
        )
        const ordFixed = ordResult.rowsAffected || 0
        totalFixed += ordFixed
        if (ordFixed > 0) dbLogger.info(`[DB] Reassigned ${ordFixed} ordinal cache entries`)
      } catch {
        // ordinal_cache table may not exist yet
      }

      if (totalFixed > 0) {
        dbLogger.info(`[DB] Reassigned ${totalFixed} records from account_id=1 to account_id=${targetAccountId}`, {
          utxos: utxoFixed, transactions: txFixed, locks: lockFixed
        })
      }

      return ok(totalFixed)
    })
  } catch (error) {
    return err(new DbError(error instanceof Error ? error.message : String(error), 'reassignAccountData'))
  }
}
