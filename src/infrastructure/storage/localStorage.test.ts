/**
 * Tests for LocalStorage Abstraction Layer (localStorage.ts)
 *
 * Covers: storage object (balance, preferences, security, wallet, network, sync, UI),
 *         clearAll, clearCache, clearPrivacySensitive, registerExitCleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { storage, STORAGE_KEYS, PRIVACY_SENSITIVE_KEYS, registerExitCleanup } from './localStorage'

// Use jsdom-like localStorage mock
const localStorageMap = new Map<string, string>()

const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMap.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageMap.delete(key) }),
  clear: vi.fn(() => { localStorageMap.clear() }),
}

describe('LocalStorage Abstraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMap.clear()
    vi.stubGlobal('localStorage', mockLocalStorage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // =========================================================================
  // STORAGE_KEYS
  // =========================================================================

  describe('STORAGE_KEYS', () => {
    it('should export expected keys', () => {
      expect(STORAGE_KEYS.CACHED_BALANCE).toBe('simply_sats_cached_balance')
      expect(STORAGE_KEYS.WALLET).toBe('simply_sats_wallet')
      expect(STORAGE_KEYS.AUTO_LOCK_MINUTES).toBe('simply_sats_auto_lock_minutes')
    })
  })

  describe('PRIVACY_SENSITIVE_KEYS', () => {
    it('should include balance and sync keys', () => {
      expect(PRIVACY_SENSITIVE_KEYS).toContain(STORAGE_KEYS.CACHED_BALANCE)
      expect(PRIVACY_SENSITIVE_KEYS).toContain(STORAGE_KEYS.CACHED_ORD_BALANCE)
      expect(PRIVACY_SENSITIVE_KEYS).toContain(STORAGE_KEYS.LAST_SYNC)
    })
  })

  // =========================================================================
  // storage.balance
  // =========================================================================

  describe('storage.balance', () => {
    it('should return 0 when no balance is set', () => {
      expect(storage.balance.get()).toBe(0)
    })

    it('should get and set balance', () => {
      storage.balance.set(50000)
      expect(storage.balance.get()).toBe(50000)
    })

    it('should clear balance', () => {
      storage.balance.set(50000)
      storage.balance.clear()
      expect(storage.balance.get()).toBe(0)
    })

    it('should return 0 for invalid stored value', () => {
      localStorageMap.set(STORAGE_KEYS.CACHED_BALANCE, 'not-a-number')
      expect(storage.balance.get()).toBe(0)
    })
  })

  // =========================================================================
  // storage.ordBalance
  // =========================================================================

  describe('storage.ordBalance', () => {
    it('should return 0 when not set', () => {
      expect(storage.ordBalance.get()).toBe(0)
    })

    it('should get and set ordinals balance', () => {
      storage.ordBalance.set(42)
      expect(storage.ordBalance.get()).toBe(42)
    })

    it('should clear ordinals balance', () => {
      storage.ordBalance.set(42)
      storage.ordBalance.clear()
      expect(storage.ordBalance.get()).toBe(0)
    })
  })

  // =========================================================================
  // storage.autoLockMinutes
  // =========================================================================

  describe('storage.autoLockMinutes', () => {
    it('should return default 10 when not set', () => {
      expect(storage.autoLockMinutes.get()).toBe(10)
    })

    it('should get and set auto-lock minutes', () => {
      storage.autoLockMinutes.set(30)
      expect(storage.autoLockMinutes.get()).toBe(30)
    })

    it('should return default for invalid value', () => {
      localStorageMap.set(STORAGE_KEYS.AUTO_LOCK_MINUTES, 'abc')
      expect(storage.autoLockMinutes.get()).toBe(10)
    })

    it('should clear auto-lock minutes', () => {
      storage.autoLockMinutes.set(30)
      storage.autoLockMinutes.clear()
      expect(storage.autoLockMinutes.get()).toBe(10)
    })
  })

  // =========================================================================
  // storage.displayInSats
  // =========================================================================

  describe('storage.displayInSats', () => {
    it('should return true by default', () => {
      expect(storage.displayInSats.get()).toBe(true)
    })

    it('should get and set display preference', () => {
      storage.displayInSats.set(false)
      expect(storage.displayInSats.get()).toBe(false)
    })

    it('should clear display preference', () => {
      storage.displayInSats.set(false)
      storage.displayInSats.clear()
      expect(storage.displayInSats.get()).toBe(true)
    })
  })

  // =========================================================================
  // storage.feeRate
  // =========================================================================

  describe('storage.feeRate', () => {
    it('should return null when not set', () => {
      expect(storage.feeRate.get()).toBeNull()
    })

    it('should get and set fee rate', () => {
      storage.feeRate.set(0.5)
      expect(storage.feeRate.get()).toBe(0.5)
    })

    it('should return null for invalid fee rate', () => {
      localStorageMap.set(STORAGE_KEYS.FEE_RATE, 'abc')
      expect(storage.feeRate.get()).toBeNull()
    })

    it('should return null for zero or negative fee rate', () => {
      localStorageMap.set(STORAGE_KEYS.FEE_RATE, '0')
      expect(storage.feeRate.get()).toBeNull()

      localStorageMap.set(STORAGE_KEYS.FEE_RATE, '-1')
      expect(storage.feeRate.get()).toBeNull()
    })

    it('should clear fee rate', () => {
      storage.feeRate.set(0.5)
      storage.feeRate.clear()
      expect(storage.feeRate.get()).toBeNull()
    })
  })

  // =========================================================================
  // storage.trustedOrigins
  // =========================================================================

  describe('storage.trustedOrigins', () => {
    it('should return empty array when not set', () => {
      expect(storage.trustedOrigins.get()).toEqual([])
    })

    it('should add and check origins', () => {
      storage.trustedOrigins.add('https://example.com')
      expect(storage.trustedOrigins.has('https://example.com')).toBe(true)
      expect(storage.trustedOrigins.has('https://other.com')).toBe(false)
    })

    it('should not add duplicate origins', () => {
      storage.trustedOrigins.add('https://example.com')
      storage.trustedOrigins.add('https://example.com')
      expect(storage.trustedOrigins.get()).toHaveLength(1)
    })

    it('should remove origins', () => {
      storage.trustedOrigins.add('https://example.com')
      storage.trustedOrigins.add('https://other.com')
      storage.trustedOrigins.remove('https://example.com')
      expect(storage.trustedOrigins.get()).toEqual(['https://other.com'])
    })

    it('should clear all origins', () => {
      storage.trustedOrigins.add('https://example.com')
      storage.trustedOrigins.clear()
      expect(storage.trustedOrigins.get()).toEqual([])
    })

    it('should handle invalid JSON gracefully', () => {
      localStorageMap.set(STORAGE_KEYS.TRUSTED_ORIGINS, 'not-json')
      expect(storage.trustedOrigins.get()).toEqual([])
    })
  })

  // =========================================================================
  // storage.hasPassword
  // =========================================================================

  describe('storage.hasPassword', () => {
    it('should return true by default (not explicitly set to false)', () => {
      expect(storage.hasPassword.get()).toBe(true)
    })

    it('should return false when set to false', () => {
      storage.hasPassword.set(false)
      expect(storage.hasPassword.get()).toBe(false)
    })

    it('should return true when set to true', () => {
      storage.hasPassword.set(true)
      expect(storage.hasPassword.get()).toBe(true)
    })

    it('should clear password flag', () => {
      storage.hasPassword.set(false)
      storage.hasPassword.clear()
      expect(storage.hasPassword.get()).toBe(true) // Default
    })
  })

  // =========================================================================
  // storage.wallet
  // =========================================================================

  describe('storage.wallet', () => {
    it('should return null when no wallet is stored', () => {
      expect(storage.wallet.get()).toBeNull()
    })

    it('should get and set wallet data', () => {
      storage.wallet.set('encrypted-data-123')
      expect(storage.wallet.get()).toBe('encrypted-data-123')
    })

    it('should report existence correctly', () => {
      expect(storage.wallet.exists()).toBe(false)
      storage.wallet.set('data')
      expect(storage.wallet.exists()).toBe(true)
    })

    it('should clear wallet data', () => {
      storage.wallet.set('data')
      storage.wallet.clear()
      expect(storage.wallet.get()).toBeNull()
      expect(storage.wallet.exists()).toBe(false)
    })
  })

  // =========================================================================
  // storage.network
  // =========================================================================

  describe('storage.network', () => {
    it('should return mainnet by default', () => {
      expect(storage.network.get()).toBe('mainnet')
    })

    it('should get and set network', () => {
      storage.network.set('testnet')
      expect(storage.network.get()).toBe('testnet')
    })

    it('should return mainnet for invalid value', () => {
      localStorageMap.set(STORAGE_KEYS.NETWORK, 'invalid')
      expect(storage.network.get()).toBe('mainnet')
    })

    it('should clear network setting', () => {
      storage.network.set('testnet')
      storage.network.clear()
      expect(storage.network.get()).toBe('mainnet')
    })
  })

  // =========================================================================
  // storage.lastSync
  // =========================================================================

  describe('storage.lastSync', () => {
    it('should return null when not set', () => {
      expect(storage.lastSync.get()).toBeNull()
    })

    it('should get and set last sync timestamp', () => {
      const ts = Date.now()
      storage.lastSync.set(ts)
      expect(storage.lastSync.get()).toBe(ts)
    })

    it('should clear last sync', () => {
      storage.lastSync.set(Date.now())
      storage.lastSync.clear()
      expect(storage.lastSync.get()).toBeNull()
    })
  })

  // =========================================================================
  // storage.activeTab
  // =========================================================================

  describe('storage.activeTab', () => {
    it('should return activity by default', () => {
      expect(storage.activeTab.get()).toBe('activity')
    })

    it('should get and set active tab', () => {
      storage.activeTab.set('tokens')
      expect(storage.activeTab.get()).toBe('tokens')
    })
  })

  // =========================================================================
  // storage.sidebarCollapsed
  // =========================================================================

  describe('storage.sidebarCollapsed', () => {
    it('should return false by default', () => {
      expect(storage.sidebarCollapsed.get()).toBe(false)
    })

    it('should get and set sidebar state', () => {
      storage.sidebarCollapsed.set(true)
      expect(storage.sidebarCollapsed.get()).toBe(true)
    })
  })

  // =========================================================================
  // clearAll
  // =========================================================================

  describe('storage.clearAll', () => {
    it('should remove all Simply Sats keys', () => {
      storage.balance.set(5000)
      storage.wallet.set('data')
      storage.autoLockMinutes.set(15)

      storage.clearAll()

      expect(storage.balance.get()).toBe(0)
      expect(storage.wallet.get()).toBeNull()
      expect(storage.autoLockMinutes.get()).toBe(10)
    })
  })

  // =========================================================================
  // clearCache
  // =========================================================================

  describe('storage.clearCache', () => {
    it('should clear only cached data, not settings', () => {
      storage.balance.set(5000)
      storage.ordBalance.set(42)
      storage.lastSync.set(Date.now())
      storage.autoLockMinutes.set(30)

      storage.clearCache()

      expect(storage.balance.get()).toBe(0)
      expect(storage.ordBalance.get()).toBe(0)
      expect(storage.lastSync.get()).toBeNull()
      expect(storage.autoLockMinutes.get()).toBe(30) // Not cleared
    })
  })

  // =========================================================================
  // clearPrivacySensitive
  // =========================================================================

  describe('storage.clearPrivacySensitive', () => {
    it('should clear privacy-sensitive keys only', () => {
      storage.balance.set(5000)
      storage.ordBalance.set(42)
      storage.lastSync.set(Date.now())
      storage.wallet.set('encrypted-data')

      storage.clearPrivacySensitive()

      expect(storage.balance.get()).toBe(0)
      expect(storage.ordBalance.get()).toBe(0)
      expect(storage.lastSync.get()).toBeNull()
      expect(storage.wallet.get()).toBe('encrypted-data') // Not privacy-sensitive
    })
  })

  // =========================================================================
  // registerExitCleanup
  // =========================================================================

  describe('registerExitCleanup', () => {
    it('should register beforeunload and visibilitychange handlers', () => {
      const addEventSpy = vi.spyOn(window, 'addEventListener')
      const docAddEventSpy = vi.spyOn(document, 'addEventListener')

      const cleanup = registerExitCleanup()

      expect(addEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
      expect(docAddEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

      // Call cleanup to remove listeners
      cleanup()

      addEventSpy.mockRestore()
      docAddEventSpy.mockRestore()
    })

    it('should return a cleanup function that removes listeners', () => {
      const removeEventSpy = vi.spyOn(window, 'removeEventListener')
      const docRemoveEventSpy = vi.spyOn(document, 'removeEventListener')

      const cleanup = registerExitCleanup()
      cleanup()

      expect(removeEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
      expect(docRemoveEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

      removeEventSpy.mockRestore()
      docRemoveEventSpy.mockRestore()
    })
  })
})
