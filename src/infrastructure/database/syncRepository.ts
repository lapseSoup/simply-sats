/**
 * Sync Repository
 *
 * Operations for tracking sync state per address.
 */

import { getDatabase } from './connection'
import type { SyncStateRow } from '../../services/database-types'

/**
 * Get last synced height for an address
 */
export async function getLastSyncedHeight(address: string): Promise<number> {
  const database = getDatabase()

  const result = await database.select<{last_synced_height: number}[]>(
    'SELECT last_synced_height FROM sync_state WHERE address = $1',
    [address]
  )

  return result[0]?.last_synced_height || 0
}

/**
 * Update sync state for an address
 */
export async function updateSyncState(address: string, height: number): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO sync_state (address, last_synced_height, last_synced_at)
     VALUES ($1, $2, $3)`,
    [address, height, Date.now()]
  )
}

/**
 * Get all sync states for export
 */
export async function getAllSyncStates(accountId?: number): Promise<{ address: string; height: number; syncedAt: number }[]> {
  const database = getDatabase()

  let rows: SyncStateRow[]
  if (accountId !== undefined) {
    rows = await database.select<SyncStateRow[]>('SELECT * FROM sync_state WHERE account_id = $1', [accountId])
  } else {
    rows = await database.select<SyncStateRow[]>('SELECT * FROM sync_state')
  }

  return rows.map(row => ({
    address: row.address,
    height: row.last_synced_height,
    syncedAt: row.last_synced_at
  }))
}
