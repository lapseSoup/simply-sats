import { describe, it, expect } from 'vitest'
import { isUnprotectedData } from './types'

describe('isUnprotectedData', () => {
  it('returns true for valid unprotected data', () => {
    const data = { version: 0, mode: 'unprotected', keys: { mnemonic: 'test' } }
    expect(isUnprotectedData(data)).toBe(true)
  })

  it('returns false for EncryptedData', () => {
    const data = { version: 1, ciphertext: 'x', iv: 'y', salt: 'z', iterations: 600000 }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isUnprotectedData(null)).toBe(false)
  })

  it('returns false for wrong version', () => {
    const data = { version: 1, mode: 'unprotected', keys: {} }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isUnprotectedData(undefined)).toBe(false)
  })

  it('returns false for missing mode', () => {
    const data = { version: 0, keys: {} }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for missing keys', () => {
    const data = { version: 0, mode: 'unprotected' }
    expect(isUnprotectedData(data)).toBe(false)
  })
})
