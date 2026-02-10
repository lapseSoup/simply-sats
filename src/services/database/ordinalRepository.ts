/**
 * Ordinal Cache Repository
 *
 * CRUD operations for cached ordinal content.
 * Stores ordinal metadata and fetched content (images, text, JSON)
 * in the ordinal_cache table for instant display and offline access.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../logger'
import type { CachedOrdinal } from './types'
import type { OrdinalCacheRow, OrdinalCacheStatsRow } from '../database-types'

/**
 * Ensure ordinal_cache table exists (for imports/upgrades)
 */
export async function ensureOrdinalCacheTable(): Promise<void> {
  const database = getDatabase()

  try {
    await database.execute(`
      CREATE TABLE IF NOT EXISTS ordinal_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL UNIQUE,
        txid TEXT NOT NULL,
        vout INTEGER NOT NULL,
        satoshis INTEGER NOT NULL DEFAULT 1,
        content_type TEXT,
        content_hash TEXT,
        content_data BLOB,
        content_text TEXT,
        account_id INTEGER,
        fetched_at INTEGER NOT NULL
      )
    `)
    await database.execute('CREATE INDEX IF NOT EXISTS idx_ordinal_cache_origin ON ordinal_cache(origin)')
    await database.execute('CREATE INDEX IF NOT EXISTS idx_ordinal_cache_account ON ordinal_cache(account_id)')
  } catch (e) {
    dbLogger.error('Failed to ensure ordinal_cache table:', e)
  }
}

/**
 * Get all cached ordinals (metadata only, no content blobs)
 */
export async function getCachedOrdinals(accountId?: number): Promise<CachedOrdinal[]> {
  const database = getDatabase()

  try {
    const query = accountId !== undefined
      ? 'SELECT id, origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at FROM ordinal_cache WHERE account_id = $1 ORDER BY fetched_at DESC'
      : 'SELECT id, origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at FROM ordinal_cache ORDER BY fetched_at DESC'
    const params = accountId !== undefined ? [accountId] : []

    const rows = await database.select<Omit<OrdinalCacheRow, 'content_data' | 'content_text'>[]>(query, params)

    return rows.map(row => ({
      id: row.id,
      origin: row.origin,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      contentType: row.content_type ?? undefined,
      contentHash: row.content_hash ?? undefined,
      accountId: row.account_id ?? undefined,
      fetchedAt: row.fetched_at
    }))
  } catch (_e) {
    // Table may not exist yet
    return []
  }
}

/**
 * Get cached content for a specific ordinal
 */
export async function getCachedOrdinalContent(origin: string): Promise<{ contentData?: Uint8Array; contentText?: string } | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<Pick<OrdinalCacheRow, 'content_data' | 'content_text'>[]>(
      'SELECT content_data, content_text FROM ordinal_cache WHERE origin = $1',
      [origin]
    )

    if (rows.length === 0) return null

    const row = rows[0]!
    return {
      contentData: row.content_data ? new Uint8Array(row.content_data) : undefined,
      contentText: row.content_text ?? undefined
    }
  } catch (_e) {
    return null
  }
}

/**
 * Insert or update ordinal cache entry (metadata only)
 */
export async function upsertOrdinalCache(ordinal: CachedOrdinal): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO ordinal_cache (origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ordinal.origin,
      ordinal.txid,
      ordinal.vout,
      ordinal.satoshis,
      ordinal.contentType || null,
      ordinal.contentHash || null,
      ordinal.accountId || null,
      ordinal.fetchedAt
    ]
  )
}

/**
 * Store fetched content for an ordinal
 */
export async function upsertOrdinalContent(
  origin: string,
  contentData?: Uint8Array,
  contentText?: string
): Promise<void> {
  const database = getDatabase()

  await database.execute(
    'UPDATE ordinal_cache SET content_data = $1, content_text = $2 WHERE origin = $3',
    [contentData ? Array.from(contentData) : null, contentText || null, origin]
  )
}

/**
 * Check if an ordinal has cached content
 */
export async function hasOrdinalContent(origin: string): Promise<boolean> {
  const database = getDatabase()

  try {
    const rows = await database.select<{ has_content: number }[]>(
      'SELECT (content_data IS NOT NULL OR content_text IS NOT NULL) as has_content FROM ordinal_cache WHERE origin = $1',
      [origin]
    )
    return rows.length > 0 && rows[0]!.has_content === 1
  } catch (_e) {
    return false
  }
}

/**
 * Get all cached ordinals with content (for full backup export)
 */
