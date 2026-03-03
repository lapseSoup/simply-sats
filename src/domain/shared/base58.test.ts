// @vitest-environment node
/**
 * Base58 Decode Tests (Q-79)
 *
 * Tests the shared base58Decode function covering:
 * - Standard BSV address decoding (known test vector)
 * - Empty string input
 * - Leading '1' characters (zero bytes)
 * - Invalid characters in strict vs lenient mode
 * - Single character inputs
 */

import { describe, it, expect } from 'vitest'
import { base58Decode, BASE58_CHARS } from './base58'

describe('base58Decode', () => {
  it('decodes a known Base58 string correctly', () => {
    // '2' in Base58 is value 1, so decoding '2' should give [1]
    const result = base58Decode('2')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result[result.length - 1]).toBe(1)
  })

  it('decodes leading 1s as zero bytes', () => {
    // '1' in Base58 maps to value 0 and represents a leading zero byte
    const result = base58Decode('1')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toBe(0)
  })

  it('decodes multiple leading 1s as multiple zero bytes', () => {
    const result = base58Decode('111')
    // Should have at least 3 leading zero bytes
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0)
    expect(result[2]).toBe(0)
  })

  it('returns a Uint8Array with [0] for empty string', () => {
    const result = base58Decode('')
    expect(result).toBeInstanceOf(Uint8Array)
    // Empty string produces the initial [0] reversed
    expect(result.length).toBe(1)
    expect(result[0]).toBe(0)
  })

  it('decodes a longer Base58 string without error', () => {
    // A valid-looking BSV address (mainnet P2PKH starts with '1')
    const addr = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    const result = base58Decode(addr)
    expect(result).toBeInstanceOf(Uint8Array)
    // P2PKH address decodes to 25 bytes (1 version + 20 hash + 4 checksum)
    expect(result.length).toBe(25)
    // Version byte for mainnet P2PKH is 0x00
    expect(result[0]).toBe(0)
  })

  it('throws on invalid characters in strict mode (default)', () => {
    expect(() => base58Decode('0OIl')).toThrow('Invalid Base58 character')
    expect(() => base58Decode('hello world')).toThrow('Invalid Base58 character')
  })

  it('skips invalid characters in lenient mode', () => {
    // Lenient mode skips spaces and invalid chars
    const strict = base58Decode('2N', true)
    const lenient = base58Decode('2 N', false) // space is skipped
    expect(lenient).toEqual(strict)
  })

  it('skips all non-Base58 chars in lenient mode', () => {
    // '0', 'O', 'I', 'l' are not in Base58 alphabet
    const result = base58Decode('20OIl', false)
    const expected = base58Decode('2', true)
    expect(result).toEqual(expected)
  })

  it('validates BASE58_CHARS has exactly 58 characters', () => {
    expect(BASE58_CHARS.length).toBe(58)
  })

  it('validates BASE58_CHARS excludes ambiguous characters', () => {
    expect(BASE58_CHARS).not.toContain('0')
    expect(BASE58_CHARS).not.toContain('O')
    expect(BASE58_CHARS).not.toContain('I')
    expect(BASE58_CHARS).not.toContain('l')
  })
})
