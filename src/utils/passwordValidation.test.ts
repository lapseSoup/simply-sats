/**
 * Password Validation Tests
 *
 * Tests for security-critical password validation logic.
 */

import { describe, it, expect } from 'vitest'
import {
  validatePassword,
  isPasswordValid,
  getPasswordStrengthLabel,
  MIN_PASSWORD_LENGTH,
  RECOMMENDED_PASSWORD_LENGTH
} from './passwordValidation'

describe('validatePassword', () => {
  describe('length requirements', () => {
    it('rejects passwords shorter than minimum length', () => {
      const result = validatePassword('short')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    })

    it('accepts passwords at minimum length', () => {
      const password = 'a'.repeat(MIN_PASSWORD_LENGTH)
      const result = validatePassword(password)
      expect(result.isValid).toBe(true)
    })

    it('gives higher score for recommended length', () => {
      const shortPassword = 'aB1!'.repeat(Math.ceil(MIN_PASSWORD_LENGTH / 4))
      const longPassword = 'aB1!'.repeat(Math.ceil(RECOMMENDED_PASSWORD_LENGTH / 4))

      const shortResult = validatePassword(shortPassword.slice(0, MIN_PASSWORD_LENGTH))
      const longResult = validatePassword(longPassword.slice(0, RECOMMENDED_PASSWORD_LENGTH))

      // Longer password should have equal or higher score
      expect(longResult.score).toBeGreaterThanOrEqual(shortResult.score)
    })
  })

  describe('common password rejection', () => {
    it('rejects common passwords', () => {
      const result = validatePassword('password123456')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('This password is too common')
    })
  })

  describe('pattern detection', () => {
    it('warns about sequential characters', () => {
      const result = validatePassword('abcde12345678901')
      expect(result.warnings.some(w => w.includes('sequential'))).toBe(true)
    })

    it('warns about repeated characters', () => {
      const result = validatePassword('aaaa123456789012')
      expect(result.warnings.some(w => w.includes('repeated'))).toBe(true)
    })
  })

  describe('character diversity', () => {
    it('gives higher score for diverse characters', () => {
      const lowDiversity = 'aaaabbbbccccdddd'
      const highDiversity = 'aAbB1!cCdD2@eEfF'

      const lowResult = validatePassword(lowDiversity)
      const highResult = validatePassword(highDiversity)

      expect(highResult.score).toBeGreaterThan(lowResult.score)
    })

    it('encourages mix of character types', () => {
      const result = validatePassword('aaaaaaaaaaaaaaaa')
      expect(result.warnings.some(w => w.includes('mix'))).toBe(true)
    })
  })

  describe('score ranges', () => {
    it('returns score between 0 and 4', () => {
      const passwords = [
        'short',
        'longerpassword',
        'LongerPassword1',
        'LongerPassword1!',
        'V3ryStr0ng&C0mplex!'
      ]

      for (const password of passwords) {
        const result = validatePassword(password)
        expect(result.score).toBeGreaterThanOrEqual(0)
        expect(result.score).toBeLessThanOrEqual(4)
      }
    })
  })
})

describe('isPasswordValid', () => {
  it('returns true for valid passwords', () => {
    const validPassword = 'SecurePassword14'
    expect(isPasswordValid(validPassword)).toBe(true)
  })

  it('returns false for invalid passwords', () => {
    expect(isPasswordValid('short')).toBe(false)
    expect(isPasswordValid('')).toBe(false)
  })
})

describe('getPasswordStrengthLabel', () => {
  it('returns correct labels for each score', () => {
    expect(getPasswordStrengthLabel(0)).toBe('Very Weak')
    expect(getPasswordStrengthLabel(1)).toBe('Weak')
    expect(getPasswordStrengthLabel(2)).toBe('Fair')
    expect(getPasswordStrengthLabel(3)).toBe('Good')
    expect(getPasswordStrengthLabel(4)).toBe('Strong')
  })

  it('handles out of range scores', () => {
    expect(getPasswordStrengthLabel(-1)).toBe('Unknown')
    expect(getPasswordStrengthLabel(5)).toBe('Unknown')
  })
})

describe('constants', () => {
  it('has reasonable minimum password length', () => {
    // NIST recommends 8+, we use 14 for extra security
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8)
    expect(MIN_PASSWORD_LENGTH).toBeLessThanOrEqual(20) // But not too long
  })

  it('has recommended length greater than minimum', () => {
    expect(RECOMMENDED_PASSWORD_LENGTH).toBeGreaterThan(MIN_PASSWORD_LENGTH)
  })
})
