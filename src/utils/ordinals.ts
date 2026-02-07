import { API } from '../config'

/**
 * Build a GorillaPool file URL from an inscription origin (outpoint).
 * The origin format is txid_vout (e.g., "abc123...def_0").
 * Returns undefined if origin is falsy.
 */
export function getOrdinalContentUrl(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  return `${API.GORILLAPOOL.BASE_URL}/files/inscriptions/${origin}`
}

/**
 * Returns true if the ordinal has an image content type.
 */
export function isImageOrdinal(contentType: string | undefined): boolean {
  return !!contentType && contentType.startsWith('image/')
}
