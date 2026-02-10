import { describe, it, expect } from 'vitest'
import {
  int2Hex,
  hex2Int,
  createTimelockScript,
  getTimelockScriptSize,
  parseTimelockScript,
  isTimelockScript,
  publicKeyToHash,
  TIMELOCK_SCRIPT_SIGNATURE,
  LOCKUP_PREFIX,
  LOCKUP_SUFFIX
} from './timelockScript'

describe('Timelock Script', () => {
  // ==============================
  // Byte Conversion Utilities
  // ==============================

  describe('int2Hex', () => {
    it('should convert 0 to "00"', () => {
      expect(int2Hex(0)).toBe('00')
    })

    it('should convert single byte values', () => {
      expect(int2Hex(1)).toBe('01')
      expect(int2Hex(255)).toBe('ff')
    })

    it('should convert multi-byte values to little-endian', () => {
      // 256 = 0x0100 -> little-endian = "0001"
      expect(int2Hex(256)).toBe('0001')
      // 500000 = 0x07A120 -> little-endian = "20a107"
      expect(int2Hex(500000)).toBe('20a107')
    })

    it('should handle typical block heights', () => {
      // Block 850000 = 0x0CF850 -> little-endian = "50f80c"
      expect(int2Hex(850000)).toBe('50f80c')
    })

    it('should pad odd-length hex to even', () => {
      // 16 = 0x10 -> little-endian = "10"
      expect(int2Hex(16)).toBe('10')
      // 4096 = 0x1000 -> little-endian = "0010"
      expect(int2Hex(4096)).toBe('0010')
    })
  })

  describe('hex2Int', () => {
    it('should convert "00" to 0', () => {
      expect(hex2Int('00')).toBe(0)
    })

    it('should convert single byte values', () => {
      expect(hex2Int('01')).toBe(1)
      expect(hex2Int('ff')).toBe(255)
    })

    it('should convert little-endian multi-byte values', () => {
      expect(hex2Int('0001')).toBe(256)
      expect(hex2Int('20a107')).toBe(500000)
    })

    it('should handle typical block heights', () => {
      expect(hex2Int('50f80c')).toBe(850000)
    })

    it('should be the inverse of int2Hex', () => {
      const testValues = [0, 1, 255, 256, 500000, 850000, 1000000]
      for (const val of testValues) {
        expect(hex2Int(int2Hex(val))).toBe(val)
      }
    })
  })

  // ==============================
  // Script Building
  // ==============================

  describe('createTimelockScript', () => {
    const fakePkh = 'a'.repeat(40) // 20-byte public key hash as hex

    it('should create a Script object', () => {
      const script = createTimelockScript(fakePkh, 850000)
      expect(script).toBeDefined()
      expect(typeof script.toHex).toBe('function')
      expect(typeof script.toBinary).toBe('function')
    })

    it('should produce a script that starts with the timelock signature', () => {
      const script = createTimelockScript(fakePkh, 850000)
      const hex = script.toHex()
      expect(hex.startsWith(TIMELOCK_SCRIPT_SIGNATURE)).toBe(true)
    })

    it('should produce different scripts for different block heights', () => {
      const script1 = createTimelockScript(fakePkh, 850000)
      const script2 = createTimelockScript(fakePkh, 900000)
      expect(script1.toHex()).not.toBe(script2.toHex())
    })

    it('should produce different scripts for different public key hashes', () => {
      const pkh1 = 'a'.repeat(40)
      const pkh2 = 'b'.repeat(40)
      const script1 = createTimelockScript(pkh1, 850000)
      const script2 = createTimelockScript(pkh2, 850000)
      expect(script1.toHex()).not.toBe(script2.toHex())
    })
  })

  describe('getTimelockScriptSize', () => {
    // Use a valid compressed public key hex (33 bytes)
    // This is a well-known test vector public key
    const validPubKeyHex = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    it('should return a positive number', () => {
      const size = getTimelockScriptSize(validPubKeyHex, 850000)
      expect(size).toBeGreaterThan(0)
    })

    it('should return consistent sizes for the same inputs', () => {
      const size1 = getTimelockScriptSize(validPubKeyHex, 850000)
      const size2 = getTimelockScriptSize(validPubKeyHex, 850000)
      expect(size1).toBe(size2)
    })

    it('should return similar sizes for different block heights (script is mostly fixed)', () => {
      const size1 = getTimelockScriptSize(validPubKeyHex, 850000)
      const size2 = getTimelockScriptSize(validPubKeyHex, 900000)
      // Script size varies only by the nLockTime encoding (1-4 bytes difference)
      expect(Math.abs(size1 - size2)).toBeLessThanOrEqual(4)
    })
  })

  // ==============================
  // Script Parsing
  // ==============================

  describe('parseTimelockScript', () => {
    const validPubKeyHex = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    it('should return null for non-timelock scripts', () => {
      expect(parseTimelockScript('')).toBeNull()
      expect(parseTimelockScript('76a914')).toBeNull()
      expect(parseTimelockScript('abcdef1234567890')).toBeNull()
    })

    it('should return null for scripts that start with signature but have invalid structure', () => {
      // Starts with signature but too short to have valid pkh
      expect(parseTimelockScript(TIMELOCK_SCRIPT_SIGNATURE)).toBeNull()
    })

    it('should correctly roundtrip: create then parse', () => {
      const pkh = publicKeyToHash(validPubKeyHex)
      const blockHeight = 850000
      const script = createTimelockScript(pkh, blockHeight)
      const scriptHex = script.toHex()

      const parsed = parseTimelockScript(scriptHex)
      expect(parsed).not.toBeNull()
      expect(parsed!.unlockBlock).toBe(blockHeight)
      expect(parsed!.publicKeyHash).toBe(pkh)
    })

    it('should correctly roundtrip with various block heights', () => {
      const pkh = publicKeyToHash(validPubKeyHex)
      const heights = [100, 1000, 500000, 850000, 1000000, 16777215]

      for (const height of heights) {
        const script = createTimelockScript(pkh, height)
        const parsed = parseTimelockScript(script.toHex())
        expect(parsed).not.toBeNull()
        expect(parsed!.unlockBlock).toBe(height)
        expect(parsed!.publicKeyHash).toBe(pkh)
      }
    })
  })

  describe('isTimelockScript', () => {
    it('should return false for non-timelock scripts', () => {
      expect(isTimelockScript('')).toBe(false)
      expect(isTimelockScript('76a914')).toBe(false)
    })

    it('should return true for scripts starting with timelock signature', () => {
      expect(isTimelockScript(TIMELOCK_SCRIPT_SIGNATURE + 'anything')).toBe(true)
    })

    it('should return true for valid timelock scripts', () => {
      const pkh = 'a'.repeat(40)
      const script = createTimelockScript(pkh, 850000)
      expect(isTimelockScript(script.toHex())).toBe(true)
    })
  })

  // ==============================
  // Key Utilities
  // ==============================

  describe('publicKeyToHash', () => {
    const validPubKeyHex = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

    it('should return a 40-character hex string (20 bytes)', () => {
      const hash = publicKeyToHash(validPubKeyHex)
      expect(hash).toHaveLength(40)
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true)
    })

    it('should return consistent results for the same input', () => {
      const hash1 = publicKeyToHash(validPubKeyHex)
      const hash2 = publicKeyToHash(validPubKeyHex)
      expect(hash1).toBe(hash2)
    })

    it('should return different hashes for different public keys', () => {
      const pubKey2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
      const hash1 = publicKeyToHash(validPubKeyHex)
      const hash2 = publicKeyToHash(pubKey2)
      expect(hash1).not.toBe(hash2)
    })
  })

  // ==============================
  // Constants
  // ==============================

  describe('Constants', () => {
    it('should export TIMELOCK_SCRIPT_SIGNATURE as a hex string', () => {
      expect(typeof TIMELOCK_SCRIPT_SIGNATURE).toBe('string')
      expect(TIMELOCK_SCRIPT_SIGNATURE).toMatch(/^[0-9a-f]+$/)
    })

    it('should export LOCKUP_PREFIX as a non-empty string', () => {
      expect(typeof LOCKUP_PREFIX).toBe('string')
      expect(LOCKUP_PREFIX.length).toBeGreaterThan(0)
    })

    it('should export LOCKUP_SUFFIX as a non-empty string', () => {
      expect(typeof LOCKUP_SUFFIX).toBe('string')
      expect(LOCKUP_SUFFIX.length).toBeGreaterThan(0)
    })
  })
})
