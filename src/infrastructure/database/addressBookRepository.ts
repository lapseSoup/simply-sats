/**
 * Address Book Repository
 *
 * CRUD operations for saved BSV addresses with labels.
 * Separate from contacts (which store identity pubkeys for BRC-100).
 */

import { getDatabase } from './connection'
import { dbLogger } from '../../services/logger'
import { DbError } from '../../services/errors'
import type { Result } from '../../domain/types'
import { ok, err } from '../../domain/types'
import type { AddressBookEntry } from './types'
import type { AddressBookRow } from './row-types'

function rowToEntry(row: AddressBookRow): AddressBookEntry {
  return {
    id: row.id,
    address: row.address,
    label: row.label,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    accountId: row.account_id,
  }
}

/**
 * Ensure address_book table exists (for browser/WASM mode)
 */
export async function ensureAddressBookTable(): Promise<Result<void, DbError>> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS address_book (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        last_used_at INTEGER NOT NULL,
        use_count INTEGER NOT NULL DEFAULT 1,
        account_id INTEGER NOT NULL DEFAULT 0,
        UNIQUE(address, account_id)
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_address_book_account ON address_book(account_id)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_address_book_last_used ON address_book(last_used_at DESC)')
    return ok(undefined)
  } catch (e) {
    dbLogger.error('Failed to ensure address_book table:', e)
    return err(new DbError(
      `ensureAddressBookTable failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Get all saved addresses for an account, ordered by most recently used
 */
export async function getAddressBook(accountId: number): Promise<Result<AddressBookEntry[], DbError>> {
  const database = getDatabase()

  try {
    const rows = await database.select<AddressBookRow[]>(
      'SELECT * FROM address_book WHERE account_id = $1 ORDER BY last_used_at DESC',
      [accountId]
    )
    return ok(rows.map(rowToEntry))
  } catch (e) {
    return err(new DbError(
      `getAddressBook failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Get recently used addresses (top N)
 */
export async function getRecentAddresses(accountId: number, limit = 5): Promise<Result<AddressBookEntry[], DbError>> {
  const database = getDatabase()

  try {
    const rows = await database.select<AddressBookRow[]>(
      'SELECT * FROM address_book WHERE account_id = $1 ORDER BY last_used_at DESC LIMIT $2',
      [accountId, limit]
    )
    return ok(rows.map(rowToEntry))
  } catch (e) {
    return err(new DbError(
      `getRecentAddresses failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Save or update an address in the book.
 * If the address already exists, increments use_count and updates last_used_at.
 */
export async function saveAddress(address: string, label: string, accountId: number): Promise<Result<number, DbError>> {
  const database = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  try {
    const result = await database.execute(
      `INSERT INTO address_book (address, label, last_used_at, use_count, account_id)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT(address, account_id) DO UPDATE SET
         last_used_at = $3,
         use_count = use_count + 1,
         label = CASE WHEN $2 != '' THEN $2 ELSE address_book.label END`,
      [address, label, now, accountId]
    )
    return ok(result.lastInsertId as number)
  } catch (e) {
    return err(new DbError(
      `saveAddress failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Update an address label (scoped to account)
 */
export async function updateAddressLabel(address: string, label: string, accountId: number): Promise<Result<void, DbError>> {
  const database = getDatabase()

  try {
    await database.execute(
      'UPDATE address_book SET label = $1 WHERE address = $2 AND account_id = $3',
      [label, address, accountId]
    )
    return ok(undefined)
  } catch (e) {
    return err(new DbError(
      `updateAddressLabel failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Delete an address from the book (scoped to account)
 */
export async function deleteAddress(address: string, accountId: number): Promise<Result<void, DbError>> {
  const database = getDatabase()

  try {
    await database.execute('DELETE FROM address_book WHERE address = $1 AND account_id = $2', [address, accountId])
    return ok(undefined)
  } catch (e) {
    return err(new DbError(
      `deleteAddress failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Check if an address exists in the book
 */
export async function addressExists(address: string): Promise<Result<boolean, DbError>> {
  const database = getDatabase()

  try {
    const rows = await database.select<{ id: number }[]>(
      'SELECT id FROM address_book WHERE address = $1',
      [address]
    )
    return ok(rows.length > 0)
  } catch (e) {
    return err(new DbError(
      `addressExists failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}
