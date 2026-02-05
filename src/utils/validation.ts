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
 * Normalize URL by stripping default ports (443 for HTTPS, 80 for HTTP)
 */
function normalizeOriginUrl(url: URL): string {
  const port = url.port
  const isDefaultPort =
    (url.protocol === 'https:' && (port === '443' || port === '')) ||
    (url.protocol === 'http:' && (port === '80' || port === ''))

  // Reconstruct without port if it's the default
  if (isDefaultPort || !port) {
    return `${url.protocol}//${url.hostname}`
  }
  return `${url.protocol}//${url.hostname}:${port}`
}

/**
 * Check if hostname is valid (not empty, not just dots, etc.)
 */
function isValidHostname(hostname: string): boolean {
  if (!hostname) return false
  if (hostname === '.') return false
  if (hostname.startsWith('.')) return false
  if (hostname.endsWith('.') && hostname !== 'localhost.') return false
  // Check for multiple consecutive dots
  if (hostname.includes('..')) return false
  return true
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

    // Must have a valid hostname
    if (!isValidHostname(url.hostname)) {
      return false
    }

    // Reject if URL has query string or hash (origins should not have these)
    if (url.search || url.hash) {
      return false
    }

    // Reject if URL has a path other than just "/"
    // The URL parser adds "/" as default, so we check if there's more than that
    if (url.pathname !== '/') {
      return false
    }

    // Also check the original string doesn't have a trailing slash or path
    // e.g., "https://example.com/path" should fail even though URL() parses it
    const afterHost = origin.replace(/^[a-zA-Z]+:\/\/[^/]+/, '')
    if (afterHost.length > 0 && afterHost !== '') {
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

    if (!isValidHostname(url.hostname)) {
      return 'Origin must have a valid hostname'
    }

    // Reject query strings, hash, or paths
    if (url.search || url.hash || url.pathname !== '/') {
      return 'Origin must be protocol + host only (no path or query)'
    }

    // Also check the original string doesn't have a trailing slash or path
    const afterHost = origin.replace(/^[a-zA-Z]+:\/\/[^/]+/, '')
    if (afterHost.length > 0 && afterHost !== '') {
      return 'Origin must be protocol + host only (no path or query)'
    }

    // Check protocol before path check
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Only HTTP and HTTPS protocols are allowed'
    }

    if (url.protocol === 'http:' && !isLocalhost(url.hostname)) {
      return 'HTTP is only allowed for localhost. Use HTTPS for remote origins.'
    }

    return null
  } catch {
    return 'Invalid URL format'
  }
}

/**
 * Normalize an origin URL (strips default ports)
 */
export function normalizeOrigin(origin: string): string {
  const url = new URL(origin)
  return normalizeOriginUrl(url)
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
