/**
 * Secure Storage Service
 *
 * Provides encrypted storage for sensitive data in localStorage.
 * Uses AES-GCM encryption with a session-derived key.
 *
 * Non-sensitive data (display preferences) remains unencrypted for performance.
 *
 * @module services/secureStorage
 */

import { walletLogger } from './logger'

// Storage keys
const STORAGE_PREFIX = 'simply_sats_'

// Keys that should be encrypted
const SENSITIVE_KEYS = new Set([
  'trusted_origins',
  'connected_apps',
  'rate_limit',
])

// Keys that remain unencrypted (non-sensitive preferences):
// - cached_balance
// - cached_ord_balance
// - auto_lock_minutes
// - display_unit
// Note: Encryption is determined by checking SENSITIVE_KEYS instead

// Web Crypto API
const getCrypto = () => globalThis.crypto

// Session key cache (in-memory only, never persisted)
let sessionKey: CryptoKey | null = null

/**
 * Get or create session encryption key
 * Key is kept in-memory only — never persisted to sessionStorage (XSS mitigation)
 */
async function getSessionKey(): Promise<CryptoKey> {
  if (sessionKey) {
    return sessionKey
  }

  // Generate new session key in-memory only (non-extractable)
  sessionKey = await getCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  )

  return sessionKey
}

/**
 * Encrypt data with session key
 */
async function encryptData(data: string): Promise<string> {
  const key = await getSessionKey()
  const iv = getCrypto().getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(data)

  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)

  // Convert to base64
  let binary = ''
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]!)
  }
  return btoa(binary)
}

/**
 * Decrypt data with session key
 */
async function decryptData(encrypted: string): Promise<string> {
  const key = await getSessionKey()

  // Decode base64
  const binary = atob(encrypted)
  const combined = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i)
  }

  // Split IV and ciphertext
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  const decrypted = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )

  return new TextDecoder().decode(decrypted)
}

/**
 * Check if a key should be encrypted
 */
function shouldEncrypt(key: string): boolean {
  // Remove prefix for checking
  const shortKey = key.replace(STORAGE_PREFIX, '')
  return SENSITIVE_KEYS.has(shortKey)
}

/**
 * Store a value securely
 * Encrypts sensitive data, stores non-sensitive data as-is
 */
export async function secureSet(key: string, value: string): Promise<void> {
  const fullKey = key.startsWith(STORAGE_PREFIX) ? key : `${STORAGE_PREFIX}${key}`

  if (shouldEncrypt(key)) {
    try {
      const encrypted = await encryptData(value)
      localStorage.setItem(fullKey, `enc:${encrypted}`)
    } catch (e) {
      walletLogger.error('Failed to encrypt storage value', { key, error: e })
      // Fail-secure: never store sensitive data unencrypted
      throw new Error(`Failed to encrypt sensitive data for key: ${key}`)
    }
  } else {
    localStorage.setItem(fullKey, value)
  }
}

/**
 * Retrieve a value securely
 * Decrypts encrypted data, returns non-sensitive data as-is
 */
export async function secureGet(key: string): Promise<string | null> {
  const fullKey = key.startsWith(STORAGE_PREFIX) ? key : `${STORAGE_PREFIX}${key}`
  const value = localStorage.getItem(fullKey)

  if (!value) {
    return null
  }

  // Check if value is encrypted
  if (value.startsWith('enc:')) {
    try {
      return await decryptData(value.slice(4))
    } catch (e) {
      walletLogger.error('Failed to decrypt storage value', { key, error: e })
      return null
    }
  }

  return value
}

/**
 * Remove a value from secure storage
 */
export function secureRemove(key: string): void {
  const fullKey = key.startsWith(STORAGE_PREFIX) ? key : `${STORAGE_PREFIX}${key}`
  localStorage.removeItem(fullKey)
}

/**
 * Store JSON value securely
 */
export async function secureSetJSON<T>(key: string, value: T): Promise<void> {
  await secureSet(key, JSON.stringify(value))
}

/**
 * Retrieve JSON value securely
 */
export async function secureGetJSON<T>(key: string): Promise<T | null> {
  const value = await secureGet(key)
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as T
  } catch {
    walletLogger.error('Failed to parse JSON from storage', { key })
    return null
  }
}

/**
 * Migrate existing unencrypted sensitive data to encrypted storage
 * Call this on app startup
 */
export async function migrateToSecureStorage(): Promise<void> {
  for (const key of SENSITIVE_KEYS) {
    const fullKey = `${STORAGE_PREFIX}${key}`
    const value = localStorage.getItem(fullKey)

    // Skip if no value or already encrypted
    if (!value || value.startsWith('enc:')) {
      continue
    }

    // Re-save to encrypt
    try {
      await secureSet(key, value)
      walletLogger.info('Migrated to secure storage', { key })
    } catch (e) {
      walletLogger.error('Failed to migrate to secure storage', { key, error: e })
    }
  }
}

/**
 * Clear session key (call on logout/lock)
 */
export function clearSessionKey(): void {
  sessionKey = null
}

/**
 * Clear ALL simply_sats_ prefixed data from localStorage and sessionStorage.
 * Used during wallet deletion to ensure a true fresh-install state.
 */
export function clearAllSimplySatsStorage(): void {
  // Collect keys first to avoid mutation during iteration
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))

  // Clear session key from memory
  sessionKey = null

  walletLogger.info('Cleared all simply_sats_ storage', { keysCleared: keysToRemove.length })
}
