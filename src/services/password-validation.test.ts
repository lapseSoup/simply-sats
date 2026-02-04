import { describe, it, expect } from 'vitest'
import {
  validatePassword,
  isPasswordValid,
  isPasswordStrong,
  DEFAULT_PASSWORD_REQUIREMENTS,
  LEGACY_PASSWORD_REQUIREMENTS,
  getStrengthText,
  getRequirementsText
} from './password-validation'

describe('Password Validation', () => {
  describe('validatePassword', () => {
    it('should accept a strong password', () => {
      const result = validatePassword('MyStr0ngP@ssword2024!')
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.strength).toBe('strong')
    })

    it('should reject a short password', () => {
      const result = validatePassword('Short1A!')
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Password must be at least 16 characters')
    })

    it('should reject password without uppercase when required', () => {
      const result = validatePassword('thisisalongpassword123')
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true)
    })

    it('should reject password without lowercase when required', () => {
      const result = validatePassword('THISISALONGPASSWORD123')
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true)
    })

    it('should reject password without numbers when required', () => {
      const result = validatePassword('ThisIsALongPasswordNoNum')
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('number'))).toBe(true)
    })

    it('should penalize common patterns', () => {
      const withCommon = validatePassword('PasswordPassword1A!')
      const withoutCommon = validatePassword('RandomStuff1234ABC!')
      expect(withoutCommon.score).toBeGreaterThan(withCommon.score)
    })

    it('should work with legacy requirements', () => {
      // Legacy only requires 12 chars, no complexity
      const result = validatePassword('simplelegacy', LEGACY_PASSWORD_REQUIREMENTS)
      expect(result.isValid).toBe(true)
    })
  })

  describe('isPasswordValid', () => {
    it('should return true for valid legacy passwords', () => {
      expect(isPasswordValid('oldpassword12')).toBe(true)
    })

    it('should return false for too short passwords', () => {
      expect(isPasswordValid('short')).toBe(false)
    })
  })

  describe('isPasswordStrong', () => {
    it('should return true for strong passwords', () => {
      expect(isPasswordStrong('MyStr0ngP@ssword2024!')).toBe(true)
    })

    it('should return false for weak passwords', () => {
      expect(isPasswordStrong('WeakPass1')).toBe(false)
    })
  })

  describe('getStrengthText', () => {
    it('should return appropriate text for each strength', () => {
      expect(getStrengthText('weak')).toContain('Weak')
      expect(getStrengthText('fair')).toContain('Fair')
      expect(getStrengthText('good')).toContain('Good')
      expect(getStrengthText('strong')).toContain('Strong')
    })
  })

  describe('getRequirementsText', () => {
    it('should return array of requirement strings', () => {
      const reqs = getRequirementsText(DEFAULT_PASSWORD_REQUIREMENTS)
      expect(Array.isArray(reqs)).toBe(true)
      expect(reqs.length).toBeGreaterThan(0)
      expect(reqs.some(r => r.includes('16'))).toBe(true) // Min length
    })
  })
})
