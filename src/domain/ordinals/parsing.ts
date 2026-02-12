/**
 * Pure Ordinal Parsing Functions
 *
 * This module provides pure functions for parsing, transforming, and validating
 * ordinal data structures. All functions are deterministic with no side effects,
 * API calls, or database access.
 *
 * These functions extract the parsing logic that was previously embedded in the
 * services layer (wallet/ordinals.ts) into the domain layer for better testability
 * and separation of concerns.
 *
 * @module domain/ordinals/parsing
 */

import type { Ordinal, GpOrdinalItem } from '../types'

// ============================================
// Constants
// ============================================

/**
 * Hex prefix for an ordinal inscription envelope.
 * OP_IF (0x63) followed by push 3 bytes "ord" (0x03 0x6f 0x72 0x64).
 */
export const INSCRIPTION_MARKER = '63036f7264'

/**
 * Hex marker for the P2PKH portion after OP_ENDIF.
 * OP_ENDIF (0x68) OP_DUP (0x76) OP_HASH160 (0xa9) OP_PUSHBYTES_20 (0x14).
 */
export const PKH_MARKER = '6876a914'

/**
 * Length of a public key hash in hex characters (20 bytes = 40 hex chars).
 */
export const PKH_HEX_LENGTH = 40

/**
 * Regex for extracting content type from an ordinal inscription script.
 * Matches: OP_IF "ord" OP_1 <length><content-type-hex> OP_0
 */
export const CONTENT_TYPE_REGEX = /63036f726451([0-9a-f]{2})([0-9a-f]+)00/

/**
 * The satoshi value of a 1Sat ordinal output as it appears in WoC API responses.
 * WoC returns value in BSV (1 sat = 0.00000001 BSV).
 */
export const ONE_SAT_VALUE_BSV = 0.00000001

// ============================================
// GorillaPool Response Mapping
// ============================================

/**
 * Map a GorillaPool ordinal item to a domain Ordinal.
 *
 * Extracts and normalizes the relevant fields from the GorillaPool API
 * response format into the internal Ordinal type.
 *
 * @param item - GorillaPool ordinal item from the API
 * @returns Ordinal domain object
 *
 * @example
 * ```typescript
 * const gpItem: GpOrdinalItem = {
 *   txid: 'abc123...', vout: 0, satoshis: 1,
 *   origin: { outpoint: 'abc123..._0', data: { insc: { file: { type: 'image/png' } } } }
 * }
 * const ordinal = mapGpItemToOrdinal(gpItem)
 * // ordinal.origin === 'abc123..._0'
 * // ordinal.contentType === 'image/png'
 * ```
 */
export function mapGpItemToOrdinal(item: GpOrdinalItem): Ordinal {
  return {
    origin: item.origin?.outpoint || item.outpoint || `${item.txid}_${item.vout}`,
    txid: item.txid,
    vout: item.vout,
    satoshis: item.satoshis || 1,
    contentType: item.origin?.data?.insc?.file?.type,
    content: item.origin?.data?.insc?.file?.hash
  }
}

/**
 * Filter GorillaPool ordinal items to only include actual ordinals.
 *
 * Ordinals are identified as UTXOs with exactly 1 satoshi or those
 * that have an origin set (indicating they are tracked inscriptions).
 *
 * @param items - Array of GorillaPool ordinal items
 * @returns Filtered array containing only ordinal items
 *
 * @example
 * ```typescript
 * const items = [
 *   { txid: 'a', vout: 0, satoshis: 1 },
 *   { txid: 'b', vout: 0, satoshis: 5000 },
 *   { txid: 'c', vout: 0, satoshis: 100, origin: { outpoint: 'c_0' } }
 * ]
 * filterOneSatOrdinals(items)
 * // Returns items 'a' and 'c'
 * ```
 */
export function filterOneSatOrdinals(items: GpOrdinalItem[]): GpOrdinalItem[] {
  return items.filter((item: GpOrdinalItem) => item.satoshis === 1 || item.origin)
}

// ============================================
// Script Parsing
// ============================================

/**
 * Check if a script hex string is an ordinal inscription envelope.
 *
 * Ordinal inscriptions begin with OP_IF followed by the push of "ord" (3 bytes).
 * This is a quick check for the presence of the inscription marker at the
 * start of the script.
 *
 * @param scriptHex - Hex-encoded script to check
 * @returns True if the script starts with the inscription marker
 *
 * @example
 * ```typescript
 * isOrdinalInscriptionScript('63036f7264...')  // true
 * isOrdinalInscriptionScript('76a914...')       // false (P2PKH)
 * ```
 */
export function isOrdinalInscriptionScript(scriptHex: string): boolean {
  return scriptHex.startsWith(INSCRIPTION_MARKER)
}

