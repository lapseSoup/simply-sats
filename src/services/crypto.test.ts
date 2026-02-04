import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  encrypt,
  isEncryptedData,
  isLegacyEncrypted,
  migrateLegacyData,
  type EncryptedData
} from './crypto'

// Since we're testing crypto operations, we need to use the real Web Crypto API
// The mock in setup.ts is just for basic functionality

describe('Crypto Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isEncryptedData', () => {
    it('should return true for valid encrypted data object', () => {
      const validData: EncryptedData = {
        version: 1,
        ciphertext: 'base64string',
        iv: 'ivbase64',
        salt: 'saltbase64',
        iterations: 100000
      }

      expect(isEncryptedData(validData)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isEncryptedData(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isEncryptedData(undefined)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isEncryptedData('string')).toBe(false)
    })

    it('should return false for array', () => {
      expect(isEncryptedData([])).toBe(false)
    })

    it('should return false for missing version', () => {
      expect(isEncryptedData({
        ciphertext: 'base64',
        iv: 'iv',
        salt: 'salt',
        iterations: 100000
      })).toBe(false)
    })

    it('should return false for missing ciphertext', () => {
      expect(isEncryptedData({
        version: 1,
        iv: 'iv',
        salt: 'salt',
        iterations: 100000
      })).toBe(false)
    })

    it('should return false for missing iv', () => {
      expect(isEncryptedData({
        version: 1,
        ciphertext: 'ct',
        salt: 'salt',
        iterations: 100000
      })).toBe(false)
    })

    it('should return false for missing salt', () => {
      expect(isEncryptedData({
        version: 1,
        ciphertext: 'ct',
        iv: 'iv',
        iterations: 100000
      })).toBe(false)
    })

    it('should return false for missing iterations', () => {
      expect(isEncryptedData({
        version: 1,
        ciphertext: 'ct',
        iv: 'iv',
        salt: 'salt'
      })).toBe(false)
    })

    it('should return false for wrong type version', () => {
      expect(isEncryptedData({
        version: '1',
        ciphertext: 'ct',
        iv: 'iv',
        salt: 'salt',
        iterations: 100000
      })).toBe(false)
    })

    it('should return false for wrong type iterations', () => {
      expect(isEncryptedData({
        version: 1,
        ciphertext: 'ct',
        iv: 'iv',
        salt: 'salt',
        iterations: '100000'
      })).toBe(false)
    })
  })

  describe('isLegacyEncrypted', () => {
    it('should return true for legacy base64 wallet data', () => {
      const walletData = {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        walletWif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
      }
      const legacyEncoded = btoa(JSON.stringify(walletData))

      expect(isLegacyEncrypted(legacyEncoded)).toBe(true)
    })

    it('should return false for non-base64 string', () => {
      expect(isLegacyEncrypted('not base64!')).toBe(false)
    })

    it('should return false for base64 that is not wallet data', () => {
      const notWallet = btoa(JSON.stringify({ foo: 'bar' }))
      expect(isLegacyEncrypted(notWallet)).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isLegacyEncrypted('')).toBe(false)
    })

    it('should return false for JSON object', () => {
      expect(isLegacyEncrypted(JSON.stringify({ version: 1 }))).toBe(false)
    })
  })

  // Note: The following tests require the actual Web Crypto API
  // In a real testing environment, you would either:
  // 1. Use a more complete crypto mock
  // 2. Run these as integration tests in a browser environment
  // 3. Use a polyfill like webcrypto

  describe('encrypt/decrypt integration', () => {
    // These tests use mocked crypto - in a real environment they would use actual crypto

    it('should encrypt data and return encrypted structure', async () => {
      const plaintext = { mnemonic: 'test', walletWif: 'wif123' }
      const password = 'testpassword123'

      const encrypted = await encrypt(plaintext, password)

      expect(encrypted.version).toBe(1)
      expect(encrypted.ciphertext).toBeDefined()
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.salt).toBeDefined()
      expect(encrypted.iterations).toBe(100000)
    })

    it('should encrypt string data', async () => {
      const plaintext = 'simple string'
      const password = 'password'

      const encrypted = await encrypt(plaintext, password)

      expect(isEncryptedData(encrypted)).toBe(true)
    })

    it('should generate different ciphertexts for same data', async () => {
      const plaintext = 'same data'
      const password = 'password'

      const encrypted1 = await encrypt(plaintext, password)
      const encrypted2 = await encrypt(plaintext, password)

      // Different salts and IVs should produce different ciphertexts
      expect(encrypted1.salt).not.toBe(encrypted2.salt)
      expect(encrypted1.iv).not.toBe(encrypted2.iv)
    })
  })

  describe('migrateLegacyData', () => {
    it('should migrate legacy base64 data to encrypted format', async () => {
      const walletData = {
        mnemonic: 'test mnemonic',
        walletWif: 'testWif'
      }
      const legacyData = btoa(JSON.stringify(walletData))
      const password = 'newpassword'

      const migrated = await migrateLegacyData(legacyData, password)

      expect(isEncryptedData(migrated)).toBe(true)
      expect(migrated.version).toBe(1)
      expect(migrated.iterations).toBe(100000)
    })
  })

  describe('Encryption Parameters', () => {
    it('should use 100000 PBKDF2 iterations (OWASP recommended)', async () => {
      const encrypted = await encrypt('data', 'password')
      expect(encrypted.iterations).toBe(100000)
    })

    it('should use version 1', async () => {
      const encrypted = await encrypt('data', 'password')
      expect(encrypted.version).toBe(1)
    })

    it('should generate 16-byte salt (128 bits)', async () => {
      const encrypted = await encrypt('data', 'password')
      // Base64 of 16 bytes = 24 chars (with padding) or 22-24 chars
      const saltBytes = atob(encrypted.salt)
      expect(saltBytes.length).toBe(16)
    })

    it('should generate 12-byte IV (96 bits for AES-GCM)', async () => {
      const encrypted = await encrypt('data', 'password')
      const ivBytes = atob(encrypted.iv)
      expect(ivBytes.length).toBe(12)
    })
  })
})
