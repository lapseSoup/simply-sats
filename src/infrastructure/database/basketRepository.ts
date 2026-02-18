/**
 * Basket Repository
 *
 * CRUD operations for UTXO baskets.
 *
 * NOTE: basket tables and the `basket` column on `utxos` are actively used
 * throughout the codebase (sync, UTXOs tab, backup/restore, coin control).
 * However, these three repository functions currently have 0 call sites —
 * kept for future use when basket management UI is introduced.
 */

import { type Result, ok, err } from '../../domain/types'
import { DbError } from '../../services/errors'
import { getDatabase } from './connection'
import type { Basket } from './types'
import type { BasketRow } from './row-types'

/**
 * Get all baskets
 */
export async function getBaskets(): Promise<Result<Basket[], DbError>> {
  try {
    const database = getDatabase()
    const rows = await database.select<BasketRow[]>('SELECT * FROM baskets ORDER BY name')
    return ok(rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      createdAt: row.created_at
    })))
  } catch (e) {
    return err(new DbError(
      `getBaskets failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Create a new basket
 */
export async function createBasket(name: string, description?: string): Promise<Result<number, DbError>> {
  try {
    const database = getDatabase()
    const result = await database.execute(
      'INSERT INTO baskets (name, description, created_at) VALUES ($1, $2, $3)',
      [name, description || null, Date.now()]
    )
    return ok(result.lastInsertId as number)
  } catch (e) {
    return err(new DbError(
      `createBasket failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Ensure a basket exists (create if not)
 */
export async function ensureBasket(name: string, description?: string): Promise<Result<void, DbError>> {
  try {
    const database = getDatabase()
    await database.execute(
      'INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES ($1, $2, $3)',
      [name, description || null, Date.now()]
    )
    return ok(undefined)
  } catch (e) {
    return err(new DbError(
      `ensureBasket failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}
