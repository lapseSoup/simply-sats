/**
 * Build a GorillaPool content URL from an inscription origin (outpoint).
 * The origin format is txid_vout (e.g., "abc123...def_0").
 * Returns undefined if origin is falsy.
 */
export function getOrdinalContentUrl(origin: string | undefined): string | undefined {
  if (!origin) return undefined
  return `https://ordinals.gorillapool.io/content/${origin}`
}

/**
 * Returns true if the ordinal has an image content type.
 */
export function isImageOrdinal(contentType: string | undefined): boolean {
  return !!contentType && contentType.startsWith('image/')
}
