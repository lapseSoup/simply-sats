/**
 * Origin Validation Tests
 *
 * Tests for security-critical origin validation logic.
 */

import { describe, it, expect } from 'vitest'
import {
  isValidOrigin,
  normalizeOrigin,
  validateOriginWithReason,
  isSecureOrigin
} from './validation'

describe('isValidOrigin', () => {
  // Valid HTTPS origins
  describe('HTTPS origins', () => {
    it('accepts valid HTTPS origins', () => {
      expect(isValidOrigin('https://example.com')).toBe(true)
      expect(isValidOrigin('https://app.example.com')).toBe(true)
      expect(isValidOrigin('https://example.com:443')).toBe(true)
      expect(isValidOrigin('https://example.com:8443')).toBe(true)
    })
  })

  // Valid localhost origins (development)
  describe('localhost origins', () => {
    it('accepts HTTP localhost origins', () => {
      expect(isValidOrigin('http://localhost')).toBe(true)
      expect(isValidOrigin('http://localhost:3000')).toBe(true)
      expect(isValidOrigin('http://127.0.0.1')).toBe(true)
      expect(isValidOrigin('http://127.0.0.1:8080')).toBe(true)
    })

    it('accepts HTTPS localhost origins', () => {
      expect(isValidOrigin('https://localhost')).toBe(true)
      expect(isValidOrigin('https://localhost:3000')).toBe(true)
    })
  })

  // Security: Reject HTTP for non-localhost (MITM risk)
  describe('HTTP security restrictions', () => {
    it('rejects HTTP origins for non-localhost', () => {
      expect(isValidOrigin('http://example.com')).toBe(false)
      expect(isValidOrigin('http://app.example.com')).toBe(false)
      expect(isValidOrigin('http://192.168.1.1')).toBe(false)
      expect(isValidOrigin('http://10.0.0.1')).toBe(false)
    })
  })

  // Reject invalid protocols
  describe('protocol restrictions', () => {
    it('rejects non-HTTP(S) protocols', () => {
      expect(isValidOrigin('ftp://example.com')).toBe(false)
      expect(isValidOrigin('file:///path/to/file')).toBe(false)
      expect(isValidOrigin('javascript:alert(1)')).toBe(false)
      expect(isValidOrigin('data:text/html,<h1>Hi</h1>')).toBe(false)
    })
  })

  // Reject origins with paths (path injection prevention)
  describe('path restrictions', () => {
    it('rejects origins with paths', () => {
      expect(isValidOrigin('https://example.com/path')).toBe(false)
      expect(isValidOrigin('https://example.com/path/to/resource')).toBe(false)
      expect(isValidOrigin('http://localhost:3000/api')).toBe(false)
    })

    it('rejects origins with query strings', () => {
      expect(isValidOrigin('https://example.com?foo=bar')).toBe(false)
      expect(isValidOrigin('https://example.com/?foo=bar')).toBe(false)
    })

    it('rejects origins with fragments', () => {
      expect(isValidOrigin('https://example.com#section')).toBe(false)
    })
  })

  // Input validation
  describe('input validation', () => {
    it('rejects null, undefined, empty strings', () => {
      expect(isValidOrigin('')).toBe(false)
      expect(isValidOrigin(null as unknown as string)).toBe(false)
      expect(isValidOrigin(undefined as unknown as string)).toBe(false)
      expect(isValidOrigin(123 as unknown as string)).toBe(false)
    })

    it('rejects malformed URLs', () => {
      expect(isValidOrigin('not-a-url')).toBe(false)
      expect(isValidOrigin('://missing-protocol')).toBe(false)
      expect(isValidOrigin('https://')).toBe(false)
      expect(isValidOrigin('https://.')).toBe(false)
    })
  })
})

describe('normalizeOrigin', () => {
  it('normalizes origins to protocol + host', () => {
    expect(normalizeOrigin('https://example.com')).toBe('https://example.com')
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('lowercases hostnames', () => {
    expect(normalizeOrigin('https://EXAMPLE.COM')).toBe('https://example.com')
  })

  it('handles default ports', () => {
    expect(normalizeOrigin('https://example.com:443')).toBe('https://example.com')
  })

  it('strips paths from URL', () => {
    expect(normalizeOrigin('https://example.com/path/to/page')).toBe('https://example.com')
  })

  it('strips query strings', () => {
    expect(normalizeOrigin('https://example.com?query=value')).toBe('https://example.com')
  })

  it('strips fragments', () => {
    expect(normalizeOrigin('https://example.com#section')).toBe('https://example.com')
  })
})

describe('validateOriginWithReason', () => {
  it('returns null for valid origins', () => {
    expect(validateOriginWithReason('https://example.com')).toBeNull()
    expect(validateOriginWithReason('http://localhost:3000')).toBeNull()
  })

  it('returns specific error for empty input', () => {
    expect(validateOriginWithReason('')).toBe('Origin is required')
  })

  it('returns specific error for malformed URLs', () => {
    expect(validateOriginWithReason('not-a-url')).toBe('Invalid URL format')
  })

  it('returns specific error for origins with paths', () => {
    expect(validateOriginWithReason('https://example.com/path')).toBe(
      'Origin must be protocol + host only (no path or query)'
    )
  })

  it('returns specific error for HTTP non-localhost', () => {
    expect(validateOriginWithReason('http://example.com')).toBe(
      'HTTP is only allowed for localhost. Use HTTPS for remote origins.'
    )
  })

  it('returns specific error for invalid protocols', () => {
    expect(validateOriginWithReason('ftp://example.com')).toBe(
      'Only HTTP and HTTPS protocols are allowed'
    )
  })
})

describe('isSecureOrigin', () => {
  it('returns true for HTTPS origins', () => {
    expect(isSecureOrigin('https://example.com')).toBe(true)
    expect(isSecureOrigin('https://app.example.com:8443')).toBe(true)
  })

  it('returns true for localhost (any protocol)', () => {
    expect(isSecureOrigin('http://localhost')).toBe(true)
    expect(isSecureOrigin('http://127.0.0.1:3000')).toBe(true)
    expect(isSecureOrigin('https://localhost')).toBe(true)
  })

  it('returns false for HTTP non-localhost', () => {
    expect(isSecureOrigin('http://example.com')).toBe(false)
    expect(isSecureOrigin('http://192.168.1.1')).toBe(false)
  })

  it('returns false for invalid origins', () => {
    expect(isSecureOrigin('not-a-url')).toBe(false)
    expect(isSecureOrigin('')).toBe(false)
  })
})
