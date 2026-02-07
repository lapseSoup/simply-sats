import { API } from '../config'

/**
 * Build a GorillaPool content URL from an inscription file hash.
 * Returns undefined if hash is falsy.
 */
export function getOrdinalContentUrl(hash: string | undefined): string | undefined {
  if (!hash) return undefined
  return `${API.GORILLAPOOL.CONTENT_URL}/${hash}`
}

/**
 * Returns true if the ordinal has an image content type.
 */
export function isImageOrdinal(contentType: string | undefined): boolean {
  return !!contentType && contentType.startsWith('image/')
}
