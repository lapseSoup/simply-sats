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
): Promise<{ contentData?: Uint8Array; contentText?: string; contentType?: string } | null> {
  try {
    const result = await gpOrdinalsApi.fetch(`/content/${origin}`)

    if (!result.ok) {
      syncLogger.debug(`[OrdinalContent] Failed to fetch ${origin}: ${result.error.message}`)
      return null
    }

    let response = result.value

    // If the outpoint isn't an inscription origin (404), resolve the real
    // inscription origin via the txos endpoint and retry.  This happens for
    // transferred ordinals where sync.ts stores the spending outpoint in the
    // tx description rather than the inscription origin.
    if (!response.ok) {
      const inscriptionOrigin = await resolveInscriptionOrigin(origin)
      if (!inscriptionOrigin || inscriptionOrigin === origin) {
        syncLogger.debug(`[OrdinalContent] Failed to fetch ${origin}: ${response.status}`)
        return null
      }
      const retry = await gpOrdinalsApi.fetch(`/content/${inscriptionOrigin}`)
      if (!retry.ok || !retry.value.ok) {
        syncLogger.debug(`[OrdinalContent] Failed to fetch resolved origin ${inscriptionOrigin}: ${retry.ok ? retry.value.status : retry.error.message}`)
        return null
      }
      response = retry.value
      syncLogger.debug(`[OrdinalContent] Resolved ${origin} → inscription origin ${inscriptionOrigin}`)
    }

    // Read actual content-type from response header — use it when caller didn't know it
    const resolvedContentType = response.headers.get('content-type')?.split(';')[0]?.trim() || contentType

    const isText = resolvedContentType?.startsWith('text/') || resolvedContentType?.includes('json')

    if (isText) {
      const text = await response.text()
      return { contentText: text, contentType: resolvedContentType }
    } else {
      const buffer = await response.arrayBuffer()
      return { contentData: new Uint8Array(buffer), contentType: resolvedContentType }
    }
  } catch (e) {
    syncLogger.debug(`[OrdinalContent] Error fetching ${origin}: ${e}`)
    return null
  }
}

/**
 * Resolve the inscription origin for a given outpoint.
 * GorillaPool's /content/ endpoint requires the inscription origin, not
 * the current outpoint.  The /api/txos/ endpoint returns the inscription
 * origin in its response.
 */
async function resolveInscriptionOrigin(outpoint: string): Promise<string | null> {
  try {
    const result = await gpOrdinalsApi.get<{ origin?: { outpoint?: string } }>(`/api/txos/${outpoint}`, { noRetry: true })
    if (!result.ok) return null
    return result.value?.origin?.outpoint ?? null
  } catch {
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
