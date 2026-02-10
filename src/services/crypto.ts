/**
 * Cryptographic Utilities for Simply Sats
 *
 * This module provides secure encryption/decryption for wallet keys using
 * industry-standard cryptographic practices:
 *
 * - **Key Derivation**: PBKDF2-SHA256 with 100,000 iterations (OWASP recommended)
 * - **Encryption**: AES-256-GCM (authenticated encryption)
 * - **Random Generation**: Cryptographically secure random values for salt/IV
 *
 * This replaces the insecure btoa/atob encoding that was previously used.
 *
 * @module services/crypto
 *
 * @example
 * ```typescript
 * import { encrypt, decrypt } from './crypto'
 *
 * // Encrypt wallet data
 * const encrypted = await encrypt(walletKeys, 'user-password')
 *
 * // Store encrypted.ciphertext, encrypted.iv, encrypted.salt
 *
 * // Later, decrypt with same password
 * const decrypted = await decrypt(encrypted, 'user-password')
 * ```
 */

import { cryptoLogger } from './logger'

// Use Rust backend for encryption when running in Tauri (keys stay in native memory).
// Falls back to Web Crypto API for browser dev mode and tests.
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Lazy-load Tauri invoke to avoid import errors in browser/test environments
async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

// Use Web Crypto API (available in both browser and Tauri)
// Using a getter function allows tests to override globalThis.crypto
const getCrypto = () => globalThis.crypto

/**
 * Encryption result containing all data needed for decryption.
 *
 * All byte data is encoded as base64 strings for safe storage.
 * The version field allows for future algorithm upgrades.
 */
export interface EncryptedData {
  /** Encryption format version (for future-proofing) */
  version: number
  /** Base64-encoded ciphertext (AES-GCM encrypted data + auth tag) */
  ciphertext: string
  /** Base64-encoded initialization vector (12 bytes for AES-GCM) */
  iv: string
  /** Base64-encoded salt for PBKDF2 key derivation (16 bytes) */
  salt: string
  /** PBKDF2 iterations (stored for forwards compatibility) */
  iterations: number
}

/** Current encryption format version */
const CURRENT_VERSION = 1
/** PBKDF2 iterations - OWASP recommended minimum for 2024 */
const PBKDF2_ITERATIONS = 100000
/** Salt length in bytes (128 bits) */
const SALT_LENGTH = 16
/** IV length in bytes (96 bits for AES-GCM) */
const IV_LENGTH = 12
/** AES key length in bits (256-bit for AES-256) */
const KEY_LENGTH = 256

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return toArrayBuffer(bytes)
}

/**
 * Convert a Uint8Array to a pure ArrayBuffer.
 * Node.js webcrypto (used in CI/tests) requires genuine ArrayBuffer instances,
 * not Buffer or TypedArray views. This creates a fresh ArrayBuffer copy.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return buf
}

/**
 * Derive an AES key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // Import password as raw key material
  // Use toArrayBuffer for Node.js webcrypto compatibility (requires genuine ArrayBuffer)
  const passwordKey = await getCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Derive AES key using PBKDF2
  return getCrypto().subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt data with a password
 *
 * Uses PBKDF2 for key derivation and AES-GCM for authenticated encryption.
 * The salt and IV are randomly generated for each encryption.
 *
 * @param plaintext - Data to encrypt (will be JSON stringified if object)
 * @param password - Password to encrypt with
 * @returns EncryptedData object containing ciphertext and encryption parameters
 */
export async function encrypt(plaintext: string | object, password: string): Promise<EncryptedData> {
  // Convert to string if needed
  const data = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)

  // Use Rust backend when running in Tauri — plaintext stays in native memory
  if (isTauri()) {
    try {
      return await tauriInvoke<EncryptedData>('encrypt_data', { plaintext: data, password })
    } catch (e) {
      cryptoLogger.error('Rust encrypt_data failed, falling back to Web Crypto', { error: e })
    }
  }

  // Fallback: Web Crypto API (browser dev mode / tests)
  const salt = getCrypto().getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = getCrypto().getRandomValues(new Uint8Array(IV_LENGTH))

  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)

  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(data))
  )

  return {
    version: CURRENT_VERSION,
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(toArrayBuffer(iv)),
    salt: bufferToBase64(toArrayBuffer(salt)),
    iterations: PBKDF2_ITERATIONS
  }
}

/**
 * Decrypt data with a password
 *
 * @param encryptedData - EncryptedData object from encrypt()
 * @param password - Password to decrypt with
 * @returns Decrypted string
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export async function decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
  // Use Rust backend when running in Tauri — decrypted plaintext stays in native memory
  if (isTauri()) {
    try {
      return await tauriInvoke<string>('decrypt_data', { encryptedData, password })
    } catch (e) {
      // If the Rust command returned a decryption failure, propagate it (don't fallback)
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('Decryption failed') || msg.includes('invalid password')) {
        throw new Error('Decryption failed - invalid password or corrupted data')
      }
      cryptoLogger.error('Rust decrypt_data failed, falling back to Web Crypto', { error: e })
    }
  }

  // Fallback: Web Crypto API (browser dev mode / tests)
  if (encryptedData.version !== CURRENT_VERSION) {
    cryptoLogger.warn(`Encrypted data version ${encryptedData.version}, current is ${CURRENT_VERSION}`)
  }

  const ciphertext = base64ToBuffer(encryptedData.ciphertext)
  const iv = new Uint8Array(base64ToBuffer(encryptedData.iv))
  const salt = new Uint8Array(base64ToBuffer(encryptedData.salt))

  const key = await deriveKey(password, salt, encryptedData.iterations)

  try {
    const plaintext = await getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      ciphertext
    )

    return new TextDecoder().decode(plaintext)
  } catch (_error) {
    throw new Error('Decryption failed - invalid password or corrupted data')
  }
}

/**
 * Check if data looks like our encrypted format
 */
