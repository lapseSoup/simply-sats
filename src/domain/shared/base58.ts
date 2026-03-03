/**
 * Base58 Encoding Utilities
 *
 * Shared Base58 alphabet and decode function used by both
 * address validation (strict mode) and transaction building (lenient mode).
 *
 * @module domain/shared/base58
 */

/** Base58 alphabet -- excludes visually ambiguous chars (0, O, I, l) */
export const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Decode a Base58 string to bytes.
 *
 * @param str - Base58-encoded string
 * @param strict - If true, throws on invalid characters. If false, skips them (lenient).
 * @returns Decoded bytes
 */
export function base58Decode(str: string, strict = true): Uint8Array {
  const bytes: number[] = [0]
  for (const char of str) {
    const value = BASE58_CHARS.indexOf(char)
    if (value < 0) {
      if (strict) throw new Error('Invalid Base58 character')
      continue // skip invalid chars (spaces, etc.) in lenient mode
    }
    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  // Leading '1's = leading zero bytes
  for (const char of str) {
    if (char !== '1') break
    bytes.push(0)
  }
  return new Uint8Array(bytes.reverse())
}
