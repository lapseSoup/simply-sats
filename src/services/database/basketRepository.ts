/**
 * Basket Repository
 *
 * CRUD operations for UTXO baskets.
 */

import { getDatabase } from './connection'
import type { Basket } from './types'
import type { BasketRow } from '../database-types'

/**
 * Get all baskets
 */
export async function getBaskets(): Promise<Basket[]> {
  const database = getDatabase()

  const rows = await database.select<BasketRow[]>('SELECT * FROM baskets ORDER BY name')

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
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

/**
 * Ensure a basket exists (create if not)
 */
export async function ensureBasket(name: string, description?: string): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES ($1, $2, $3)',
    [name, description || null, Date.now()]
  )
}
