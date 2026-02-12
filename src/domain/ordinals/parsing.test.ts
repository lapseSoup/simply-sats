import { describe, it, expect } from 'vitest'
import {
  mapGpItemToOrdinal,
  filterOneSatOrdinals,
  isOrdinalInscriptionScript,
  extractPkhFromInscriptionScript,
  pkhMatches,
  extractContentTypeFromScript,
  isOneSatOutput,
  formatOrdinalOrigin,
  parseOrdinalOrigin,
  INSCRIPTION_MARKER,
  PKH_MARKER,
  PKH_HEX_LENGTH,
  ONE_SAT_VALUE_BSV
} from './parsing'
import type { GpOrdinalItem } from '../types'

describe('Ordinal Parsing', () => {
  describe('mapGpItemToOrdinal', () => {
    it('should map a GP item with origin to an Ordinal', () => {
      const gpItem: GpOrdinalItem = {
        txid: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
        vout: 0,
        satoshis: 1,
        origin: {
          outpoint: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1_0',
          data: {
            insc: {
              file: {
                type: 'image/png',
                hash: 'somehash123'
              }
            }
          }
        }
      }

      const result = mapGpItemToOrdinal(gpItem)

      expect(result.origin).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abc1_0')
      expect(result.txid).toBe('abc123def456abc123def456abc123def456abc123def456abc123def456abc1')
      expect(result.vout).toBe(0)
      expect(result.satoshis).toBe(1)
      expect(result.contentType).toBe('image/png')
      expect(result.content).toBe('somehash123')
    })

    it('should fallback to outpoint when origin has no outpoint', () => {
      const gpItem: GpOrdinalItem = {
        txid: 'abc123',
        vout: 2,
        satoshis: 1,
        outpoint: 'abc123_2'
      }

      const result = mapGpItemToOrdinal(gpItem)

      expect(result.origin).toBe('abc123_2')
    })

    it('should construct origin from txid_vout when no origin or outpoint', () => {
      const gpItem: GpOrdinalItem = {
        txid: 'def456',
        vout: 3
      }

      const result = mapGpItemToOrdinal(gpItem)

      expect(result.origin).toBe('def456_3')
    })

    it('should default satoshis to 1 when undefined', () => {
      const gpItem: GpOrdinalItem = {
        txid: 'abc123',
        vout: 0
      }

      const result = mapGpItemToOrdinal(gpItem)

      expect(result.satoshis).toBe(1)
    })

    it('should handle missing inscription data', () => {
      const gpItem: GpOrdinalItem = {
        txid: 'abc123',
        vout: 0,
        satoshis: 1,
        origin: {
          outpoint: 'abc123_0'
        }
      }

      const result = mapGpItemToOrdinal(gpItem)

      expect(result.contentType).toBeUndefined()
      expect(result.content).toBeUndefined()
    })
  })

  describe('filterOneSatOrdinals', () => {
    it('should include items with exactly 1 satoshi', () => {
      const items: GpOrdinalItem[] = [
        { txid: 'a', vout: 0, satoshis: 1 },
        { txid: 'b', vout: 0, satoshis: 5000 },
        { txid: 'c', vout: 0, satoshis: 1 }
      ]

      const result = filterOneSatOrdinals(items)

      expect(result).toHaveLength(2)
      expect(result[0]!.txid).toBe('a')
      expect(result[1]!.txid).toBe('c')
    })

    it('should include items with an origin even if satoshis > 1', () => {
      const items: GpOrdinalItem[] = [
        { txid: 'a', vout: 0, satoshis: 100, origin: { outpoint: 'a_0' } },
        { txid: 'b', vout: 0, satoshis: 5000 }
      ]

      const result = filterOneSatOrdinals(items)

      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('a')
    })

    it('should return empty array for no matching items', () => {
      const items: GpOrdinalItem[] = [
        { txid: 'a', vout: 0, satoshis: 5000 },
        { txid: 'b', vout: 0, satoshis: 2000 }
      ]

      const result = filterOneSatOrdinals(items)

      expect(result).toHaveLength(0)
    })

    it('should handle empty input array', () => {
      expect(filterOneSatOrdinals([])).toEqual([])
    })
  })

  describe('isOrdinalInscriptionScript', () => {
    it('should return true for scripts starting with the inscription marker', () => {
      const script = INSCRIPTION_MARKER + '51' + '00'.repeat(20) + '68'
      expect(isOrdinalInscriptionScript(script)).toBe(true)
    })

    it('should return false for standard P2PKH scripts', () => {
      const p2pkhScript = '76a914' + '00'.repeat(20) + '88ac'
      expect(isOrdinalInscriptionScript(p2pkhScript)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isOrdinalInscriptionScript('')).toBe(false)
    })

    it('should return false for OP_RETURN scripts', () => {
      expect(isOrdinalInscriptionScript('6a' + '00'.repeat(10))).toBe(false)
    })
  })

  describe('extractPkhFromInscriptionScript', () => {
    it('should extract PKH from a valid inscription script', () => {
      const fakePkh = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      const script = INSCRIPTION_MARKER + '51' + '00'.repeat(20) + PKH_MARKER + fakePkh + '88ac'

      const result = extractPkhFromInscriptionScript(script)

      expect(result).toBe(fakePkh)
    })

    it('should return null when PKH marker is not present', () => {
      const script = INSCRIPTION_MARKER + '51' + '00'.repeat(20) + '88ac'

      const result = extractPkhFromInscriptionScript(script)

      expect(result).toBeNull()
    })

    it('should return null when script is too short after marker', () => {
      const script = PKH_MARKER + 'abcd' // Only 4 hex chars, need 40

      const result = extractPkhFromInscriptionScript(script)

      expect(result).toBeNull()
    })

    it('should extract exactly PKH_HEX_LENGTH characters', () => {
      const fakePkh = 'a'.repeat(PKH_HEX_LENGTH)
      const script = 'someprefix' + PKH_MARKER + fakePkh + 'extradata88ac'

      const result = extractPkhFromInscriptionScript(script)

      expect(result).toBe(fakePkh)
      expect(result!.length).toBe(PKH_HEX_LENGTH)
    })
  })

  describe('pkhMatches', () => {
    it('should return true for identical PKHs', () => {
      const pkh = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      expect(pkhMatches(pkh, pkh)).toBe(true)
    })

    it('should be case-insensitive', () => {
      const lower = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      const upper = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2'
      expect(pkhMatches(lower, upper)).toBe(true)
      expect(pkhMatches(upper, lower)).toBe(true)
    })

    it('should return false for different PKHs', () => {
      const pkh1 = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
      const pkh2 = 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b200'
      expect(pkhMatches(pkh1, pkh2)).toBe(false)
    })
  })

  describe('extractContentTypeFromScript', () => {
    it('should extract text/plain content type', () => {
      // Build a script: OP_IF(63) "ord"(036f7264) OP_1(51) <length><"text/plain"> OP_0(00)
      const contentType = 'text/plain'
      const contentTypeHex = Array.from(new TextEncoder().encode(contentType))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      const lengthHex = contentType.length.toString(16).padStart(2, '0')
      const script = '63036f726451' + lengthHex + contentTypeHex + '00' + 'ff'.repeat(10)

      const result = extractContentTypeFromScript(script)

      expect(result).toBe('text/plain')
    })

    it('should extract image/png content type', () => {
      const contentType = 'image/png'
      const contentTypeHex = Array.from(new TextEncoder().encode(contentType))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      const lengthHex = contentType.length.toString(16).padStart(2, '0')
      const script = '63036f726451' + lengthHex + contentTypeHex + '00' + 'ff'.repeat(10)

      const result = extractContentTypeFromScript(script)

      expect(result).toBe('image/png')
    })

    it('should extract application/json content type', () => {
      const contentType = 'application/json'
      const contentTypeHex = Array.from(new TextEncoder().encode(contentType))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      const lengthHex = contentType.length.toString(16).padStart(2, '0')
      const script = '63036f726451' + lengthHex + contentTypeHex + '00' + 'ff'.repeat(10)

      const result = extractContentTypeFromScript(script)

      expect(result).toBe('application/json')
    })

    it('should return undefined for non-inscription script', () => {
      const p2pkhScript = '76a914' + '00'.repeat(20) + '88ac'
      expect(extractContentTypeFromScript(p2pkhScript)).toBeUndefined()
    })

    it('should return undefined for empty script', () => {
      expect(extractContentTypeFromScript('')).toBeUndefined()
    })
  })

  describe('isOneSatOutput', () => {
    it('should return true for exactly 1 satoshi in BSV', () => {
      expect(isOneSatOutput(ONE_SAT_VALUE_BSV)).toBe(true)
      expect(isOneSatOutput(0.00000001)).toBe(true)
    })

    it('should return false for other values', () => {
      expect(isOneSatOutput(0.001)).toBe(false)
      expect(isOneSatOutput(0)).toBe(false)
      expect(isOneSatOutput(1)).toBe(false)
      expect(isOneSatOutput(0.00000002)).toBe(false)
    })
  })

  describe('formatOrdinalOrigin', () => {
    it('should format txid and vout into origin string', () => {
      expect(formatOrdinalOrigin('abc123', 0)).toBe('abc123_0')
      expect(formatOrdinalOrigin('def456', 3)).toBe('def456_3')
    })

    it('should handle vout of 0', () => {
      expect(formatOrdinalOrigin('txid', 0)).toBe('txid_0')
    })

    it('should handle large vout values', () => {
      expect(formatOrdinalOrigin('txid', 999)).toBe('txid_999')
    })
  })

  describe('parseOrdinalOrigin', () => {
    it('should parse a valid origin string', () => {
      const result = parseOrdinalOrigin('abc123_0')

      expect(result).toEqual({ txid: 'abc123', vout: 0 })
    })

    it('should handle txids containing underscores', () => {
      // Uses lastIndexOf, so txid can contain underscores
      const result = parseOrdinalOrigin('abc_123_2')

      expect(result).toEqual({ txid: 'abc_123', vout: 2 })
    })

    it('should return null for string without underscore', () => {
      expect(parseOrdinalOrigin('abc123')).toBeNull()
    })

    it('should return null for string starting with underscore', () => {
      expect(parseOrdinalOrigin('_0')).toBeNull()
    })

    it('should return null for string ending with underscore', () => {
      expect(parseOrdinalOrigin('abc123_')).toBeNull()
    })

    it('should return null for non-numeric vout', () => {
      expect(parseOrdinalOrigin('abc123_xyz')).toBeNull()
    })

    it('should return null for negative vout', () => {
      expect(parseOrdinalOrigin('abc123_-1')).toBeNull()
    })

    it('should roundtrip with formatOrdinalOrigin', () => {
      const txid = 'abc123def456'
      const vout = 5
      const origin = formatOrdinalOrigin(txid, vout)
      const parsed = parseOrdinalOrigin(origin)

      expect(parsed).toEqual({ txid, vout })
    })
  })

  describe('Constants', () => {
    it('should have correct inscription marker', () => {
      // OP_IF(63) + push 3 bytes(03) + "ord" in hex (6f7264)
      expect(INSCRIPTION_MARKER).toBe('63036f7264')
    })

    it('should have correct PKH marker', () => {
      // OP_ENDIF(68) + OP_DUP(76) + OP_HASH160(a9) + OP_PUSHBYTES_20(14)
      expect(PKH_MARKER).toBe('6876a914')
    })

    it('should have correct PKH hex length', () => {
      // 20 bytes = 40 hex characters
      expect(PKH_HEX_LENGTH).toBe(40)
    })

    it('should have correct 1-sat BSV value', () => {
      expect(ONE_SAT_VALUE_BSV).toBe(0.00000001)
    })
  })
})
