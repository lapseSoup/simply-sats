/**
 * Database Backup Operations
 *
 * Export/import and maintenance operations for the database.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../../services/logger'
import type { DatabaseBackup, UTXO, Transaction, Lock, Basket } from './types'
import type { UTXORow, TransactionRow, LockRow, BasketRow, SyncStateRow } from './row-types'
import { getDerivedAddresses, ensureDerivedAddressesTable } from './addressRepository'
import { getContacts, ensureContactsTable } from './contactRepository'
import { getCachedOrdinalsWithContent, ensureOrdinalCacheTable, upsertOrdinalCache, upsertOrdinalContent } from './ordinalRepository'

/**
 * Export entire database as JSON
 */
export async function exportDatabase(): Promise<DatabaseBackup> {
  const database = getDatabase()

  // Get all UTXOs
  const utxoRows = await database.select<UTXORow[]>('SELECT * FROM utxos')
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
      address: row.address ?? undefined,
      basket: row.basket,
      spendable: row.spendable === 1,
      createdAt: row.created_at,
      spentAt: row.spent_at ?? undefined,
      spentTxid: row.spent_txid ?? undefined,
      tags: tags.map(t => t.tag)
    })
  }

  // Get all transactions
  const txRows = await database.select<TransactionRow[]>('SELECT * FROM transactions')
  const transactions: Transaction[] = txRows.map(row => ({
    id: row.id,
    txid: row.txid,
    rawTx: row.raw_tx ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at ?? undefined,
    blockHeight: row.block_height ?? undefined,
    status: row.status
  }))

  // Get all locks
  const lockRows = await database.select<LockRow[]>('SELECT * FROM locks')
  const locks: Lock[] = lockRows.map(row => ({
    id: row.id,
    utxoId: row.utxo_id,
    unlockBlock: row.unlock_block,
    ordinalOrigin: row.ordinal_origin ?? undefined,
    createdAt: row.created_at,
    unlockedAt: row.unlocked_at ?? undefined
  }))

  // Get all baskets
  const basketRows = await database.select<BasketRow[]>('SELECT * FROM baskets')
  const baskets: Basket[] = basketRows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at
  }))

  // Get sync state
  const syncRows = await database.select<SyncStateRow[]>('SELECT * FROM sync_state')
  const syncState = syncRows.map(row => ({
    address: row.address,
    height: row.last_synced_height,
    syncedAt: row.last_synced_at
  }))

  // Get derived addresses (strip private keys — re-derivable from mnemonic via BRC-42/43)
  const rawDerivedAddresses = await getDerivedAddresses()
  const derivedAddresses = rawDerivedAddresses.map(addr => ({ ...addr, privateKeyWif: '' }))

  // Get contacts
  const contacts = await getContacts()

  return {
    version: 4,
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
 * Export essential data only — wallet keys + transaction data.
 * Enough to restore fully via a sync. No ordinal content cache.
 * This is the same as exportDatabase() — alias for clarity in UI.
 */
export async function exportDatabaseEssential(): Promise<DatabaseBackup> {
  return exportDatabase()
}

/**
 * Export full database including ordinal content cache.
 * Larger file but restores instantly without needing to re-fetch content.
 */
export async function exportDatabaseFull(): Promise<DatabaseBackup> {
  const backup = await exportDatabase()

  // Add ordinal cache with content
  const ordinalCache = await getCachedOrdinalsWithContent()
  backup.ordinalCache = ordinalCache

  return backup
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
    dbLogger.info(`Imported ${backup.derivedAddresses.length} derived addresses`)
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
    dbLogger.info(`Imported ${backup.contacts.length} contacts`)
  }

  // Import ordinal cache (if present - version 4+)
  if (backup.ordinalCache && backup.ordinalCache.length > 0) {
    await ensureOrdinalCacheTable()
    for (const cached of backup.ordinalCache) {
      await upsertOrdinalCache(cached)
      if (cached.contentData || cached.contentText) {
        await upsertOrdinalContent(cached.origin, cached.contentData, cached.contentText)
      }
    }
    dbLogger.info(`Imported ${backup.ordinalCache.length} cached ordinals`)
  }

  dbLogger.info('Database import complete')
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

  // Clear accounts and settings
  try {
    await database.execute('DELETE FROM account_settings')
  } catch (_e) {
    // Table may not exist yet
  }
  try {
    await database.execute('DELETE FROM accounts')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear derived addresses
  try {
    await database.execute('DELETE FROM derived_addresses')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear contacts
  try {
    await database.execute('DELETE FROM contacts')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear tokens
  try {
    await database.execute('DELETE FROM token_balances')
  } catch (_e) {
    // Table may not exist yet
  }
  try {
    await database.execute('DELETE FROM tokens')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear connected apps
  try {
    await database.execute('DELETE FROM connected_apps')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear certificates
  try {
    await database.execute('DELETE FROM certificates')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear audit log
  try {
    await database.execute('DELETE FROM audit_log')
  } catch (_e) {
    // Table may not exist yet
  }

  // Clear ordinal cache
  try {
    await database.execute('DELETE FROM ordinal_cache')
  } catch (_e) {
    // Table may not exist yet
  }

  dbLogger.info('Database cleared completely')
}

/**
 * Clear UTXOs and sync state only (keeps derived addresses, contacts, transactions)
 * Use this to force a fresh resync from blockchain
 */
export async function resetUTXOs(): Promise<void> {
  const database = getDatabase()

  dbLogger.debug('[DB] Resetting UTXOs and sync state...')
  await database.execute('DELETE FROM utxo_tags')
  await database.execute('DELETE FROM locks')
  await database.execute('DELETE FROM utxos')
  await database.execute('DELETE FROM sync_state')

  dbLogger.debug('[DB] UTXOs reset complete - ready for fresh sync')
}
