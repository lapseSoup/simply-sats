import { describe, it, expect } from 'vitest'
import {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress,
  isValidTxid,
  isValidSatoshiAmount
} from './validation'

describe('Wallet Validation', () => {
  describe('normalizeMnemonic', () => {
    it('should lowercase the mnemonic', () => {
      const result = normalizeMnemonic('ABANDON ABANDON ABANDON')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should trim whitespace', () => {
      const result = normalizeMnemonic('  abandon abandon abandon  ')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should collapse multiple spaces', () => {
      const result = normalizeMnemonic('abandon   abandon    abandon')
      expect(result).toBe('abandon abandon abandon')
    })

    it('should handle mixed case and spacing', () => {
      const result = normalizeMnemonic('  ABANDON   Abandon   ABANDON  ')
      expect(result).toBe('abandon abandon abandon')
    })
  })

  describe('validateMnemonic', () => {
    const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    it('should return valid for correct 12-word mnemonic', () => {
      const result = validateMnemonic(VALID_MNEMONIC)
      expect(result.isValid).toBe(true)
      expect(result.normalizedMnemonic).toBe(VALID_MNEMONIC)
    })

    it('should normalize and validate', () => {
      const result = validateMnemonic('  ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABANDON   ABOUT  ')
      expect(result.isValid).toBe(true)
      expect(result.normalizedMnemonic).toBe(VALID_MNEMONIC)
    })

    it('should return invalid for wrong word count', () => {
      const result = validateMnemonic('abandon abandon abandon')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('12 or 24 words')
    })

    it('should return invalid for invalid words', () => {
      const result = validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('Invalid')
    })

    it('should validate 24-word mnemonic', () => {
      const valid24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
      const result = validateMnemonic(valid24)
      expect(result.isValid).toBe(true)
      expect(result.normalizedMnemonic).toBe(valid24)
    })
  })

  describe('isValidBSVAddress', () => {
    it('should return true for valid P2PKH address', () => {
      expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true)
    })

    it('should return true for valid P2SH address', () => {
      expect(isValidBSVAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isValidBSVAddress('')).toBe(false)
    })

    it('should return false for too short address', () => {
      expect(isValidBSVAddress('1BvBM')).toBe(false)
    })

    it('should return false for too long address', () => {
      expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2aaaaaaaaaaa')).toBe(false)
    })

    it('should return false for invalid characters', () => {
      expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0')).toBe(false) // 0 is invalid
    })

    it('should return false for address with invalid prefix', () => {
      expect(isValidBSVAddress('2BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(false)
    })
  })

  describe('isValidTxid', () => {
    it('should return true for valid 64 hex character txid', () => {
      expect(isValidTxid('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(true)
    })

    it('should return true for txid with uppercase hex', () => {
      expect(isValidTxid('A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2')).toBe(true)
    })

    it('should return true for txid with mixed case hex', () => {
      expect(isValidTxid('a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6a1B2')).toBe(true)
    })

    it('should return false for empty string', () => {
      expect(isValidTxid('')).toBe(false)
    })

    it('should return false for txid shorter than 64 characters', () => {
      expect(isValidTxid('a1b2c3d4e5f6')).toBe(false)
    })

    it('should return false for txid longer than 64 characters', () => {
      expect(isValidTxid('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2aa')).toBe(false)
    })

    it('should return false for txid with non-hex characters', () => {
      expect(isValidTxid('g1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).toBe(false)
    })
  })

  describe('isValidSatoshiAmount', () => {
    it('should return true for valid positive integer', () => {
      expect(isValidSatoshiAmount(1000)).toBe(true)
    })

    it('should return true for 1 satoshi', () => {
      expect(isValidSatoshiAmount(1)).toBe(true)
    })

    it('should return true for maximum BSV supply in satoshis', () => {
      expect(isValidSatoshiAmount(21_000_000_00_000_000)).toBe(true)
    })

    it('should return false for 0', () => {
      expect(isValidSatoshiAmount(0)).toBe(false)
    })

    it('should return false for negative amount', () => {
      expect(isValidSatoshiAmount(-100)).toBe(false)
    })

    it('should return false for non-integer', () => {
      expect(isValidSatoshiAmount(100.5)).toBe(false)
    })

    it('should return false for amount exceeding max supply', () => {
      expect(isValidSatoshiAmount(21_000_000_00_000_001)).toBe(false)
    })

    it('should return false for NaN', () => {
      expect(isValidSatoshiAmount(NaN)).toBe(false)
    })

    it('should return false for Infinity', () => {
      expect(isValidSatoshiAmount(Infinity)).toBe(false)
    })
  })
})