export async function getCachedOrdinalsWithContent(accountId?: number): Promise<CachedOrdinal[]> {
  const database = getDatabase()

  try {
    const query = accountId !== undefined
      ? 'SELECT * FROM ordinal_cache WHERE account_id = $1 ORDER BY fetched_at DESC'
      : 'SELECT * FROM ordinal_cache ORDER BY fetched_at DESC'
    const params = accountId !== undefined ? [accountId] : []

    const rows = await database.select<OrdinalCacheRow[]>(query, params)

    return rows.map(row => ({
      id: row.id,
      origin: row.origin,
      txid: row.txid,
      vout: row.vout,
      satoshis: row.satoshis,
      contentType: row.content_type ?? undefined,
      contentHash: row.content_hash ?? undefined,
      contentData: row.content_data ? new Uint8Array(row.content_data) : undefined,
      contentText: row.content_text ?? undefined,
      accountId: row.account_id ?? undefined,
      fetchedAt: row.fetched_at
    }))
  } catch (_e) {
    return []
  }
}

/**
 * Get cache statistics
 */
export async function getOrdinalCacheStats(accountId?: number): Promise<{
  totalBytes: number
  ordinalCount: number
  imageCount: number
  textCount: number
}> {
  const database = getDatabase()

  try {
    const baseWhere = accountId !== undefined ? 'WHERE account_id = $1' : ''
    const params = accountId !== undefined ? [accountId] : []

    const [countRows, imageRows, textRows] = await Promise.all([
      database.select<OrdinalCacheStatsRow[]>(
        `SELECT COUNT(*) as count, COALESCE(SUM(LENGTH(content_data) + LENGTH(COALESCE(content_text, ''))), 0) as total_size FROM ordinal_cache ${baseWhere}`,
        params
      ),
      database.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM ordinal_cache ${baseWhere ? baseWhere + ' AND' : 'WHERE'} content_type LIKE 'image/%'`,
        params
      ),
      database.select<{ count: number }[]>(
        `SELECT COUNT(*) as count FROM ordinal_cache ${baseWhere ? baseWhere + ' AND' : 'WHERE'} (content_type LIKE 'text/%' OR content_type LIKE '%json%')`,
        params
      )
    ])

    return {
      totalBytes: countRows[0]?.total_size || 0,
      ordinalCount: countRows[0]?.count || 0,
      imageCount: imageRows[0]?.count || 0,
      textCount: textRows[0]?.count || 0
    }
  } catch (_e) {
    return { totalBytes: 0, ordinalCount: 0, imageCount: 0, textCount: 0 }
  }
}

/**
 * Clear all cached content (keeps metadata)
 */
export async function clearOrdinalContentAll(): Promise<void> {
  const database = getDatabase()
  await database.execute('UPDATE ordinal_cache SET content_data = NULL, content_text = NULL')
}

/**
 * Clear cached image content only
 */
export async function clearOrdinalImageContent(): Promise<void> {
  const database = getDatabase()
  await database.execute("UPDATE ordinal_cache SET content_data = NULL WHERE content_type LIKE 'image/%'")
}

/**
 * Update content data for a specific ordinal (for resize operations)
 */
export async function updateOrdinalContentData(origin: string, contentData: Uint8Array | null): Promise<void> {
  const database = getDatabase()
  await database.execute(
    'UPDATE ordinal_cache SET content_data = $1 WHERE origin = $2',
    [contentData ? Array.from(contentData) : null, origin]
  )
}

/**
 * Get all image ordinals with content (for resize operations)
 */
export async function getImageOrdinalsWithContent(): Promise<{ origin: string; contentData: Uint8Array; contentType: string }[]> {
  const database = getDatabase()

  try {
    const rows = await database.select<Pick<OrdinalCacheRow, 'origin' | 'content_data' | 'content_type'>[]>(
      "SELECT origin, content_data, content_type FROM ordinal_cache WHERE content_data IS NOT NULL AND content_type LIKE 'image/%'"
    )

    return rows
      .filter(row => row.content_data !== null)
      .map(row => ({
        origin: row.origin,
        contentData: new Uint8Array(row.content_data!),
        contentType: row.content_type!
      }))
  } catch (_e) {
    return []
  }
}

/**
 * Clear entire ordinal cache for an account
 */
export async function clearOrdinalCache(accountId?: number): Promise<void> {
  const database = getDatabase()

  if (accountId !== undefined) {
    await database.execute('DELETE FROM ordinal_cache WHERE account_id = $1', [accountId])
  } else {
    await database.execute('DELETE FROM ordinal_cache')
  }
}
