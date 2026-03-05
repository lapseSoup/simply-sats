/**
 * BasketService — BRC-46/112/114 basket operations.
 *
 * BRC-112: Query basket balances (sum of spendable, non-relinquished outputs).
 * BRC-46:  Relinquish individual outputs from a basket.
 * BRC-114: List transaction actions with time-based filtering.
 *
 * Operates directly on the `utxos` and `transactions` tables via the
 * shared database connection.
 *
 * @module services/brc/baskets
 */

import { getDatabase } from '../../infrastructure/database/connection'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter options for listActions (BRC-114). */
export interface ActionFilter {
  /** Return actions created at or after this unix timestamp. */
  since?: number
  /** Return actions created at or before this unix timestamp. */
  until?: number
  /** Label filter (reserved for future use). */
  labels?: string[]
  /** Maximum number of results to return. */
  limit?: number
  /** Number of results to skip (requires limit). */
  offset?: number
}

/** A transaction action row returned by listActions. */
export interface ActionRow {
  id: number
  txid: string
  raw_tx: string | null
  description: string | null
  created_at: number
  confirmed_at: number | null
  block_height: number | null
  status: string
  amount: number
  account_id: number
  beef_data: string | null
}

// ---------------------------------------------------------------------------
// BasketService
// ---------------------------------------------------------------------------

export class BasketService {
  /**
   * BRC-112: Get total satoshis in a basket.
   *
   * Sums all spendable, non-relinquished UTXOs belonging to the given basket
   * and account. Returns 0 if the basket is empty or does not exist.
   */
  async getBasketBalance(basketName: string, accountId = 0): Promise<number> {
    const db = getDatabase()
    const result = await db.select<{ total: number | null }[]>(
      'SELECT COALESCE(SUM(satoshis), 0) as total FROM utxos WHERE basket = ? AND account_id = ? AND spendable = 1 AND relinquished = 0',
      [basketName, accountId],
    )
    return result[0]?.total ?? 0
  }

  /**
   * BRC-46: Relinquish an output from a basket.
   *
   * Marks the UTXO identified by `outpoint` (format: "txid.vout") as
   * relinquished so it is excluded from future balance queries and
   * coin selection.
   */
  async relinquishOutput(
    basketName: string,
    outpoint: string,
    accountId = 0,
  ): Promise<{ success: boolean }> {
    const parts = outpoint.split('.')
    if (parts.length !== 2) {
      throw new Error(`Invalid outpoint format: ${outpoint}. Expected "txid.vout"`)
    }
    const [txid, voutStr] = parts
    const vout = parseInt(voutStr, 10)
    if (isNaN(vout)) {
      throw new Error(`Invalid vout in outpoint: ${outpoint}`)
    }

    const db = getDatabase()
    await db.execute(
      'UPDATE utxos SET relinquished = 1 WHERE txid = ? AND vout = ? AND basket = ? AND account_id = ?',
      [txid, vout, basketName, accountId],
    )
    return { success: true }
  }

  /**
   * BRC-114: List actions with time-based filtering.
   *
   * Queries the transactions table with optional since/until timestamps,
   * limit, and offset. Results are ordered by created_at descending
   * (most recent first).
   */
  async listActions(
    filter: ActionFilter,
    accountId = 0,
  ): Promise<ActionRow[]> {
    const db = getDatabase()

    let query = 'SELECT * FROM transactions WHERE account_id = ?'
    const params: unknown[] = [accountId]

    if (filter.since != null) {
      query += ' AND created_at >= ?'
      params.push(filter.since)
    }
    if (filter.until != null) {
      query += ' AND created_at <= ?'
      params.push(filter.until)
    }

    query += ' ORDER BY created_at DESC'

    if (filter.limit != null) {
      query += ' LIMIT ?'
      params.push(filter.limit)

      if (filter.offset != null) {
        query += ' OFFSET ?'
        params.push(filter.offset)
      }
    }

    return db.select<ActionRow[]>(query, params)
  }
}
