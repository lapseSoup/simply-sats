/**
 * Ordinal Content Fetcher
 *
 * Fetches actual content (images, text, JSON) from GorillaPool
 * for caching in the local database. Non-blocking — failures
 * are silently ignored since content can always be re-fetched.
 */

import { syncLogger } from '../logger'
import { gpOrdinalsApi } from '../../infrastructure/api/clients'

/**
 * Fetch ordinal content from GorillaPool.
 *
 * For text/* and application/json: returns contentText (string)
 * For image/* and other binary: returns contentData (Uint8Array)
 *
 * Returns null on failure (non-blocking).
 */
export async function fetchOrdinalContent(
  origin: string,
  contentType?: string
): Promise<{ contentData?: Uint8Array; contentText?: string } | null> {
  try {
    const result = await gpOrdinalsApi.fetch(`/content/${origin}`)

    if (!result.ok) {
      syncLogger.debug(`[OrdinalContent] Failed to fetch ${origin}: ${result.error.message}`)
      return null
    }

    const response = result.value
    if (!response.ok) {
      syncLogger.debug(`[OrdinalContent] Failed to fetch ${origin}: ${response.status}`)
      return null
    }

    const isText = contentType?.startsWith('text/') || contentType?.includes('json')

    if (isText) {
      const text = await response.text()
      return { contentText: text }
    } else {
      const buffer = await response.arrayBuffer()
      return { contentData: new Uint8Array(buffer) }
    }
  } catch (e) {
    syncLogger.debug(`[OrdinalContent] Error fetching ${origin}: ${e}`)
    return null
  }
}

/**
 * Batch fetch ordinal content for multiple ordinals.
 * Fetches up to `batchSize` in parallel, returns results as a Map.
 */
export async function batchFetchOrdinalContent(
  ordinals: { origin: string; contentType?: string }[],
  batchSize = 10
): Promise<Map<string, { contentData?: Uint8Array; contentText?: string }>> {
  const results = new Map<string, { contentData?: Uint8Array; contentText?: string }>()

  // Process in batches
  for (let i = 0; i < ordinals.length; i += batchSize) {
    const batch = ordinals.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(async (ord) => {
        const content = await fetchOrdinalContent(ord.origin, ord.contentType)
        if (content) {
          results.set(ord.origin, content)
        }
      })
    )

    // Log any failures
    const failures = batchResults.filter(r => r.status === 'rejected').length
    if (failures > 0) {
      syncLogger.debug(`[OrdinalContent] ${failures}/${batch.length} failed in batch ${Math.floor(i / batchSize) + 1}`)
    }
  }

  return results
}
