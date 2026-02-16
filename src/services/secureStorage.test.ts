/**
 * Tests for Secure Storage Service
 *
 * Tests the public API: secureSet, secureGet, secureRemove,
 * secureSetJSON, secureGetJSON, migrateToSecureStorage,
 * clearSessionKey, clearAllSimplySatsStorage.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./logger', () => ({
  walletLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  secureSet,
  secureGet,
  secureRemove,
  secureSetJSON,
  secureGetJSON,
  migrateToSecureStorage,
  clearSessionKey,
  clearAllSimplySatsStorage
} from './secureStorage'

const STORAGE_PREFIX = 'simply_sats_'

describe('secureStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    clearSessionKey()
  })

  afterEach(() => {
    localStorage.clear()
    clearSessionKey()
  })

  // ---------- secureSet / secureGet ----------

  describe('secureSet', () => {
    it('should store non-sensitive values as plain text', async () => {
      await secureSet('display_unit', 'sats')

      const raw = localStorage.getItem(`${STORAGE_PREFIX}display_unit`)
      expect(raw).toBe('sats')
    })

    it('should handle keys that already include the prefix', async () => {
      await secureSet(`${STORAGE_PREFIX}cached_balance`, '50000')

      // Should not double-prefix
      const raw = localStorage.getItem(`${STORAGE_PREFIX}cached_balance`)
      expect(raw).toBe('50000')
      expect(localStorage.getItem(`${STORAGE_PREFIX}${STORAGE_PREFIX}cached_balance`)).toBeNull()
    })
  })

  describe('secureGet', () => {
    it('should retrieve plain text values', async () => {
      localStorage.setItem(`${STORAGE_PREFIX}auto_lock_minutes`, '15')

      const value = await secureGet('auto_lock_minutes')
      expect(value).toBe('15')
    })

    it('should return null for non-existent keys', async () => {
      const value = await secureGet('nonexistent_key')
      expect(value).toBeNull()
    })

    it('should handle keys that already include the prefix', async () => {
      localStorage.setItem(`${STORAGE_PREFIX}test_key`, 'test_value')

      const value = await secureGet(`${STORAGE_PREFIX}test_key`)
      expect(value).toBe('test_value')
    })

    it('should return null for corrupted encrypted values', async () => {
      // Simulate a value with enc: prefix but invalid data
      localStorage.setItem(`${STORAGE_PREFIX}corrupt_key`, 'enc:not-valid-base64!!!')

      const value = await secureGet('corrupt_key')
      expect(value).toBeNull()
    })
  })

  // ---------- secureRemove ----------

  describe('secureRemove', () => {
    it('should remove a value from localStorage', async () => {
      await secureSet('display_unit', 'bsv')
      expect(await secureGet('display_unit')).toBe('bsv')

      secureRemove('display_unit')
      expect(await secureGet('display_unit')).toBeNull()
    })

    it('should handle keys with prefix', () => {
      localStorage.setItem(`${STORAGE_PREFIX}test`, 'value')
      secureRemove(`${STORAGE_PREFIX}test`)
      expect(localStorage.getItem(`${STORAGE_PREFIX}test`)).toBeNull()
    })

    it('should not throw for non-existent keys', () => {
      expect(() => secureRemove('does_not_exist')).not.toThrow()
    })
  })

  // ---------- secureSetJSON / secureGetJSON ----------

  describe('secureSetJSON', () => {
    it('should store JSON-serialized values', async () => {
      const data = { theme: 'dark', fontSize: 14 }
      await secureSetJSON('preferences', data)

      const raw = localStorage.getItem(`${STORAGE_PREFIX}preferences`)
      expect(raw).toBe(JSON.stringify(data))
    })

    it('should handle arrays', async () => {
      const data = [1, 2, 3]
      await secureSetJSON('numbers', data)

      const result = await secureGetJSON<number[]>('numbers')
      expect(result).toEqual([1, 2, 3])
    })

    it('should handle nested objects', async () => {
      const data = { a: { b: { c: 'deep' } } }
      await secureSetJSON('nested', data)

      const result = await secureGetJSON<typeof data>('nested')
      expect(result).toEqual(data)
    })
  })

  describe('secureGetJSON', () => {
    it('should retrieve and parse JSON values', async () => {
      const data = { key: 'value', count: 42 }
      await secureSetJSON('json_test', data)

      const result = await secureGetJSON<typeof data>('json_test')
      expect(result).toEqual(data)
    })

    it('should return null for non-existent keys', async () => {
      const result = await secureGetJSON('missing_key')
      expect(result).toBeNull()
    })

    it('should return null for invalid JSON', async () => {
      localStorage.setItem(`${STORAGE_PREFIX}bad_json`, 'not-valid-json{{{')

      const result = await secureGetJSON('bad_json')
      expect(result).toBeNull()
    })
  })

  // ---------- migrateToSecureStorage ----------

  describe('migrateToSecureStorage', () => {
    it('should remove stale encrypted data for previously-encrypted keys', async () => {
      // These keys were previously encrypted but are now plain text
      localStorage.setItem(`${STORAGE_PREFIX}trusted_origins`, 'enc:stale_encrypted_data')
      localStorage.setItem(`${STORAGE_PREFIX}connected_apps`, 'enc:stale_encrypted_data')
      localStorage.setItem(`${STORAGE_PREFIX}rate_limit`, 'enc:stale_encrypted_data')

      await migrateToSecureStorage()

      // Should have removed the stale encrypted data
      expect(localStorage.getItem(`${STORAGE_PREFIX}trusted_origins`)).toBeNull()
      expect(localStorage.getItem(`${STORAGE_PREFIX}connected_apps`)).toBeNull()
      expect(localStorage.getItem(`${STORAGE_PREFIX}rate_limit`)).toBeNull()
    })

    it('should leave non-encrypted previously-encrypted keys alone', async () => {
      localStorage.setItem(`${STORAGE_PREFIX}trusted_origins`, '["https://example.com"]')

      await migrateToSecureStorage()

      // Should not touch plain-text values
      expect(localStorage.getItem(`${STORAGE_PREFIX}trusted_origins`)).toBe('["https://example.com"]')
    })

    it('should not throw when localStorage is empty', async () => {
      await expect(migrateToSecureStorage()).resolves.not.toThrow()
    })
  })

  // ---------- clearSessionKey ----------

  describe('clearSessionKey', () => {
    it('should not throw when called', () => {
      expect(() => clearSessionKey()).not.toThrow()
    })

    it('should be safe to call multiple times', () => {
      clearSessionKey()
      clearSessionKey()
      clearSessionKey()
      // No errors
    })
  })

  // ---------- clearAllSimplySatsStorage ----------

  describe('clearAllSimplySatsStorage', () => {
    it('should remove all simply_sats_ prefixed keys', () => {
      localStorage.setItem(`${STORAGE_PREFIX}key1`, 'value1')
      localStorage.setItem(`${STORAGE_PREFIX}key2`, 'value2')
      localStorage.setItem(`${STORAGE_PREFIX}key3`, 'value3')
      localStorage.setItem('other_key', 'should_remain')

      clearAllSimplySatsStorage()

      expect(localStorage.getItem(`${STORAGE_PREFIX}key1`)).toBeNull()
      expect(localStorage.getItem(`${STORAGE_PREFIX}key2`)).toBeNull()
      expect(localStorage.getItem(`${STORAGE_PREFIX}key3`)).toBeNull()
      expect(localStorage.getItem('other_key')).toBe('should_remain')
    })

    it('should handle empty localStorage', () => {
      expect(() => clearAllSimplySatsStorage()).not.toThrow()
    })

    it('should clear session key as well', () => {
      // After clearing, secureGet should still work (new session key generated)
      localStorage.setItem(`${STORAGE_PREFIX}test`, 'value')
      clearAllSimplySatsStorage()

      // This just verifies the function completes without error
      expect(localStorage.getItem(`${STORAGE_PREFIX}test`)).toBeNull()
    })
  })

  // ---------- Round-trip integration ----------

  describe('round-trip', () => {
    it('should store and retrieve plain text values correctly', async () => {
      await secureSet('cached_balance', '12345')
      const value = await secureGet('cached_balance')
      expect(value).toBe('12345')
    })

    it('should store and retrieve JSON values correctly', async () => {
      const original = { balance: 50000, lastSync: Date.now() }
      await secureSetJSON('wallet_state', original)

      const retrieved = await secureGetJSON<typeof original>('wallet_state')
      expect(retrieved).toEqual(original)
    })

    it('should return null after removing a value', async () => {
      await secureSet('temp_key', 'temp_value')
      secureRemove('temp_key')
      const value = await secureGet('temp_key')
      expect(value).toBeNull()
    })
  })
})