export function isEncryptedData(data: unknown): data is EncryptedData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return (
    typeof obj.version === 'number' &&
    typeof obj.ciphertext === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.salt === 'string' &&
    typeof obj.iterations === 'number'
  )
}

/**
 * Check if a string looks like legacy base64-encoded wallet data
 * (the old insecure format using btoa)
 */
export function isLegacyEncrypted(data: string): boolean {
  try {
    // Try to decode as base64
    const decoded = atob(data)
    // Try to parse as JSON
    const parsed = JSON.parse(decoded)
    // Check if it has wallet key properties
    return typeof parsed.mnemonic === 'string' && typeof parsed.walletWif === 'string'
  } catch {
    return false
  }
}

/**
 * Migrate legacy encrypted data to new format
 *
 * @param legacyData - Base64-encoded wallet data (old format)
 * @param password - Password to encrypt with (new format)
 * @returns New EncryptedData object
 */
export async function migrateLegacyData(legacyData: string, password: string): Promise<EncryptedData> {
  // Decode the old format (just base64)
  const decoded = atob(legacyData)

  // Re-encrypt with proper encryption
  return encrypt(decoded, password)
}

// ============================================
// ECIES Message Encryption
// ============================================

/**
 * ECIES (Elliptic Curve Integrated Encryption Scheme) for message encryption.
 * This allows encrypting messages that can only be decrypted by the holder
 * of a specific private key.
 *
 * Note: This is a simplified implementation. For full BRC compatibility,
 * you may want to use the @bsv/sdk ECIES implementation.
 */

/**
 * Derive a shared secret using ECDH (Elliptic Curve Diffie-Hellman)
 * This uses the sender's private key and recipient's public key
 *
 * Note: This is a placeholder that uses AES-GCM with a derived key.
 * For full ECIES, use the @bsv/sdk implementation.
 *
 * @param message - The message to encrypt
 * @param recipientPubKey - Recipient's public key (hex string)
 * @param sharedSecret - A pre-computed shared secret (hex string)
 * @returns Encrypted message as base64
 */
export async function encryptWithSharedSecret(
  message: string,
  sharedSecret: string
): Promise<string> {
  // Convert shared secret to key material
  const keyMaterial = await getCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(hexToBytes(sharedSecret)),
    'HKDF',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Generate random salt for HKDF (16 bytes)
  const salt = getCrypto().getRandomValues(new Uint8Array(16))

  // Derive an AES key from the shared secret
  const aesKey = await getCrypto().subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(new TextEncoder().encode('ECIES-AES-KEY'))
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Generate random IV
  const iv = getCrypto().getRandomValues(new Uint8Array(12))

  // Encrypt the message
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(new TextEncoder().encode(message))
  )

  // Combine salt + IV + ciphertext (salt needed for decryption)
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return bufferToBase64(toArrayBuffer(combined))
}

/**
 * Decrypt a message using a shared secret
 *
 * @param encryptedMessage - The encrypted message as base64
 * @param sharedSecret - The shared secret (hex string)
 * @returns Decrypted message
 */
export async function decryptWithSharedSecret(
  encryptedMessage: string,
  sharedSecret: string
): Promise<string> {
  // Convert shared secret to key material
  const keyMaterial = await getCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(hexToBytes(sharedSecret)),
    'HKDF',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Decode the combined data
  const combined = new Uint8Array(base64ToBuffer(encryptedMessage))

  // Extract salt, IV, and ciphertext
  // Format: salt (16 bytes) + IV (12 bytes) + ciphertext
  const salt = combined.slice(0, 16)
  const iv = combined.slice(16, 28)
  const ciphertext = combined.slice(28)

  // Derive the same AES key using the extracted salt
  const aesKey = await getCrypto().subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(new TextEncoder().encode('ECIES-AES-KEY'))
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Decrypt
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(ciphertext)
  )

  return new TextDecoder().decode(plaintext)
}

/**
 * Helper: Convert hex string to Uint8Array
 * @throws Error if hex string is invalid
 */
function hexToBytes(hex: string): Uint8Array {
  // Validate hex string format
  if (typeof hex !== 'string') {
    throw new Error('Input must be a string')
  }

  // Remove any whitespace and ensure lowercase
  const cleanHex = hex.replace(/\s/g, '').toLowerCase()

  // Check for valid hex characters and even length
  if (!/^[0-9a-f]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string: contains non-hex characters')
  }

  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length')
  }

  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16)
  }
  return bytes
}

/**
 * Helper: Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a random encryption key (for session-based encryption)
 */
export async function generateRandomKey(): Promise<string> {
  const key = getCrypto().getRandomValues(new Uint8Array(32))
  return bytesToHex(key)
}
