/**
 * Sync Repository
 *
 * Operations for tracking sync state per address.
 */

import { type Result, ok, err } from '../../domain/types'
import { DbError } from '../../services/errors'
import { getDatabase } from './connection'
import type { SyncStateRow } from './row-types'

/**
 * Get last synced height for an address
 */
export async function getLastSyncedHeight(address: string): Promise<Result<number, DbError>> {
  try {
    const database = getDatabase()
    const rows = await database.select<{ last_synced_height: number }[]>(
      'SELECT last_synced_height FROM sync_state WHERE address = $1',
      [address]
    )
    return ok(rows[0]?.last_synced_height ?? 0)
  } catch (e) {
    return err(new DbError(
      `getLastSyncedHeight failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Update sync state for an address
 */
export async function updateSyncState(address: string, height: number): Promise<Result<void, DbError>> {
  try {
    const database = getDatabase()
    await database.execute(
      `INSERT OR REPLACE INTO sync_state (address, last_synced_height, last_synced_at)
       VALUES ($1, $2, $3)`,
      [address, height, Date.now()]
    )
    return ok(undefined)
  } catch (e) {
    return err(new DbError(
      `updateSyncState failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}

/**
 * Get all sync states for export
 */
export async function getAllSyncStates(accountId?: number): Promise<Result<{ address: string; height: number; syncedAt: number }[], DbError>> {
  try {
    const database = getDatabase()
    let rows: SyncStateRow[]
    if (accountId !== undefined) {
      rows = await database.select<SyncStateRow[]>('SELECT * FROM sync_state WHERE account_id = $1', [accountId])
    } else {
      rows = await database.select<SyncStateRow[]>('SELECT * FROM sync_state')
    }
    return ok(rows.map(row => ({
      address: row.address,
      height: row.last_synced_height,
      syncedAt: row.last_synced_at
    })))
  } catch (e) {
    return err(new DbError(
      `getAllSyncStates failed: ${e instanceof Error ? e.message : String(e)}`,
      'QUERY_FAILED',
      e
    ))
  }
}
