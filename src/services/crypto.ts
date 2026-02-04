/**
 * Cryptographic utilities for Simply Sats
 *
 * Provides secure encryption/decryption for wallet keys using
 * password-based key derivation (PBKDF2) and AES-GCM encryption.
 *
 * This replaces the insecure btoa/atob encoding that was previously used.
 */

// Use Web Crypto API (available in both browser and Tauri)
const crypto = globalThis.crypto

/**
 * Encryption result containing all data needed for decryption
 */
export interface EncryptedData {
  // Version for future-proofing
  version: number
  // Base64-encoded ciphertext
  ciphertext: string
  // Base64-encoded initialization vector (12 bytes for AES-GCM)
  iv: string
  // Base64-encoded salt for PBKDF2 (16 bytes)
  salt: string
  // PBKDF2 iterations (stored for future adjustments)
  iterations: number
}

// Current encryption parameters
const CURRENT_VERSION = 1
const PBKDF2_ITERATIONS = 100000  // OWASP recommended minimum
const SALT_LENGTH = 16  // 128 bits
const IV_LENGTH = 12    // 96 bits for AES-GCM
const KEY_LENGTH = 256  // AES-256

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
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
  return bytes.buffer
}

/**
 * Derive an AES key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // Import password as raw key material
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Derive AES key using PBKDF2
  // Use .buffer to get the underlying ArrayBuffer for type compatibility
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
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

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  // Derive key from password
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data)
  )

  return {
    version: CURRENT_VERSION,
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv.buffer),
    salt: bufferToBase64(salt.buffer),
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
  // Handle version upgrades if needed in the future
  if (encryptedData.version !== CURRENT_VERSION) {
    console.warn(`Encrypted data version ${encryptedData.version}, current is ${CURRENT_VERSION}`)
  }

  // Decode base64 data
  const ciphertext = base64ToBuffer(encryptedData.ciphertext)
  const iv = new Uint8Array(base64ToBuffer(encryptedData.iv))
  const salt = new Uint8Array(base64ToBuffer(encryptedData.salt))

  // Derive key from password (using stored iterations for forwards compatibility)
  const key = await deriveKey(password, salt, encryptedData.iterations)

  try {
    // Decrypt with AES-GCM
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )

    return new TextDecoder().decode(plaintext)
  } catch (error) {
    // AES-GCM will throw if authentication fails (wrong password or tampered data)
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
  const secretBytes = hexToBytes(sharedSecret)

  // Import as raw key - ensure we pass an ArrayBuffer
  const arrayBuffer = secretBytes.buffer.slice(secretBytes.byteOffset, secretBytes.byteOffset + secretBytes.byteLength) as ArrayBuffer
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    arrayBuffer,
    'HKDF',
    false,
    ['deriveBits', 'deriveKey']
  )

  // Generate random salt for HKDF (16 bytes)
  // Using random salt provides better security than fixed salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // Derive an AES key from the shared secret
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: new TextEncoder().encode('ECIES-AES-KEY')
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // Encrypt the message
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    new TextEncoder().encode(message)
  )

  // Combine salt + IV + ciphertext (salt needed for decryption)
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength)
  combined.set(salt)
  combined.set(iv, salt.length)
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length)

  return bufferToBase64(combined.buffer)
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
  const secretBytes = hexToBytes(sharedSecret)

  // Import as raw key - ensure we pass an ArrayBuffer
  const arrayBuffer = secretBytes.buffer.slice(secretBytes.byteOffset, secretBytes.byteOffset + secretBytes.byteLength) as ArrayBuffer
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    arrayBuffer,
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
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt,
      info: new TextEncoder().encode('ECIES-AES-KEY')
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  // Decrypt
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
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
  const key = crypto.getRandomValues(new Uint8Array(32))
  return bytesToHex(key)
}
