import { useCallback, type MutableRefObject } from 'react'
import type { Ordinal } from '../domain/types'
import type { OrdinalContentEntry } from '../contexts/SyncContext'
import type { CachedOrdinal } from '../services/ordinalCache'
import {
  batchUpsertOrdinalCache,
  ensureOrdinalCacheRowForTransferred,
  getCachedOrdinalContent,
  getCachedOrdinals,
  hasOrdinalContent,
  markOrdinalTransferred,
  upsertOrdinalContent,
} from '../services/ordinalCache'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import { syncLogger } from '../services/logger'

interface UseOrdinalCacheOptions {
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
  bumpCacheVersion: () => void
}

function toCachedOrdinal(ordinal: Ordinal, accountId: number): CachedOrdinal {
  return {
    origin: ordinal.origin,
    txid: ordinal.txid,
    vout: ordinal.vout,
    satoshis: ordinal.satoshis,
    contentType: ordinal.contentType,
    contentHash: ordinal.content,
    accountId,
    fetchedAt: Date.now(),
    blockHeight: ordinal.blockHeight,
  }
}

function hasRenderableContent(entry: { contentData?: Uint8Array; contentText?: string; contentType?: string } | null): entry is OrdinalContentEntry {
  return !!entry && (!!entry.contentData || !!entry.contentText)
}

export async function cacheOrdinalsInBackground(
  ordinals: Ordinal[],
  activeAccountId: number | null,
  contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>,
  bumpCacheVersion: () => void,
  isCancelled: () => boolean,
  allOrdinalApiCallsSucceeded: boolean
): Promise<void> {
  if (!activeAccountId) return

  try {
    if (isCancelled()) return

    await batchUpsertOrdinalCache(ordinals.map(ordinal => toCachedOrdinal(ordinal, activeAccountId)))

    if (isCancelled()) return

    if (allOrdinalApiCallsSucceeded) {
      const cachedOrdinals = await getCachedOrdinals(activeAccountId)
      const currentOrigins = new Set(ordinals.map(ordinal => ordinal.origin))
      for (const cached of cachedOrdinals) {
        if (!currentOrigins.has(cached.origin)) {
          await markOrdinalTransferred(cached.origin)
        }
      }
    }

    let fetchedAnyContent = false
    let fetchCount = 0

    for (const ordinal of ordinals) {
      if (fetchCount >= 50) break
      if (!ordinal.origin || contentCacheRef.current.has(ordinal.origin)) continue

      let existsInDb = false
      try {
        existsInDb = await hasOrdinalContent(ordinal.origin)
      } catch (error) {
        syncLogger.warn('Failed to check ordinal content presence during background cache', {
          origin: ordinal.origin,
          error: String(error)
        })
        continue
      }

      if (existsInDb) continue

      const content = await fetchOrdinalContent(ordinal.origin, ordinal.contentType)
      fetchCount++

      if (!hasRenderableContent(content)) continue

      await upsertOrdinalContent(
        ordinal.origin,
        content.contentData,
        content.contentText,
        content.contentType
      )
      contentCacheRef.current.set(ordinal.origin, content)
      fetchedAnyContent = true
    }

    if (fetchedAnyContent) {
      bumpCacheVersion()
    }
  } catch (error) {
    syncLogger.warn('Background ordinal cache update failed', { error: String(error) })
  }
}

export function useOrdinalCache({ contentCacheRef, bumpCacheVersion }: UseOrdinalCacheOptions) {
  const fetchOrdinalContentIfMissing = useCallback(async (
    origin: string,
    contentType?: string,
    accountId?: number
  ): Promise<void> => {
    if (!origin || contentCacheRef.current.has(origin)) return

    try {
      const existsInDb = await hasOrdinalContent(origin)
      if (existsInDb) {
        const cached = await getCachedOrdinalContent(origin)
        if (hasRenderableContent(cached)) {
          contentCacheRef.current.set(origin, cached)
          bumpCacheVersion()
        }
        return
      }

      const content = await fetchOrdinalContent(origin, contentType)
      if (!hasRenderableContent(content)) return

      if (accountId !== undefined) {
        await ensureOrdinalCacheRowForTransferred(origin, accountId)
      }
      await upsertOrdinalContent(origin, content.contentData, content.contentText, content.contentType)
      contentCacheRef.current.set(origin, content)
      bumpCacheVersion()
    } catch (error) {
      syncLogger.warn('Failed to fetch ordinal content on demand', {
        origin,
        error: String(error)
      })
    }
  }, [contentCacheRef, bumpCacheVersion])

  return {
    fetchOrdinalContentIfMissing,
  }
}
