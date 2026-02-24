/**
 * Tests for Account Management Service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createAccount,
  getAllAccounts,
  getActiveAccount,
  getAccountById,
  getAccountByIdentity,
  switchAccount,
  getAccountKeys,
  updateAccountName,
  deleteAccount,
  getAccountSettings,
  setAccountSettings,
  updateAccountSetting,
  getNextAccountNumber,
  isAccountSystemInitialized,
  encryptAllAccounts,
  DEFAULT_ACCOUNT_SETTINGS
} from './accounts'
import type { WalletKeys } from './wallet'

// Use vi.hoisted to define variables that can be used in mocks
const { mockDb, resetMockDb, autoIncrement } = vi.hoisted(() => {
  const state = {
    db: { accounts: [] as unknown[], account_settings: [] as unknown[] },
    counter: 1
  }
  return {
    mockDb: state,
    resetMockDb: () => {
      state.db = { accounts: [], account_settings: [] }
      state.counter = 1
    },
    autoIncrement: {
      get: () => state.counter,
      next: () => state.counter++
    }
  }
})

// Mock the database module
vi.mock('./database', () => {
  return {
    withTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    getDatabase: () => ({
      select: vi.fn(async (query: string, params?: unknown[]) => {
        // Parse the query to determine what to return
        if (query.includes('FROM accounts')) {
          if (query.includes('WHERE is_active = 1')) {
            return mockDb.db.accounts.filter((a: unknown) => (a as { is_active: number }).is_active === 1)
          }
          if (query.includes('WHERE id = $1') && params) {
            return mockDb.db.accounts.filter((a: unknown) => (a as { id: number }).id === params[0])
          }
          if (query.includes('WHERE identity_address = $1') && params) {
            return mockDb.db.accounts.filter((a: unknown) => (a as { identity_address: string }).identity_address === params[0])
          }
          return mockDb.db.accounts
        }
        if (query.includes('FROM account_settings')) {
          if (params) {
            return mockDb.db.account_settings.filter((s: unknown) => (s as { account_id: number }).account_id === params[0])
          }
          return mockDb.db.account_settings
        }
        return []
      }),
      execute: vi.fn(async (query: string, params?: unknown[]) => {
        if (query.includes('INSERT INTO accounts')) {
          const newAccount = {
            id: autoIncrement.next(),
            name: params?.[0],
            identity_address: params?.[1],
            encrypted_keys: params?.[2],
            is_active: 1,
            created_at: params?.[3],
            last_accessed_at: params?.[3]
          }
          mockDb.db.accounts.push(newAccount)
          return { lastInsertId: newAccount.id }
        }
        if (query.includes('UPDATE accounts SET is_active = 0')) {
          mockDb.db.accounts = mockDb.db.accounts.map((a: unknown) => ({ ...(a as object), is_active: 0 }))
          return { rowsAffected: mockDb.db.accounts.length }
        }
        if (query.includes('UPDATE accounts SET is_active = 1') && params) {
          mockDb.db.accounts = mockDb.db.accounts.map((a: unknown) => {
            const account = a as { id: number; is_active: number; last_accessed_at: number }
            if (account.id === params[1]) {
              return { ...account, is_active: 1, last_accessed_at: params[0] }
            }
            return account
          })
          return { rowsAffected: 1 }
        }
        if (query.includes('UPDATE accounts SET name = $1') && params) {
          mockDb.db.accounts = mockDb.db.accounts.map((a: unknown) => {
            const account = a as { id: number; name: string }
            if (account.id === params[1]) {
              return { ...account, name: params[0] }
            }
            return account
          })
          return { rowsAffected: 1 }
        }
        if (query.includes('UPDATE accounts SET encrypted_keys = $1') && params) {
          mockDb.db.accounts = mockDb.db.accounts.map((a: unknown) => {
            const account = a as { id: number; encrypted_keys: string }
            if (account.id === params[1]) {
              return { ...account, encrypted_keys: params[0] }
            }
            return account
          })
          return { rowsAffected: 1 }
        }
        if (query.includes('DELETE FROM accounts') && params) {
          mockDb.db.accounts = mockDb.db.accounts.filter((a: unknown) => (a as { id: number }).id !== params[0])
          return { rowsAffected: 1 }
        }
        if (query.includes('DELETE FROM account_settings') && params) {
          mockDb.db.account_settings = mockDb.db.account_settings.filter((s: unknown) => (s as { account_id: number }).account_id !== params[0])
          return { rowsAffected: 1 }
        }
        if (query.includes('INSERT OR REPLACE INTO account_settings') && params) {
          // Remove existing setting
          mockDb.db.account_settings = mockDb.db.account_settings.filter(
            (s: unknown) => !((s as { account_id: number; setting_key: string }).account_id === params[0] && (s as { account_id: number; setting_key: string }).setting_key === params[1])
          )
          // Add new setting
          mockDb.db.account_settings.push({
            account_id: params[0],
            setting_key: params[1],
            setting_value: params[2]
          })
          return { rowsAffected: 1 }
        }
        return { rowsAffected: 0 }
      })
    })
  }
})

// Mock crypto module
vi.mock('./crypto', () => ({
  encrypt: vi.fn(async (data: string, _password: string) => ({
    ciphertext: Buffer.from(data).toString('base64'),
    iv: 'mock-iv',
    salt: 'mock-salt',
    iterations: 100000,
    version: 1
  })),
  decrypt: vi.fn(async (encryptedData: { ciphertext: string }, _password: string) => {
    return Buffer.from(encryptedData.ciphertext, 'base64').toString()
  })
}))

// Mock wallet/storage module (used by encryptAllAccounts)
vi.mock('./wallet/storage', () => ({
  saveWallet: vi.fn(async () => ({ ok: true, value: undefined })),
  loadWallet: vi.fn(async () => ({ ok: true, value: null }))
}))


// Helper to create mock wallet keys
function createMockWalletKeys(suffix = '1'): WalletKeys {
  return {
    mnemonic: `test mnemonic words ${suffix}`,
    walletType: 'yours',
    walletWif: `wallet-wif-${suffix}`,
    walletAddress: `wallet-address-${suffix}`,
    walletPubKey: `wallet-pubkey-${suffix}`,
    ordWif: `ord-wif-${suffix}`,
    ordAddress: `ord-address-${suffix}`,
    ordPubKey: `ord-pubkey-${suffix}`,
    identityWif: `identity-wif-${suffix}`,
    identityAddress: `identity-address-${suffix}`,
    identityPubKey: `identity-pubkey-${suffix}`
  }
}

describe('Account Management Service', () => {
  beforeEach(() => {
    // Reset mock database before each test
    resetMockDb()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createAccount', () => {
    it('should reject empty passwords', async () => {
      const keys = createMockWalletKeys()
      // Empty string fails validatePassword (too short)
      const result = await createAccount('Test Account', keys, '')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toContain('Password must be at least 14 characters')
      }
    })

    it('should allow null password (creates unprotected account)', async () => {
      const keys = createMockWalletKeys()
      const result = await createAccount('Unprotected', keys, null)
      expect(result.ok).toBe(true)
      const accountId = result.ok ? result.value : 0
      expect(accountId).toBeGreaterThan(0)

      // Verify the stored format is unprotected
      const account = await getAccountById(accountId)
      const parsed = JSON.parse(account!.encryptedKeys)
      expect(parsed.version).toBe(0)
      expect(parsed.mode).toBe('unprotected')
      expect(parsed.keys.mnemonic).toBe(keys.mnemonic)
    })

    it('should require password to meet minimum requirements', async () => {
      const keys = createMockWalletKeys()
      // With default requirements, needs 14+ chars (NIST-aligned)
      const result1 = await createAccount('Test Account', keys, 'short')
      expect(result1.ok).toBe(false)
      if (!result1.ok) {
        expect(result1.error.message).toContain('Password must be at least 14 characters')
      }
      // Legacy mode only requires 12 chars
      const result2 = await createAccount('Test Account', keys, 'short', true)
      expect(result2.ok).toBe(false)
      if (!result2.ok) {
        expect(result2.error.message).toContain('Password must be at least 12 characters')
      }
    })

    it('should create a new account with encrypted keys', async () => {
      const keys = createMockWalletKeys()
      // Use legacy mode for simpler test passwords
      const result = await createAccount('Test Account', keys, 'password12345', true)
      expect(result.ok).toBe(true)
      const accountId = result.ok ? result.value : 0

      expect(accountId).toBe(1)

      const accounts = await getAllAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]!.name).toBe('Test Account')
      expect(accounts[0]!.identityAddress).toBe('identity-address-1')
      expect(accounts[0]!.isActive).toBe(true)
    })

    it('should deactivate existing accounts when creating new one', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      await createAccount('Account 1', keys1, 'password12345', true)
      await createAccount('Account 2', keys2, 'password12345', true)

      const accounts = await getAllAccounts()
      expect(accounts).toHaveLength(2)

      // Only the newest should be active
      const active = accounts.filter(a => a.isActive)
      expect(active).toHaveLength(1)
      expect(active[0]!.name).toBe('Account 2')
    })

    it('should set default settings for new account', async () => {
      const keys = createMockWalletKeys()
      const result = await createAccount('Test Account', keys, 'password12345', true)
      expect(result.ok).toBe(true)
      const accountId = result.ok ? result.value : 0

      const settings = await getAccountSettings(accountId)
      expect(settings.displayInSats).toBe(DEFAULT_ACCOUNT_SETTINGS.displayInSats)
      expect(settings.feeRateKB).toBe(DEFAULT_ACCOUNT_SETTINGS.feeRateKB)
      expect(settings.autoLockMinutes).toBe(DEFAULT_ACCOUNT_SETTINGS.autoLockMinutes)
    })
  })

  describe('getAllAccounts', () => {
    it('should return empty array when no accounts exist', async () => {
      const accounts = await getAllAccounts()
      expect(accounts).toEqual([])
    })

    it('should return all accounts ordered by last accessed', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      await createAccount('Account 1', keys1, 'password12345', true)
      await createAccount('Account 2', keys2, 'password12345', true)

      const accounts = await getAllAccounts()
      expect(accounts).toHaveLength(2)
    })
  })

  describe('getActiveAccount', () => {
    it('should return null when no accounts exist', async () => {
      const active = await getActiveAccount()
      expect(active).toBeNull()
    })

    it('should return the active account', async () => {
      const keys = createMockWalletKeys()
      await createAccount('Active Account', keys, 'password12345', true)

      const active = await getActiveAccount()
      expect(active).not.toBeNull()
      expect(active!.name).toBe('Active Account')
      expect(active!.isActive).toBe(true)
    })
  })

  describe('getAccountById', () => {
    it('should return null for non-existent ID', async () => {
      const account = await getAccountById(999)
      expect(account).toBeNull()
    })

    it('should return account by ID', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('My Account', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const account = await getAccountById(accountId)
      expect(account).not.toBeNull()
      expect(account!.id).toBe(accountId)
      expect(account!.name).toBe('My Account')
    })
  })

  describe('getAccountByIdentity', () => {
    it('should return null for non-existent identity', async () => {
      const account = await getAccountByIdentity('non-existent-identity')
      expect(account).toBeNull()
    })

    it('should return account by identity address', async () => {
      const keys = createMockWalletKeys()
      await createAccount('Identity Account', keys, 'password12345', true)

      const account = await getAccountByIdentity('identity-address-1')
      expect(account).not.toBeNull()
      expect(account!.identityAddress).toBe('identity-address-1')
    })
  })

  describe('switchAccount', () => {
    it('should switch to a different account', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      const r1 = await createAccount('Account 1', keys1, 'password12345', true)
      expect(r1.ok).toBe(true)
      const id1 = r1.ok ? r1.value : 0
      await createAccount('Account 2', keys2, 'password12345', true)

      // Account 2 is now active, switch to Account 1
      const result = await switchAccount(id1)
      expect(result).toBe(true)

      const active = await getActiveAccount()
      expect(active!.id).toBe(id1)
    })

    it('should update last_accessed_at when switching', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test Account', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const beforeSwitch = await getAccountById(accountId)
      const beforeTime = beforeSwitch!.lastAccessedAt

      // Wait a bit and switch
      await new Promise(resolve => setTimeout(resolve, 10))
      await switchAccount(accountId)

      const afterSwitch = await getAccountById(accountId)
      expect(afterSwitch!.lastAccessedAt).toBeGreaterThanOrEqual(beforeTime!)
    })
  })

  describe('getAccountKeys', () => {
    it('should decrypt and return wallet keys', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test Account', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const account = await getAccountById(accountId)
      const decryptedKeys = await getAccountKeys(account!, 'password12345')

      expect(decryptedKeys).not.toBeNull()
      expect(decryptedKeys!.mnemonic).toBe(keys.mnemonic)
      expect(decryptedKeys!.walletAddress).toBe(keys.walletAddress)
      expect(decryptedKeys!.identityAddress).toBe(keys.identityAddress)
    })

    it('should return keys directly for unprotected accounts (no password needed)', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Unprotected', keys, null)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const account = await getAccountById(accountId)
      const decryptedKeys = await getAccountKeys(account!, null)

      expect(decryptedKeys).not.toBeNull()
      expect(decryptedKeys!.mnemonic).toBe(keys.mnemonic)
      expect(decryptedKeys!.walletAddress).toBe(keys.walletAddress)
    })

    it('should require password for encrypted accounts', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Encrypted', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const account = await getAccountById(accountId)
      // Attempting to get keys without password should return null
      const result = await getAccountKeys(account!, null)
      expect(result).toBeNull()
    })
  })

  describe('updateAccountName', () => {
    it('should update account name', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Original Name', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const renameResult = await updateAccountName(accountId, 'New Name')
      expect(renameResult.ok).toBe(true)

      const account = await getAccountById(accountId)
      expect(account!.name).toBe('New Name')
    })
  })

  describe('deleteAccount', () => {
    it('should not delete the only account', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Only Account', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const result = await deleteAccount(accountId)
      expect(result.ok).toBe(true)
      expect(result.ok && result.value).toBe(false)

      const accounts = await getAllAccounts()
      expect(accounts).toHaveLength(1)
    })

    it('should delete account when multiple exist', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      const r1 = await createAccount('Account 1', keys1, 'password12345', true)
      expect(r1.ok).toBe(true)
      const id1 = r1.ok ? r1.value : 0
      await createAccount('Account 2', keys2, 'password12345', true)

      const result = await deleteAccount(id1)
      expect(result.ok).toBe(true)
      expect(result.ok && result.value).toBe(true)

      const accounts = await getAllAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]!.name).toBe('Account 2')
    })

    it('should activate another account if deleted account was active', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      await createAccount('Account 1', keys1, 'password12345', true)
      const r2 = await createAccount('Account 2', keys2, 'password12345', true)
      expect(r2.ok).toBe(true)
      const id2 = r2.ok ? r2.value : 0

      // Account 2 is active, delete it
      await deleteAccount(id2)

      const active = await getActiveAccount()
      expect(active).not.toBeNull()
      expect(active!.name).toBe('Account 1')
    })
  })

  describe('Account Settings', () => {
    it('should return default settings for new account', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const settings = await getAccountSettings(accountId)
      expect(settings).toEqual(DEFAULT_ACCOUNT_SETTINGS)
    })

    it('should update settings', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      await setAccountSettings(accountId, {
        displayInSats: true,
        feeRateKB: 100
      })

      const settings = await getAccountSettings(accountId)
      expect(settings.displayInSats).toBe(true)
      expect(settings.feeRateKB).toBe(100)
    })

    it('should update a single setting', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      await updateAccountSetting(accountId, 'autoLockMinutes', 30)

      const settings = await getAccountSettings(accountId)
      expect(settings.autoLockMinutes).toBe(30)
    })

    it('should handle trusted origins array', async () => {
      const keys = createMockWalletKeys()
      const r = await createAccount('Test', keys, 'password12345', true)
      expect(r.ok).toBe(true)
      const accountId = r.ok ? r.value : 0

      const origins = ['https://example.com', 'https://app.test.com']
      await setAccountSettings(accountId, { trustedOrigins: origins })

      const settings = await getAccountSettings(accountId)
      expect(settings.trustedOrigins).toEqual(origins)
    })
  })

  describe('Utility Functions', () => {
    it('getNextAccountNumber should return correct number', async () => {
      expect(await getNextAccountNumber()).toBe(1)

      const keys = createMockWalletKeys()
      await createAccount('Account 1', keys, 'password12345', true)

      expect(await getNextAccountNumber()).toBe(2)
    })

    it('isAccountSystemInitialized should return correct state', async () => {
      expect(await isAccountSystemInitialized()).toBe(false)

      const keys = createMockWalletKeys()
      await createAccount('Account 1', keys, 'password12345', true)

      expect(await isAccountSystemInitialized()).toBe(true)
    })
  })

  describe('DEFAULT_ACCOUNT_SETTINGS', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_ACCOUNT_SETTINGS.displayInSats).toBe(true)
      expect(DEFAULT_ACCOUNT_SETTINGS.feeRateKB).toBe(100)
      expect(DEFAULT_ACCOUNT_SETTINGS.autoLockMinutes).toBe(10)
      expect(DEFAULT_ACCOUNT_SETTINGS.trustedOrigins).toEqual([])
    })
  })

  describe('encryptAllAccounts', () => {
    it('should encrypt all unprotected accounts', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      // Create two unprotected accounts
      await createAccount('Account 1', keys1, null)
      await createAccount('Account 2', keys2, null)

      // Verify they are unprotected
      let accounts = await getAllAccounts()
      for (const account of accounts) {
        const parsed = JSON.parse(account.encryptedKeys)
        expect(parsed.version).toBe(0)
        expect(parsed.mode).toBe('unprotected')
      }

      // Encrypt all accounts with a valid password (14+ chars, NIST-aligned)
      await encryptAllAccounts('StrongPassword1!')

      // Verify they are now encrypted
      accounts = await getAllAccounts()
      for (const account of accounts) {
        const parsed = JSON.parse(account.encryptedKeys)
        expect(parsed.version).toBe(1)
        expect(parsed.ciphertext).toBeDefined()
      }
    })

    it('should skip already-encrypted accounts', async () => {
      const keys1 = createMockWalletKeys('1')
      const keys2 = createMockWalletKeys('2')

      // Create one encrypted and one unprotected account
      await createAccount('Encrypted', keys1, 'password12345', true)
      await createAccount('Unprotected', keys2, null)

      const accountsBefore = await getAllAccounts()
      const encryptedBefore = accountsBefore.find(a => a.name === 'Encrypted')!
      const originalEncryptedKeys = encryptedBefore.encryptedKeys

      await encryptAllAccounts('StrongPassword1!')

      const accountsAfter = await getAllAccounts()
      const encryptedAfter = accountsAfter.find(a => a.name === 'Encrypted')!
      const unprotectedAfter = accountsAfter.find(a => a.name === 'Unprotected')!

      // Already-encrypted account should be unchanged
      expect(encryptedAfter.encryptedKeys).toBe(originalEncryptedKeys)

      // Previously-unprotected account should now be encrypted
      const parsed = JSON.parse(unprotectedAfter.encryptedKeys)
      expect(parsed.version).toBe(1)
      expect(parsed.ciphertext).toBeDefined()
    })

    it('should validate password strength', async () => {
      const keys = createMockWalletKeys()
      await createAccount('Account', keys, null)

      // Too short
      const result1 = await encryptAllAccounts('short')
      expect(result1.ok).toBe(false)
      if (!result1.ok) {
        expect(result1.error.message).toContain('Password must be at least 14 characters')
      }

      // Empty
      const result2 = await encryptAllAccounts('')
      expect(result2.ok).toBe(false)
      if (!result2.ok) {
        expect(result2.error.message).toContain('Password must be at least 14 characters')
      }
    })

    it('should re-encrypt secure storage blob when wallet keys are loadable', async () => {
      const { loadWallet, saveWallet } = await import('./wallet/storage')
      const mockLoadWallet = vi.mocked(loadWallet)
      const mockSaveWallet = vi.mocked(saveWallet)

      const keys = createMockWalletKeys()
      await createAccount('Unprotected', keys, null)

      // Configure loadWallet to return keys (simulating unprotected wallet)
      mockLoadWallet.mockResolvedValueOnce({ ok: true, value: keys })

      await encryptAllAccounts('StrongPassword1!')

      // Phase 3: saveWallet should be called to re-encrypt secure storage
      expect(mockSaveWallet).toHaveBeenCalledWith(keys, 'StrongPassword1!')
    })

    it('should set HAS_PASSWORD flag even when loadWallet returns null', async () => {
      const keys = createMockWalletKeys()
      await createAccount('Unprotected', keys, null)

      // loadWallet returns null by default in mock
      await encryptAllAccounts('StrongPassword1!')

      // HAS_PASSWORD flag should still be set
      expect(localStorage.getItem('simply_sats_has_password')).toBe('true')
    })

    it('should do nothing when no unprotected accounts exist', async () => {
      const keys = createMockWalletKeys()
      await createAccount('Encrypted', keys, 'password12345', true)

      // Should not throw — just logs and returns
      await encryptAllAccounts('StrongPassword1!')

      // Account keys should be unchanged
      const accounts = await getAllAccounts()
      const parsed = JSON.parse(accounts[0]!.encryptedKeys)
      expect(parsed.version).toBe(1)
    })
  })
})
