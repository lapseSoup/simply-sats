/**
 * Password Validation Service for Simply Sats
 *
 * Provides strong password validation with configurable requirements.
 * Used for wallet encryption to ensure adequate security.
 */

export interface PasswordRequirements {
  minLength: number
  maxLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireNumbers: boolean
  requireSpecialChars: boolean
}

export interface PasswordValidationResult {
  isValid: boolean
  errors: string[]
  strength: 'weak' | 'fair' | 'good' | 'strong'
  score: number  // 0-100
}

/**
 * Default password requirements - 16+ characters with complexity
 * These are recommended minimums for cryptocurrency wallet security
 */
export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 16,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: false  // Recommended but not required
}

/**
 * Legacy password requirements - for backwards compatibility
 * Use when checking existing passwords
 */
export const LEGACY_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialChars: false
}

/**
 * Special characters considered for password complexity
 */
const SPECIAL_CHARS = /[!@#$%^&*()_+\-=\[\]{}|;:'",.<>\/?\\`~]/

/**
 * Validate a password against requirements
 */
export function validatePassword(
  password: string,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): PasswordValidationResult {
  const errors: string[] = []
  let score = 0

  // Length checks
  if (password.length < requirements.minLength) {
    errors.push(`Password must be at least ${requirements.minLength} characters`)
  } else {
    // Award points for length
    score += Math.min(30, password.length * 1.5)
  }

  if (password.length > requirements.maxLength) {
    errors.push(`Password must be at most ${requirements.maxLength} characters`)
  }

  // Uppercase check
  const hasUppercase = /[A-Z]/.test(password)
  if (requirements.requireUppercase && !hasUppercase) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (hasUppercase) score += 10

  // Lowercase check
  const hasLowercase = /[a-z]/.test(password)
  if (requirements.requireLowercase && !hasLowercase) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (hasLowercase) score += 10

  // Numbers check
  const hasNumbers = /[0-9]/.test(password)
  if (requirements.requireNumbers && !hasNumbers) {
    errors.push('Password must contain at least one number')
  }
  if (hasNumbers) score += 10

  // Special characters check
  const hasSpecialChars = SPECIAL_CHARS.test(password)
  if (requirements.requireSpecialChars && !hasSpecialChars) {
    errors.push('Password must contain at least one special character')
  }
  if (hasSpecialChars) score += 15

  // Check for common patterns that weaken passwords
  const hasRepeatingChars = /(.)\1{2,}/.test(password)  // 3+ same chars
  const hasSequentialChars = /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.test(password)
  const hasCommonWords = /(?:password|qwerty|letmein|welcome|admin|login|bitcoin|wallet)/i.test(password)

  if (hasRepeatingChars) score -= 10
  if (hasSequentialChars) score -= 10
  if (hasCommonWords) score -= 20

  // Bonus for variety
  const charTypes = [hasUppercase, hasLowercase, hasNumbers, hasSpecialChars].filter(Boolean).length
  score += charTypes * 5

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score))

  // Determine strength
  let strength: 'weak' | 'fair' | 'good' | 'strong'
  if (score < 30) strength = 'weak'
  else if (score < 50) strength = 'fair'
  else if (score < 70) strength = 'good'
  else strength = 'strong'

  return {
    isValid: errors.length === 0,
    errors,
    strength,
    score
  }
}

/**
 * Check if a password meets minimum requirements (legacy check)
 * Use this for validating existing passwords during unlock
 */
export function isPasswordValid(password: string): boolean {
  return validatePassword(password, LEGACY_PASSWORD_REQUIREMENTS).isValid
}

/**
 * Check if a password is strong enough for new wallet creation
 * Use this for new wallets and password changes
 */
export function isPasswordStrong(password: string): boolean {
  const result = validatePassword(password)
  return result.isValid && (result.strength === 'good' || result.strength === 'strong')
}

/**
 * Get password strength indicator text
 */
export function getStrengthText(strength: 'weak' | 'fair' | 'good' | 'strong'): string {
  switch (strength) {
    case 'weak': return 'Weak - Please use a stronger password'
    case 'fair': return 'Fair - Consider adding more complexity'
    case 'good': return 'Good'
    case 'strong': return 'Strong'
  }
}

/**
 * Get password requirements as user-friendly text
 */
export function getRequirementsText(requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS): string[] {
  const reqs: string[] = []
  reqs.push(`At least ${requirements.minLength} characters`)
  if (requirements.requireUppercase) reqs.push('At least one uppercase letter (A-Z)')
  if (requirements.requireLowercase) reqs.push('At least one lowercase letter (a-z)')
  if (requirements.requireNumbers) reqs.push('At least one number (0-9)')
  if (requirements.requireSpecialChars) reqs.push('At least one special character (!@#$%...)')
  return reqs
}
