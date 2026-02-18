/**
 * Contact Repository
 *
 * Operations for contacts (sender public keys with labels).
 */

import { getDatabase } from './connection'
import { dbLogger } from '../../services/logger'
import { DbError } from '../../services/errors'
import type { Result } from '../../domain/types'
import { ok, err } from '../../domain/types'
import type { Contact } from './types'
import type { ContactRow } from './row-types'

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
    dbLogger.error('Failed to ensure contacts table:', e)
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
export async function getContacts(): Promise<Result<Contact[], DbError>> {
  const database = getDatabase()

  try {
    const rows = await database.select<ContactRow[]>('SELECT * FROM contacts ORDER BY label ASC')

    return ok(rows.map(row => ({
      id: row.id,
      pubkey: row.pubkey,
      label: row.label,
      createdAt: row.created_at
    })))
  } catch (e) {
    return err(new DbError(
      `getContacts failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Get a contact by pubkey
 * Returns ok(null) when not found, err(DbError) on database failure.
 */
export async function getContactByPubkey(pubkey: string): Promise<Result<Contact | null, DbError>> {
  const database = getDatabase()

  try {
    const rows = await database.select<ContactRow[]>(
      'SELECT * FROM contacts WHERE pubkey = $1',
      [pubkey]
    )

    if (rows.length === 0) return ok(null)

    const row = rows[0]!
    return ok({
      id: row.id,
      pubkey: row.pubkey,
      label: row.label,
      createdAt: row.created_at
    })
  } catch (e) {
    return err(new DbError(
      `getContactByPubkey failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
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
