/**
 * Address Repository
 *
 * Operations for derived addresses (BRC-42/43).
 */

import { getDatabase } from './connection'
import { dbLogger } from '../logger'
import type { DerivedAddress } from './types'
import type { DerivedAddressRow, CountRow } from '../database-types'

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
    dbLogger.error('Failed to ensure derived_addresses table:', e)
  }
}

/**
 * Add a derived address to track
 */
export async function addDerivedAddress(derivedAddr: Omit<DerivedAddress, 'id'>): Promise<number> {
  const database = getDatabase()

  dbLogger.debug('[DB] Saving derived address:', {
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
  dbLogger.debug(`[DB] Total derived addresses after save: ${allAddresses.length}`)

  return result.lastInsertId as number
}

/**
 * Get all tracked derived addresses
 */
export async function getDerivedAddresses(): Promise<DerivedAddress[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<DerivedAddressRow[]>('SELECT * FROM derived_addresses ORDER BY created_at DESC')

    return rows.map(row => ({
      id: row.id,
      address: row.address,
      senderPubkey: row.sender_pubkey,
      invoiceNumber: row.invoice_number,
      privateKeyWif: row.private_key_wif,
      label: row.label ?? undefined,
      createdAt: row.created_at,
      lastSyncedAt: row.last_synced_at ?? undefined
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
    const rows = await database.select<DerivedAddressRow[]>(
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
      label: row.label ?? undefined,
      createdAt: row.created_at,
      lastSyncedAt: row.last_synced_at ?? undefined
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

/**
 * Get next invoice number for a sender (increments for unique addresses)
 */
export async function getNextInvoiceNumber(senderPubkey: string): Promise<number> {
  const database = getDatabase()

  try {
    // Count existing derived addresses for this sender
    const rows = await database.select<CountRow[]>(
      'SELECT COUNT(*) as count FROM derived_addresses WHERE sender_pubkey = $1',
      [senderPubkey]
    )
    return (rows[0]?.count || 0) + 1
  } catch (_e) {
    return 1
  }
}
