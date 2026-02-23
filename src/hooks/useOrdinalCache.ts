/**
 * Hook for ordinal content caching: background caching and lazy content fetching.
 *
 * Extracted from SyncContext to reduce god-object complexity.
 */

import { useCallback, type MutableRefObject } from 'react'
import type { Ordinal } from '../services/wallet'
import {
  upsertOrdinalCache,
  markOrdinalTransferred,
  getCachedOrdinalContent,
  upsertOrdinalContent,
  hasOrdinalContent,
  getCachedOrdinals,
  ensureOrdinalCacheRowForTransferred,
  type CachedOrdinal
} from '../services/ordinalCache'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import { syncLogger } from '../services/logger'
import type { OrdinalContentEntry } from '../contexts/SyncContext'

/**
 * Background task: save ordinal metadata to DB and fetch missing content.
 * Non-blocking -- runs after ordinals are displayed to user.
 *
 * This is a standalone async function (not a hook) because it is called
 * imperatively from useSyncData's fetchData callback.
 */
export async function cacheOrdinalsInBackground(
  allOrdinals: Ordinal[],
  activeAccountId: number | null,
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>,
  setOrdinalContentCache: React.Dispatch<React.SetStateAction<Map<string, OrdinalContentEntry>>>,
  isCancelled: () => boolean,
  allApiCallsSucceeded: boolean
): Promise<void> {
  // Guard: don't cache ordinals without a valid account ID (prevents cross-account contamination)
  if (!activeAccountId) return

  try {
    // 1. Save metadata to DB
    if (isCancelled()) return
    const now = Date.now()
    for (const ord of allOrdinals) {
      if (isCancelled()) return
      const cached: CachedOrdinal = {
        origin: ord.origin,
        txid: ord.txid,
        vout: ord.vout,
        satoshis: ord.satoshis,
        contentType: ord.contentType,
        contentHash: ord.content,
        accountId: activeAccountId,
        fetchedAt: now,
        blockHeight: ord.blockHeight
      }
      await upsertOrdinalCache(cached)
    }
    syncLogger.debug('Cached ordinal metadata', { count: allOrdinals.length })

    // 1b. Mark transferred ordinals -- only when ALL API calls succeeded.
    // If any call failed, allOrdinals is a PARTIAL list and marking missing origins
    // as transferred would corrupt the cache (e.g. marking 619 of 620 as transferred
    // because only one address's API call succeeded). The next full sync will handle it.
    if (allApiCallsSucceeded) {
      if (isCancelled()) return
      const currentOrigins = new Set(allOrdinals.map(o => o.origin))
      const ownedCachedRows = await getCachedOrdinals(activeAccountId)
      for (const row of ownedCachedRows) {
        if (!currentOrigins.has(row.origin)) {
          await markOrdinalTransferred(row.origin)
          syncLogger.debug('Marked ordinal as transferred in cache', { origin: row.origin })
        }
      }
    } else {
      syncLogger.info('Skipping transfer marking -- not all ordinal API calls succeeded', {
        ordinalCount: allOrdinals.length
      })
    }

    // 2. Fetch missing content (up to 10 per cycle)
    if (isCancelled()) return
    const toFetch: Ordinal[] = []
    for (const ord of allOrdinals) {
      if (contentCacheRef.current.has(ord.origin)) continue
      const hasCached = await hasOrdinalContent(ord.origin)
      if (!hasCached) {
        toFetch.push(ord)
      }
      if (toFetch.length >= 10) break
    }

    if (toFetch.length === 0) return

    syncLogger.debug('Fetching ordinal content', { count: toFetch.length })

    let contentAdded = false
    for (const ord of toFetch) {
      if (isCancelled()) return
      const content = await fetchOrdinalContent(ord.origin, ord.contentType)
      if (content) {
        // Save to DB (also update content_type if resolved from response header)
        await upsertOrdinalContent(ord.origin, content.contentData, content.contentText, content.contentType)
        // Update in-memory cache
        contentCacheRef.current.set(ord.origin, content)
        contentAdded = true
      }
    }

    // Trigger a single re-render with all new content
    if (contentAdded) {
      setOrdinalContentCache(new Map(contentCacheRef.current))
      syncLogger.debug('Ordinal content fetched and cached', { fetched: toFetch.length })
    }
  } catch (e) {
    syncLogger.warn('Background ordinal caching failed (non-critical)', { error: String(e) })
  }
}

interface UseOrdinalCacheOptions {
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
  setOrdinalContentCache: React.Dispatch<React.SetStateAction<Map<string, OrdinalContentEntry>>>
}

interface UseOrdinalCacheReturn {
  /**
   * Fetch and cache ordinal content if not already in the in-memory cache.
   * Used by ActivityTab to lazily load thumbnails for transferred ordinals
   * that are missing from the cache after a fresh seed restore.
   */
  fetchOrdinalContentIfMissing: (origin: string, contentType?: string, accountId?: number) => Promise<void>
}

export function useOrdinalCache({
  contentCacheRef,
  setOrdinalContentCache
}: UseOrdinalCacheOptions): UseOrdinalCacheReturn {

  // Lazily fetch ordinal content for transferred ordinals missing from the cache.
  // Called by ActivityTab when displaying transfer history items after a fresh restore
  // where ordinal_cache may be empty (content was never fetched for the new wallet).
  const fetchOrdinalContentIfMissing = useCallback(async (origin: string, contentType?: string, accountId?: number) => {
    if (contentCacheRef.current.has(origin)) return  // already in memory

    try {
      // Check if content exists in DB first (cheapest path)
      const hasCached = await hasOrdinalContent(origin)
      if (hasCached) {
        const content = await getCachedOrdinalContent(origin)
        if (content && (content.contentData || content.contentText)) {
          contentCacheRef.current.set(origin, content)
          setOrdinalContentCache(new Map(contentCacheRef.current))
        }
        return
      }

      // Fetch from API (GorillaPool)
      const content = await fetchOrdinalContent(origin, contentType)
      if (content) {
        // Ensure a row exists with the correct account_id so it's found by
        // account-scoped DB queries on subsequent launches.
        await ensureOrdinalCacheRowForTransferred(origin, accountId)
        await upsertOrdinalContent(origin, content.contentData, content.contentText, content.contentType)
        contentCacheRef.current.set(origin, content)
        setOrdinalContentCache(new Map(contentCacheRef.current))
        syncLogger.debug('Fetched transferred ordinal content', { origin })
      }
    } catch (e) {
      syncLogger.warn('fetchOrdinalContentIfMissing failed (non-critical)', { origin, error: String(e) })
    }
  }, [contentCacheRef, setOrdinalContentCache])

  return { fetchOrdinalContentIfMissing }
}
