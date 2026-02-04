import { describe, it, expect } from 'vitest'
import {
  encrypt,
  decrypt,
  isEncryptedData,
  isLegacyEncrypted,
  migrateLegacyData,
  encryptWithSharedSecret,
  decryptWithSharedSecret,
  generateRandomKey,
  bytesToHex,
  EncryptedData
} from './crypto'

describe('Password-based Encryption', () => {
  const testPassword = 'securepassword123'
  const testPlaintext = 'sensitive wallet data'

  it('should encrypt and decrypt string data', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    const decrypted = await decrypt(encrypted, testPassword)
    expect(decrypted).toBe(testPlaintext)
  })

  it('should encrypt and decrypt object data', async () => {
    const testObject = { mnemonic: 'test words', walletWif: 'L123456' }
    const encrypted = await encrypt(testObject, testPassword)
    const decrypted = await decrypt(encrypted, testPassword)
    expect(JSON.parse(decrypted)).toEqual(testObject)
  })

  it('should produce different ciphertext for same plaintext (random IV/salt)', async () => {
    const encrypted1 = await encrypt(testPlaintext, testPassword)
    const encrypted2 = await encrypt(testPlaintext, testPassword)
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
    expect(encrypted1.iv).not.toBe(encrypted2.iv)
    expect(encrypted1.salt).not.toBe(encrypted2.salt)
  })

  it('should fail decryption with wrong password', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    await expect(decrypt(encrypted, 'wrongpassword')).rejects.toThrow('Decryption failed')
  })

  it('should fail decryption with tampered ciphertext', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    const tampered: EncryptedData = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'XXXX'
    }
    await expect(decrypt(tampered, testPassword)).rejects.toThrow('Decryption failed')
  })

  it('should include version and iterations in encrypted data', async () => {
    const encrypted = await encrypt(testPlaintext, testPassword)
    expect(encrypted.version).toBe(1)
    expect(encrypted.iterations).toBe(100000)
  })
})

describe('Encrypted Data Type Guard', () => {
  it('should identify valid encrypted data', () => {
    const valid: EncryptedData = {
      version: 1,
      ciphertext: 'abc123',
      iv: 'def456',
      salt: 'ghi789',
      iterations: 100000
    }
    expect(isEncryptedData(valid)).toBe(true)
  })

  it('should reject invalid encrypted data', () => {
    expect(isEncryptedData(null)).toBe(false)
    expect(isEncryptedData(undefined)).toBe(false)
    expect(isEncryptedData('string')).toBe(false)
    expect(isEncryptedData({ version: 1 })).toBe(false)
  })
})

describe('Legacy Format Detection', () => {
  it('should detect legacy base64-encoded wallet data', () => {
    const legacyData = btoa(JSON.stringify({
      mnemonic: 'test words here',
      walletWif: 'L1234567890'
    }))
    expect(isLegacyEncrypted(legacyData)).toBe(true)
  })

  it('should reject non-legacy data', () => {
    expect(isLegacyEncrypted('not base64')).toBe(false)
    expect(isLegacyEncrypted(btoa('not json'))).toBe(false)
  })
})

describe('Legacy Data Migration', () => {
  it('should migrate legacy data to new encrypted format', async () => {
    const testPassword = 'migrationPassword123'
    const legacyWalletData = {
      mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      walletWif: 'L1a2b3c4d5e6f7g8h9i0'
    }
    const legacyData = btoa(JSON.stringify(legacyWalletData))

    const migrated = await migrateLegacyData(legacyData, testPassword)

    expect(isEncryptedData(migrated)).toBe(true)
    expect(migrated.version).toBe(1)
    expect(migrated.iterations).toBe(100000)

    const decrypted = await decrypt(migrated, testPassword)
    expect(JSON.parse(decrypted)).toEqual(legacyWalletData)
  })
})

describe('Shared Secret Encryption', () => {
  it('should encrypt and decrypt with shared secret', async () => {
    const sharedSecret = await generateRandomKey()
    const message = 'Hello, encrypted world!'

    const encrypted = await encryptWithSharedSecret(message, sharedSecret)
    const decrypted = await decryptWithSharedSecret(encrypted, sharedSecret)

    expect(decrypted).toBe(message)
  })

  it('should produce different ciphertext for same message (random salt/IV)', async () => {
    const sharedSecret = await generateRandomKey()
    const message = 'Same message'

    const encrypted1 = await encryptWithSharedSecret(message, sharedSecret)
    const encrypted2 = await encryptWithSharedSecret(message, sharedSecret)

    expect(encrypted1).not.toBe(encrypted2)
  })

  it('should fail decryption with wrong shared secret', async () => {
    const sharedSecret1 = await generateRandomKey()
    const sharedSecret2 = await generateRandomKey()
    const message = 'Secret message'

    const encrypted = await encryptWithSharedSecret(message, sharedSecret1)

    await expect(decryptWithSharedSecret(encrypted, sharedSecret2)).rejects.toThrow()
  })
})

describe('Utility Functions', () => {
  it('should generate random 32-byte keys', async () => {
    const key1 = await generateRandomKey()
    const key2 = await generateRandomKey()
    expect(key1.length).toBe(64)
    expect(key2.length).toBe(64)
    expect(key1).not.toBe(key2)
  })

  it('should convert bytes to hex correctly', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x0f, 0xff])
    expect(bytesToHex(bytes)).toBe('00010fff')
  })

  it('should handle empty byte array', () => {
    const bytes = new Uint8Array([])
    expect(bytesToHex(bytes)).toBe('')
  })

  it('should pad single digit hex values', () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(bytesToHex(bytes)).toBe('000102030405060708090a0b0c0d0e0f')
  })
})
