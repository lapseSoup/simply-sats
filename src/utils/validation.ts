/**
 * Validate that a string is a properly formatted origin URL
 */
export function isValidOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') {
    return false
  }
  try {
    const url = new URL(origin)
    const reconstructed = `${url.protocol}//${url.host}`
    if (origin !== reconstructed) {
      return false
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    if (!url.hostname) {
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Normalize an origin URL
 */
export function normalizeOrigin(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.host}`
}
