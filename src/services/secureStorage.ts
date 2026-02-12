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

// Keys that should be encrypted (session-scoped encryption with in-memory key).
// NOTE: trusted_origins, connected_apps, and rate_limit were previously encrypted
// but this caused data loss on app restart (session key is regenerated each session).
// These values are app preferences, not secrets — they don't need encryption.
const SENSITIVE_KEYS = new Set<string>([
  // Currently empty — add keys here only for truly sensitive session-scoped data
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
let sessionKeyCreatedAt: number = 0

// CryptoKey TTL: 6 hours — forces periodic key rotation
const SESSION_KEY_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Get or create session encryption key
 * Key is kept in-memory only — never persisted to sessionStorage (XSS mitigation)
 * Automatically rotates after TTL expiry, re-encrypting all sensitive data
 */
async function getSessionKey(): Promise<CryptoKey> {
  const now = Date.now()

  // Check if existing key has expired
  if (sessionKey && sessionKeyCreatedAt > 0 && now - sessionKeyCreatedAt >= SESSION_KEY_TTL_MS) {
    walletLogger.info('Session CryptoKey TTL expired — rotating key')
    await rotateSessionKey()
  }

  if (sessionKey) {
    return sessionKey
  }

  // Generate new session key in-memory only (non-extractable)
  sessionKey = await getCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  )
  sessionKeyCreatedAt = now

  return sessionKey
}

/**
 * Rotate the session encryption key: decrypt all sensitive values with old key,
 * generate new key, re-encrypt with new key.
 */
async function rotateSessionKey(): Promise<void> {
  const oldKey = sessionKey
  if (!oldKey) return

  // Read all encrypted values with old key
  const decryptedValues: Map<string, string> = new Map()
  for (const key of SENSITIVE_KEYS) {
    const fullKey = `${STORAGE_PREFIX}${key}`
    const raw = localStorage.getItem(fullKey)
    if (raw && raw.startsWith('enc:')) {
      try {
        const plaintext = await decryptWithKey(raw.slice(4), oldKey)
        decryptedValues.set(key, plaintext)
      } catch (e) {
        walletLogger.warn('Failed to decrypt during key rotation', { key, error: e })
      }
    }
  }

  // Generate new key
  sessionKey = await getCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  sessionKeyCreatedAt = Date.now()

  // Re-encrypt with new key
  for (const [key, value] of decryptedValues) {
    try {
      const encrypted = await encryptWithKey(value, sessionKey)
      const fullKey = `${STORAGE_PREFIX}${key}`
      localStorage.setItem(fullKey, `enc:${encrypted}`)
    } catch (e) {
      walletLogger.error('Failed to re-encrypt during key rotation', { key, error: e })
    }
  }

  walletLogger.info('Session CryptoKey rotated successfully', { keysRotated: decryptedValues.size })
}

/**
 * Encrypt data with an explicit CryptoKey
 */
async function encryptWithKey(data: string, key: CryptoKey): Promise<string> {
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
 * Decrypt data with an explicit CryptoKey
 */
async function decryptWithKey(encrypted: string, key: CryptoKey): Promise<string> {
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
 * Encrypt data with session key
 */
async function encryptData(data: string): Promise<string> {
  const key = await getSessionKey()
  return encryptWithKey(data, key)
}

/**
 * Decrypt data with session key
 */
async function decryptData(encrypted: string): Promise<string> {
  const key = await getSessionKey()
  return decryptWithKey(encrypted, key)
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

// Keys that were previously encrypted but are now stored as plain JSON
const PREVIOUSLY_ENCRYPTED_KEYS = ['trusted_origins', 'connected_apps', 'rate_limit']

/**
 * Migrate storage data on app startup:
 * 1. Encrypt any unencrypted SENSITIVE_KEYS values
 * 2. Strip enc: prefix from previously-encrypted keys that can no longer be decrypted
 */
export async function migrateToSecureStorage(): Promise<void> {
  // Migrate currently-sensitive keys to encrypted storage
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

  // Strip enc: prefix from keys that are no longer encrypted
  // These were encrypted in a previous version but became unreadable after restart
  for (const key of PREVIOUSLY_ENCRYPTED_KEYS) {
    const fullKey = `${STORAGE_PREFIX}${key}`
    const value = localStorage.getItem(fullKey)
    if (value && value.startsWith('enc:')) {
      // Can't decrypt (session key is different) — remove the stale encrypted data
      localStorage.removeItem(fullKey)
      walletLogger.info('Removed stale encrypted data (no longer needs encryption)', { key })
    }
  }
}

/**
 * Clear session key (call on logout/lock)
 */
export function clearSessionKey(): void {
  sessionKey = null
  sessionKeyCreatedAt = 0
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
  sessionKeyCreatedAt = 0

  walletLogger.info('Cleared all simply_sats_ storage', { keysCleared: keysToRemove.length })
}
