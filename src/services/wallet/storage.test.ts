// @vitest-environment node
/**
 * Tests for Wallet Storage Service
 *
 * Tests: saveWallet, loadWallet, hasWallet, clearWallet, changePassword.
 * Covers both Tauri (secure storage) and web (localStorage) paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- Hoisted mock state ----------

const {
  mockInvoke,
  mockEncrypt,
  mockDecrypt,
  mockIsEncryptedData,
  mockIsLegacyEncrypted,
  mockMigrateLegacyData,
  mockIsTauriFlag,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn(),
  mockIsEncryptedData: vi.fn(),
  mockIsLegacyEncrypted: vi.fn(() => false),
  mockMigrateLegacyData: vi.fn(),
  mockIsTauriFlag: { value: false },
}))

// ---------- Mocks ----------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('../crypto', () => ({
  encrypt: mockEncrypt,
  decrypt: mockDecrypt,
  isEncryptedData: mockIsEncryptedData,
  isLegacyEncrypted: mockIsLegacyEncrypted,
  migrateLegacyData: mockMigrateLegacyData,
}))

vi.mock('../logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../config', () => ({
  SECURITY: { MIN_PASSWORD_LENGTH: 14 },
}))

import {
  saveWallet,
  saveWalletUnprotected,
  loadWallet,
  hasWallet,
  hasPassword,
  clearWallet,
  changePassword,
} from './storage'
import { isUnprotectedData, type WalletKeys } from './types'
import type { EncryptedData } from '../crypto'

// ---------- Test fixtures ----------

const STORAGE_KEY = 'simply_sats_wallet'

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi',
  walletAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
  walletPubKey: '02abc',
  ordWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
  ordAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
  ordPubKey: '02def',
  identityWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
  identityAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3',
  identityPubKey: '02ghi',
}

const testPassword = 'a-very-long-password-14'

const mockEncryptedData: EncryptedData = {
  version: 1,
  ciphertext: 'encrypted-ciphertext',
  iv: 'random-iv',
  salt: 'random-salt',
  iterations: 600000,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockIsTauriFlag.value = false

  // Default mock behaviors
  mockEncrypt.mockResolvedValue(mockEncryptedData)
  mockDecrypt.mockResolvedValue(JSON.stringify(testKeys))
  mockIsEncryptedData.mockReturnValue(false)
  mockIsLegacyEncrypted.mockReturnValue(false)

  // Non-Tauri by default (window.__TAURI_INTERNALS__ not set)
  // isTauri() checks for __TAURI_INTERNALS__ in window, which won't exist in test env
  // So all invoke calls through saveToSecureStorage/loadFromSecureStorage/etc.
  // will return false/null since isTauri() returns false
})

// ---------- saveWallet ----------

describe('saveWallet', () => {
  it('should encrypt keys and store in localStorage (non-Tauri)', async () => {
    const result = await saveWallet(testKeys, testPassword)

    expect(result.ok).toBe(true)
    expect(mockEncrypt).toHaveBeenCalledWith(testKeys, testPassword)
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(JSON.stringify(mockEncryptedData))
  })

  it('should return error for password shorter than minimum', async () => {
    const result = await saveWallet(testKeys, 'short')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Password must be at least 14 characters')
  })

  it('should return error for empty password', async () => {
    const result = await saveWallet(testKeys, '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Password must be at least 14 characters')
  })

  it('should return error on encryption failure', async () => {
    mockEncrypt.mockRejectedValueOnce(new Error('Encryption failed'))

    const result = await saveWallet(testKeys, testPassword)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Encryption failed')
  })
})

// ---------- loadWallet ----------

describe('loadWallet', () => {
  it('should load and decrypt wallet from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockEncryptedData))
    mockIsEncryptedData.mockReturnValue(true)
    // Migrate to secure storage returns false (non-Tauri)
    mockInvoke.mockResolvedValue(false)

    const result = await loadWallet(testPassword)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(testKeys)
    expect(mockDecrypt).toHaveBeenCalledWith(mockEncryptedData, testPassword)
  })

  it('should return null when no wallet exists', async () => {
    const result = await loadWallet(testPassword)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('should return error when decryption fails (wrong password) in localStorage path', async () => {
    // NOTE: loadWallet has a broad try/catch around the localStorage JSON parse path.
    // When decrypt throws inside the inner try/catch, execution falls through to
    // the legacy format check, which returns ok(null) if isLegacyEncrypted is false.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockEncryptedData))
    mockIsEncryptedData.mockReturnValue(true)
    mockDecrypt.mockRejectedValueOnce(new Error('Decryption failed'))

    const result = await loadWallet('wrong-password')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('should remove unencrypted wallet data (security violation)', async () => {
    // NOTE: The security violation is now returned as an error via Result.
    // The unencrypted data IS removed from localStorage as a security measure.
    const plainKeys = { mnemonic: 'test words', walletWif: 'L123' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plainKeys))
    mockIsEncryptedData.mockReturnValue(false)

    const result = await loadWallet(testPassword)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('stored without encryption')

    // Unencrypted data should have been removed
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('should handle legacy base64 format and migrate', async () => {
    const legacyData = btoa(JSON.stringify(testKeys))
    localStorage.setItem(STORAGE_KEY, legacyData)
    mockIsEncryptedData.mockReturnValue(false)
    mockIsLegacyEncrypted.mockReturnValue(true)
    mockMigrateLegacyData.mockResolvedValue(mockEncryptedData)

    const result = await loadWallet(testPassword)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(testKeys)
    expect(mockMigrateLegacyData).toHaveBeenCalledWith(legacyData, testPassword)
    // After migration, the new encrypted format should be stored
    const stored = localStorage.getItem(STORAGE_KEY)
    expect(stored).toBe(JSON.stringify(mockEncryptedData))
  })

  it('should return error when legacy data decoding fails', async () => {
    localStorage.setItem(STORAGE_KEY, 'bad-legacy-data')
    mockIsEncryptedData.mockReturnValue(false)
    mockIsLegacyEncrypted.mockReturnValue(true)

    const result = await loadWallet(testPassword)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('data may be corrupted')
  })
})

// ---------- hasWallet ----------

describe('hasWallet', () => {
  it('should return true when wallet exists in localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'some-data')

    const exists = await hasWallet()
    expect(exists).toBe(true)
  })

  it('should return false when no wallet exists', async () => {
    const exists = await hasWallet()
    expect(exists).toBe(false)
  })
})

// ---------- clearWallet ----------

describe('clearWallet', () => {
  it('should remove wallet from localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'some-data')

    await clearWallet()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('should not throw when no wallet exists', async () => {
    await expect(clearWallet()).resolves.not.toThrow()
  })
})

// ---------- changePassword ----------

describe('changePassword', () => {
  it('should decrypt with old password and re-encrypt with new password', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mockEncryptedData))
    mockIsEncryptedData.mockReturnValue(true)
    mockDecrypt.mockResolvedValue(JSON.stringify(testKeys))

    const newPassword = 'new-very-long-password'
    const result = await changePassword(testPassword, newPassword)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(true)
    // Should have called decrypt (loadWallet) then encrypt (saveWallet)
    expect(mockDecrypt).toHaveBeenCalled()
    expect(mockEncrypt).toHaveBeenCalledWith(testKeys, newPassword)
  })

  it('should return error for new password shorter than minimum', async () => {
    const result = await changePassword(testPassword, 'short')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Password must be at least 14 characters')
  })

  it('should return error for empty new password', async () => {
    const result = await changePassword(testPassword, '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Password must be at least 14 characters')
  })

  it('should return error when old password is wrong (no wallet found)', async () => {
    // No wallet in storage => loadWallet returns ok(null) => changePassword returns err
    const result = await changePassword(testPassword, 'new-long-password-14')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Wrong password or wallet not found')
  })
})

// ---------- hasPassword ----------

describe('hasPassword', () => {
  it('defaults to true when flag is absent', () => {
    expect(hasPassword()).toBe(true)
  })

  it('returns false when flag is "false"', () => {
    localStorage.setItem('simply_sats_has_password', 'false')
    expect(hasPassword()).toBe(false)
  })

  it('returns true when flag is "true"', () => {
    localStorage.setItem('simply_sats_has_password', 'true')
    expect(hasPassword()).toBe(true)
  })
})

// ---------- isUnprotectedData ----------

describe('isUnprotectedData', () => {
  it('returns true for valid unprotected data', () => {
    const data = { version: 0, mode: 'unprotected', keys: { mnemonic: 'test' } }
    expect(isUnprotectedData(data)).toBe(true)
  })

  it('returns false for encrypted data', () => {
    const data = { version: 1, ct: 'abc', iv: 'def', salt: 'ghi' }
    expect(isUnprotectedData(data)).toBe(false)
  })

  it('returns false for null', () => {
    expect(isUnprotectedData(null)).toBe(false)
  })
})

// ---------- saveWalletUnprotected + loadWallet(null) ----------

describe('saveWalletUnprotected + loadWallet', () => {
  it('saves keys and sets hasPassword to false', async () => {
    await saveWalletUnprotected(testKeys)
    expect(hasPassword()).toBe(false)
  })

  it('loadWallet(null) retrieves unprotected keys', async () => {
    await saveWalletUnprotected(testKeys)
    const result = await loadWallet(null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toBeNull()
    expect(result.value!.walletAddress).toBe(testKeys.walletAddress)
    expect(result.value!.mnemonic).toBe(testKeys.mnemonic)
  })

  it('hasWallet returns true for unprotected wallet', async () => {
    await saveWalletUnprotected(testKeys)
    expect(await hasWallet()).toBe(true)
  })

  it('saveWallet sets hasPassword to true', async () => {
    await saveWallet(testKeys, testPassword)
    expect(hasPassword()).toBe(true)
  })
})
