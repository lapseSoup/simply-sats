/**
 * Ordinal Cache Repository
 *
 * CRUD operations for cached ordinal content.
 * Stores ordinal metadata and fetched content (images, text, JSON)
 * in the ordinal_cache table for instant display and offline access.
 */

import { getDatabase } from './connection'
import { dbLogger } from '../../services/logger'
import type { CachedOrdinal } from './types'
import type { OrdinalCacheRow, OrdinalCacheStatsRow } from './row-types'

/**
 * Parse content_data from the DB into a Uint8Array.
 * Tauri's sql plugin stores Array.from(Uint8Array) params as a JSON text string
 * ("[137,80,78,71,...]") rather than a true BLOB.  This helper handles both the
 * string format (existing rows) and a real ArrayBuffer (future-proof).
 */
function parseContentData(raw: ArrayBuffer | string | null | undefined): Uint8Array | undefined {
  if (!raw) return undefined
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as number[]
      return new Uint8Array(parsed)
    } catch {
      return undefined
    }
  }
  // Real ArrayBuffer path — slice to detach from any shared backing buffer
  const arr = new Uint8Array(raw)
  return new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength))
}

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
 * Get OWNED cached ordinals (transferred = 0, metadata only, no content blobs).
 * Used for the active ordinals inventory count and list.
 */
export async function getCachedOrdinals(accountId?: number): Promise<CachedOrdinal[]> {
  const database = getDatabase()

  try {
    const query = accountId !== undefined
      ? 'SELECT id, origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at, block_height FROM ordinal_cache WHERE account_id = $1 AND transferred = 0 ORDER BY fetched_at DESC'
      : 'SELECT id, origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at, block_height FROM ordinal_cache WHERE transferred = 0 ORDER BY fetched_at DESC'
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
      fetchedAt: row.fetched_at,
      blockHeight: row.block_height ?? undefined
    }))
  } catch (_e) {
    // Table may not exist yet
    return []
  }
}

/**
 * Get ALL cached ordinal origins for an account, including transferred ones.
 * Used to populate the in-memory content cache for activity tab thumbnails.
 * Returns only origins (not full content blobs) for efficiency.
 */
export async function getAllCachedOrdinalOrigins(accountId?: number): Promise<string[]> {
  const database = getDatabase()

  try {
    const query = accountId !== undefined
      ? 'SELECT origin FROM ordinal_cache WHERE account_id = $1 ORDER BY fetched_at DESC'
      : 'SELECT origin FROM ordinal_cache ORDER BY fetched_at DESC'
    const params = accountId !== undefined ? [accountId] : []
    const rows = await database.select<{ origin: string }[]>(query, params)
    return rows.map(r => r.origin)
  } catch (_e) {
    return []
  }
}

/**
 * Mark an ordinal as transferred out (keeps the row for historical display).
 * Call this immediately after a successful ordinal transfer broadcast.
 */
export async function markOrdinalTransferred(origin: string): Promise<void> {
  const database = getDatabase()
  await database.execute('UPDATE ordinal_cache SET transferred = 1 WHERE origin = $1', [origin])
}

/**
 * Get cached content for a specific ordinal
 */
export async function getCachedOrdinalContent(origin: string): Promise<{ contentData?: Uint8Array; contentText?: string; contentType?: string } | null> {
  const database = getDatabase()

  try {
    const rows = await database.select<Pick<OrdinalCacheRow, 'content_data' | 'content_text' | 'content_type'>[]>(
      'SELECT content_data, content_text, content_type FROM ordinal_cache WHERE origin = $1',
      [origin]
    )

    if (rows.length === 0) return null

    const row = rows[0]!
    return {
      contentData: parseContentData(row.content_data),
      contentText: row.content_text ?? undefined,
      contentType: row.content_type ?? undefined
    }
  } catch (_e) {
    return null
  }
}

/**
 * Ensure a minimal ordinal_cache row exists for a transferred ordinal.
 * Inserts a placeholder row (transferred=1) if none exists yet, so that
 * fetched content can be stored for historical activity tab display.
 * Safe to call multiple times — INSERT OR IGNORE is a no-op if row exists.
 */
export async function ensureOrdinalCacheRowForTransferred(
  origin: string,
  accountId?: number
): Promise<void> {
  const database = getDatabase()
  const parts = origin.split('_')
  const txid = parts.slice(0, -1).join('_')
  const vout = parseInt(parts[parts.length - 1] ?? '0', 10)
  try {
    await database.execute(
      `INSERT INTO ordinal_cache (origin, txid, vout, satoshis, transferred, account_id, fetched_at)
       VALUES ($1, $2, $3, 1, 1, $4, $5)
       ON CONFLICT(origin) DO UPDATE SET
         account_id = COALESCE(excluded.account_id, ordinal_cache.account_id),
         transferred = 1,
         fetched_at = excluded.fetched_at`,
      [origin, txid || origin, vout, accountId ?? null, Date.now()]
    )
  } catch (_e) {
    // Non-fatal — row may already exist or table may not exist yet
  }
}

/**
 * Insert or update ordinal cache entry (metadata only)
 */
export async function upsertOrdinalCache(ordinal: CachedOrdinal): Promise<void> {
  const database = getDatabase()

  await database.execute(
    `INSERT OR REPLACE INTO ordinal_cache (origin, txid, vout, satoshis, content_type, content_hash, account_id, fetched_at, block_height)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ordinal.origin,
      ordinal.txid,
      ordinal.vout,
      ordinal.satoshis,
      ordinal.contentType || null,
      ordinal.contentHash || null,
      ordinal.accountId || null,
      ordinal.fetchedAt,
      ordinal.blockHeight ?? null
    ]
  )
}

/**
 * Store fetched content for an ordinal (also updates content_type if provided)
 */
export async function upsertOrdinalContent(
  origin: string,
  contentData?: Uint8Array,
  contentText?: string,
  contentType?: string
): Promise<void> {
  const database = getDatabase()

  if (contentType) {
    await database.execute(
      'UPDATE ordinal_cache SET content_data = $1, content_text = $2, content_type = $3 WHERE origin = $4',
      [contentData ? Array.from(contentData) : null, contentText || null, contentType, origin]
    )
  } else {
    await database.execute(
      'UPDATE ordinal_cache SET content_data = $1, content_text = $2 WHERE origin = $3',
      [contentData ? Array.from(contentData) : null, contentText || null, origin]
    )
  }
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
      contentData: parseContentData(row.content_data),
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
        contentData: parseContentData(row.content_data)!,
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
