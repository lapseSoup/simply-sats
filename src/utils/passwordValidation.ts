/**
 * Password Validation Utilities
 *
 * Provides comprehensive password strength validation following
 * modern security recommendations (NIST SP 800-63B guidelines).
 *
 * @module utils/passwordValidation
 */

export interface PasswordValidationResult {
  isValid: boolean
  score: number // 0-4 scale
  errors: string[]
  warnings: string[]
}

// Minimum requirements
export const MIN_PASSWORD_LENGTH = 14
export const RECOMMENDED_PASSWORD_LENGTH = 16

/**
 * Normalize l33t-speak substitutions to detect common password variants.
 * Maps common character substitutions back to their letter equivalents.
 */
function normalizeLeetSpeak(password: string): string {
  return password
    .replace(/@/g, 'a')
    .replace(/4/g, 'a')
    .replace(/3/g, 'e')
    .replace(/1/g, 'i')
    .replace(/!/g, 'i')
    .replace(/0/g, 'o')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
}

// Common weak passwords to reject (keyboard patterns, common phrases, dictionary words)
const COMMON_PASSWORDS = new Set([
  'password123456',
  '123456789012345',
  'qwertyuiopasdf',
  'letmein12345678',
  'iloveyou123456',
  'admin123456789',
  'welcome1234567',
  'monkey12345678',
  'dragon12345678',
  'master12345678',
  'password1234567',
  'changeme123456',
  'trustno1234567',
  // Keyboard walk patterns
  'qazwsxedcrfvtg',
  'qazwsxedcrfvtgy',
  'zxcvbnmasdfghj',
  '1qaz2wsx3edc4r',
  'poiuytrewqlkjh',
  'asdfjkl;asdfjk',
  'mnbvcxzlkjhgfd',
  // Extended common passwords
  'abcdefghijklmn',
  'abc12345678901',
  'bitcoinpassword',
  'satoshinakamoto',
  'blockchain12345',
  'cryptocurrency1',
  'p@ssword1234567',
  'P@ssw0rd1234567',
  'supersecret1234',
  'administrator12',
  'rootpassword123',
  // Repeated patterns
  'aaaaaaaaaaaaaa',
  '11111111111111',
  '00000000000000',
  // Passphrase patterns
  'pleaseletmein1',
  'iloveyouforever',
  'letmeinletmein',
  'passwordpassword',
  'qwerty12345678',
  'welcome12345678',
  // Crypto-specific
  'bitcoinwallet1',
  'myseedphrase12',
  'mywallet123456',
  'walletpassword',
  'cryptopassword',
  'blockchainpass',
  'privatekey12345',
  // Sequence extensions
  '12345678901234',
  'abcdefghijklmnop',
  'qwertyuiopasdfg',
  // Common name-based
  'iloveyoubaby12',
  'sunshine1234567',
  'princess1234567',
])

/**
 * Check if password contains a sequence (e.g., "12345", "abcde")
 */
function hasSequence(password: string, minLength = 4): boolean {
  const lower = password.toLowerCase()
  for (let i = 0; i <= lower.length - minLength; i++) {
    let isIncreasing = true
    let isDecreasing = true
    for (let j = 1; j < minLength; j++) {
      const diff = lower.charCodeAt(i + j) - lower.charCodeAt(i + j - 1)
      if (diff !== 1) isIncreasing = false
      if (diff !== -1) isDecreasing = false
    }
    if (isIncreasing || isDecreasing) return true
  }
  return false
}

/**
 * Check if password has repeated characters (e.g., "aaaa", "1111")
 */
function hasRepeatedChars(password: string, minRepeat = 4): boolean {
  for (let i = 0; i <= password.length - minRepeat; i++) {
    let repeated = true
    for (let j = 1; j < minRepeat; j++) {
      if (password[i + j] !== password[i]) {
        repeated = false
        break
      }
    }
    if (repeated) return true
  }
  return false
}

/**
 * Calculate character diversity
 */
function getCharacterDiversity(password: string): {
  hasLower: boolean
  hasUpper: boolean
  hasDigit: boolean
  hasSpecial: boolean
  uniqueChars: number
} {
  const uniqueChars = new Set(password).size
  return {
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSpecial: /[^a-zA-Z0-9]/.test(password),
    uniqueChars
  }
}

/**
 * Validate password strength
 *
 * @param password - The password to validate
 * @returns Validation result with score, errors, and warnings
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  let score = 0

  // Length check (required)
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  } else {
    score += 1
    if (password.length >= RECOMMENDED_PASSWORD_LENGTH) {
      score += 1
    } else {
      warnings.push(`Consider using ${RECOMMENDED_PASSWORD_LENGTH}+ characters for better security`)
    }
  }

  // Common password check (also test l33t-speak normalized form)
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(normalizeLeetSpeak(lower))) {
    errors.push('This password is too common')
  }

  // Sequence check
  if (hasSequence(password)) {
    warnings.push('Avoid sequential characters like "1234" or "abcd"')
    score = Math.max(0, score - 1)
  }

  // Repeated character check
  if (hasRepeatedChars(password)) {
    warnings.push('Avoid repeated characters like "aaaa"')
    score = Math.max(0, score - 1)
  }

  // Character diversity
  const diversity = getCharacterDiversity(password)
  const diversityCount = [
    diversity.hasLower,
    diversity.hasUpper,
    diversity.hasDigit,
    diversity.hasSpecial
  ].filter(Boolean).length

  if (diversityCount >= 3) {
    score += 1
  } else if (diversityCount <= 1) {
    warnings.push('Use a mix of letters, numbers, and symbols')
  }

  // Unique character ratio
  const uniqueRatio = diversity.uniqueChars / password.length
  if (uniqueRatio >= 0.7) {
    score += 1
  } else if (uniqueRatio < 0.5) {
    warnings.push('Try using more unique characters')
  }

  // Cap score at 4
  score = Math.min(4, Math.max(0, score))

  return {
    isValid: errors.length === 0,
    score,
    errors,
    warnings
  }
}

/**
 * Get password strength label
 */
export function getPasswordStrengthLabel(score: number): string {
  switch (score) {
    case 0: return 'Very Weak'
    case 1: return 'Weak'
    case 2: return 'Fair'
    case 3: return 'Good'
    case 4: return 'Strong'
    default: return 'Unknown'
  }
}

/**
 * Get password strength color for UI
 */
export function getPasswordStrengthColor(score: number): string {
  switch (score) {
    case 0: return 'var(--color-error)'
    case 1: return 'var(--color-error)'
    case 2: return 'var(--color-warning)'
    case 3: return 'var(--color-success)'
    case 4: return 'var(--color-success)'
    default: return 'var(--color-text-muted)'
  }
}

/**
 * Simple validation check (for backwards compatibility)
 * Returns true if password meets minimum requirements
 */
export function isPasswordValid(password: string): boolean {
  return validatePassword(password).isValid
}
