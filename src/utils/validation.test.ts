import { describe, it, expect } from 'vitest'
import { isValidOrigin, normalizeOrigin } from './validation'

describe('Origin Validation', () => {
  it('should accept valid HTTP origins', () => {
    expect(isValidOrigin('http://localhost')).toBe(true)
    expect(isValidOrigin('http://localhost:3000')).toBe(true)
  })

  it('should accept valid HTTPS origins', () => {
    expect(isValidOrigin('https://example.com')).toBe(true)
  })

  it('should reject origins with paths', () => {
    expect(isValidOrigin('https://example.com/path')).toBe(false)
  })

  it('should reject non-http protocols', () => {
    expect(isValidOrigin('ftp://example.com')).toBe(false)
  })

  it('should reject invalid URLs', () => {
    expect(isValidOrigin('not-a-url')).toBe(false)
    expect(isValidOrigin('')).toBe(false)
  })
})

describe('normalizeOrigin', () => {
  it('should normalize origin with port', () => {
    expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('should normalize origin without port', () => {
    expect(normalizeOrigin('https://example.com')).toBe('https://example.com')
  })

  it('should strip paths from URL', () => {
    expect(normalizeOrigin('https://example.com/path/to/page')).toBe('https://example.com')
  })

  it('should strip query strings', () => {
    expect(normalizeOrigin('https://example.com?query=value')).toBe('https://example.com')
  })

  it('should strip fragments', () => {
    expect(normalizeOrigin('https://example.com#section')).toBe('https://example.com')
  })
})
