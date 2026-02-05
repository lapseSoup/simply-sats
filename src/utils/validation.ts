/**
 * Origin Validation Utilities
 *
 * Validates and normalizes origin URLs for trusted app management.
 * Security: Only HTTPS origins are allowed except for localhost (development).
 *
 * @module utils/validation
 */

/**
 * Check if hostname is localhost (for development exceptions)
 */
function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  )
}

/**
 * Validate that a string is a properly formatted origin URL
 *
 * Security requirements:
 * - Must be a valid URL
 * - Must use HTTPS protocol (HTTP only allowed for localhost)
 * - Must have a hostname
 * - Must match reconstructed origin (no path/query injection)
 */
export function isValidOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') {
    return false
  }
  try {
    const url = new URL(origin)

    // Verify origin format (protocol + host only, no path)
    const reconstructed = `${url.protocol}//${url.host}`
    if (origin !== reconstructed) {
      return false
    }

    // Must have a hostname
    if (!url.hostname) {
      return false
    }

    // Security: Require HTTPS except for localhost
    if (url.protocol === 'http:') {
      // Only allow HTTP for localhost (development)
      if (!isLocalhost(url.hostname)) {
        return false
      }
    } else if (url.protocol !== 'https:') {
      // Reject non-HTTP(S) protocols
      return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Validate origin with detailed error message
 * Returns null if valid, error message if invalid
 */
export function validateOriginWithReason(origin: string): string | null {
  if (!origin || typeof origin !== 'string') {
    return 'Origin is required'
  }

  try {
    const url = new URL(origin)

    const reconstructed = `${url.protocol}//${url.host}`
    if (origin !== reconstructed) {
      return 'Origin must be protocol + host only (no path or query)'
    }

    if (!url.hostname) {
      return 'Origin must have a hostname'
    }

    if (url.protocol === 'http:' && !isLocalhost(url.hostname)) {
      return 'HTTP is only allowed for localhost. Use HTTPS for remote origins.'
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Only HTTP and HTTPS protocols are allowed'
    }

    return null
  } catch {
    return 'Invalid URL format'
  }
}

/**
 * Normalize an origin URL
 */
export function normalizeOrigin(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.host}`
}

/**
 * Check if an origin is considered secure
 * (HTTPS or localhost)
 */
export function isSecureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || isLocalhost(url.hostname)
  } catch {
    return false
  }
}
