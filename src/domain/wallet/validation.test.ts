import { describe, it, expect } from 'vitest'
import {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress,
  isValidPublicKey,
  isValidTxid,
  isValidSatoshiAmount
} from './validation'

describe('Mnemonic Normalization', () => {
  it('should lowercase and trim', () => {
    expect(normalizeMnemonic('  WORD One TWO  ')).toBe('word one two')
  })

  it('should collapse multiple spaces', () => {
    expect(normalizeMnemonic('word   one    two')).toBe('word one two')
  })
})

describe('Mnemonic Validation', () => {
  const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  it('should accept valid 12-word mnemonic', () => {
    const result = validateMnemonic(validMnemonic)
    expect(result.isValid).toBe(true)
    expect(result.normalizedMnemonic).toBe(validMnemonic)
  })

  it('should reject wrong word count', () => {
    const result = validateMnemonic('abandon abandon abandon')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Expected 12 or 24 words')
  })

  it('should reject invalid words', () => {
    const result = validateMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notaword')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('Invalid mnemonic phrase')
  })
})

describe('BSV Address Validation', () => {
  it('should accept valid P2PKH address', () => {
    expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true)
  })

  it('should accept valid P2SH address', () => {
    expect(isValidBSVAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true)
  })

  it('should reject too short', () => {
    expect(isValidBSVAddress('1BvBMSE')).toBe(false)
  })

  it('should reject invalid characters', () => {
    expect(isValidBSVAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0')).toBe(false)
  })
})

describe('Public Key Validation', () => {
  it('should accept valid compressed key (02 prefix)', () => {
    expect(isValidPublicKey('02' + 'ab'.repeat(32))).toBe(true)
  })

  it('should accept valid compressed key (03 prefix)', () => {
    expect(isValidPublicKey('03' + 'cd'.repeat(32))).toBe(true)
  })

  it('should accept valid uncompressed key (04 prefix)', () => {
    expect(isValidPublicKey('04' + 'ef'.repeat(64))).toBe(true)
  })

  it('should reject wrong prefix', () => {
    expect(isValidPublicKey('05' + 'ab'.repeat(32))).toBe(false)
  })

  it('should reject wrong length', () => {
    expect(isValidPublicKey('02abcdef')).toBe(false)
  })

  it('should reject non-hex characters', () => {
    expect(isValidPublicKey('02' + 'zz'.repeat(32))).toBe(false)
  })

  it('should reject empty string', () => {
    expect(isValidPublicKey('')).toBe(false)
  })
})

describe('Transaction ID Validation', () => {
  it('should accept valid 64-char hex txid', () => {
    expect(isValidTxid('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(true)
  })

  it('should reject wrong length', () => {
    expect(isValidTxid('0123456789abcdef')).toBe(false)
  })
})

describe('Satoshi Amount Validation', () => {
  it('should accept valid amounts', () => {
    expect(isValidSatoshiAmount(1)).toBe(true)
    expect(isValidSatoshiAmount(100000000)).toBe(true)
  })

  it('should reject zero and negative', () => {
    expect(isValidSatoshiAmount(0)).toBe(false)
    expect(isValidSatoshiAmount(-1)).toBe(false)
  })

  it('should reject non-integers', () => {
    expect(isValidSatoshiAmount(1.5)).toBe(false)
  })
})