/**
 * Extract the public key hash from an ordinal inscription script.
 *
 * After the inscription envelope (OP_IF ... OP_ENDIF), the script contains
 * a standard P2PKH lock. This function finds the PKH marker
 * (OP_ENDIF OP_DUP OP_HASH160 OP_PUSHBYTES_20) and extracts the 20-byte
 * public key hash that follows.
 *
 * @param scriptHex - Hex-encoded inscription script
 * @returns The extracted public key hash (40 hex chars), or null if not found
 *
 * @example
 * ```typescript
 * const pkh = extractPkhFromInscriptionScript('63036f7264...6876a914abcd...88ac')
 * // pkh === 'abcd...' (40 hex chars)
 * ```
 */
export function extractPkhFromInscriptionScript(scriptHex: string): string | null {
  const pkhIndex = scriptHex.indexOf(PKH_MARKER)
  if (pkhIndex === -1) return null

  const start = pkhIndex + PKH_MARKER.length
  if (start + PKH_HEX_LENGTH > scriptHex.length) return null

  return scriptHex.substring(start, start + PKH_HEX_LENGTH)
}

/**
 * Check if an extracted public key hash matches a target public key hash.
 *
 * Performs a case-insensitive comparison of two hex-encoded public key hashes.
 *
 * @param extractedPkh - The PKH extracted from a script
 * @param targetPkh - The target PKH to compare against
 * @returns True if the hashes match (case-insensitive)
 */
export function pkhMatches(extractedPkh: string, targetPkh: string): boolean {
  return extractedPkh.toLowerCase() === targetPkh.toLowerCase()
}

/**
 * Extract the content type from an ordinal inscription script.
 *
 * The content type is encoded in the inscription envelope after "ord" and OP_1.
 * The format is: OP_IF "ord" OP_1 <length><content-type-bytes> OP_0 <content> OP_ENDIF
 *
 * This function uses regex to find the content type hex and decodes it to UTF-8.
 *
 * @param scriptHex - Hex-encoded inscription script
 * @returns The content type string (e.g., "image/png"), or undefined if not found
 *
 * @example
 * ```typescript
 * extractContentTypeFromScript('63036f72645110746578742f706c61696e00...')
 * // Returns 'text/plain'
 * ```
 */
export function extractContentTypeFromScript(scriptHex: string): string | undefined {
  const match = scriptHex.match(CONTENT_TYPE_REGEX)
  if (!match) return undefined

  const ctLen = parseInt(match[1]!, 16)
  const ctHex = match[2]!.substring(0, ctLen * 2)

  try {
    // Decode hex to UTF-8 string using a portable approach
    const bytes = new Uint8Array(ctHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

// ============================================
// Output Classification
// ============================================

/**
 * Check if a transaction output value represents a potential ordinal (1 sat).
 *
 * WhatsOnChain API returns values in BSV, so 1 satoshi = 0.00000001 BSV.
 * This function checks for that exact value.
 *
 * @param valueBsv - Output value in BSV (as returned by WoC API)
 * @returns True if the value is exactly 1 satoshi
 *
 * @example
 * ```typescript
 * isOneSatOutput(0.00000001)  // true
 * isOneSatOutput(0.001)       // false
 * ```
 */
export function isOneSatOutput(valueBsv: number): boolean {
  return valueBsv === ONE_SAT_VALUE_BSV
}

// ============================================
// Origin Formatting
// ============================================

/**
 * Format an ordinal origin string from a transaction ID and output index.
 *
 * The origin format used throughout the app is `{txid}_{vout}`.
 *
 * @param txid - Transaction ID
 * @param vout - Output index
 * @returns Formatted origin string
 *
 * @example
 * ```typescript
 * formatOrdinalOrigin('abc123...', 0)
 * // Returns 'abc123..._0'
 * ```
 */
export function formatOrdinalOrigin(txid: string, vout: number): string {
  return `${txid}_${vout}`
}

/**
 * Parse an ordinal origin string into its components.
 *
 * @param origin - Origin string in format `{txid}_{vout}`
 * @returns Parsed components, or null if the format is invalid
 *
 * @example
 * ```typescript
 * parseOrdinalOrigin('abc123..._0')
 * // Returns { txid: 'abc123...', vout: 0 }
 * parseOrdinalOrigin('invalid')
 * // Returns null
 * ```
 */
export function parseOrdinalOrigin(origin: string): { txid: string; vout: number } | null {
  const lastUnderscore = origin.lastIndexOf('_')
  if (lastUnderscore === -1 || lastUnderscore === 0 || lastUnderscore === origin.length - 1) {
    return null
  }

  const txid = origin.substring(0, lastUnderscore)
  const vout = parseInt(origin.substring(lastUnderscore + 1), 10)

  if (isNaN(vout) || vout < 0) return null

  return { txid, vout }
}
