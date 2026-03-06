// @vitest-environment node

/**
 * Tests for Restore Service (restore.ts)
 *
 * Covers: restoreWalletFromBackup, importBackupDatabase, openAndParseBackupFile.
 *
 * Note: openAndParseBackupFile depends on Tauri file dialog/FS plugins
 * which are hard to mock in a unit test environment. We test
 * restoreWalletFromBackup and importBackupDatabase thoroughly instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockRestoreWallet,
  mockImportFromJSON,
  mockSaveWallet,
  mockSaveWalletUnprotected,
  mockImportDatabase,
  mockDecrypt,
  mockMigrateToMultiAccount,
  mockGetActiveAccount,
  mockDiscoverAccounts,
  mockInvoke,
  mockSetModuleSessionPassword,
  mockOpen,
  mockReadTextFile,
} = vi.hoisted(() => ({
  mockRestoreWallet: vi.fn(),
  mockImportFromJSON: vi.fn(),
  mockSaveWallet: vi.fn(),
  mockSaveWalletUnprotected: vi.fn(),
  mockImportDatabase: vi.fn(),
  mockDecrypt: vi.fn(),
  mockMigrateToMultiAccount: vi.fn(),
  mockGetActiveAccount: vi.fn(),
  mockDiscoverAccounts: vi.fn(),
  mockInvoke: vi.fn(),
  mockSetModuleSessionPassword: vi.fn(),
  mockOpen: vi.fn(),
  mockReadTextFile: vi.fn(),
}))

vi.mock('./wallet', () => ({
  restoreWallet: (...args: unknown[]) => mockRestoreWallet(...args),
  importFromJSON: (...args: unknown[]) => mockImportFromJSON(...args),
  saveWallet: (...args: unknown[]) => mockSaveWallet(...args),
  saveWalletUnprotected: (...args: unknown[]) => mockSaveWalletUnprotected(...args),
  toSessionWallet: (keys: { walletType: string; walletAddress: string; walletPubKey: string; ordAddress: string; ordPubKey: string; identityAddress: string; identityPubKey: string; accountIndex?: number }) => ({
    walletType: keys.walletType,
    walletAddress: keys.walletAddress,
    walletPubKey: keys.walletPubKey,
    ordAddress: keys.ordAddress,
    ordPubKey: keys.ordPubKey,
    identityAddress: keys.identityAddress,
    identityPubKey: keys.identityPubKey,
    accountIndex: keys.accountIndex,
  }),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}))

vi.mock('../infrastructure/database', () => ({
  importDatabase: (...args: unknown[]) => mockImportDatabase(...args),
}))

vi.mock('./crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}))

vi.mock('./accounts', () => ({
  migrateToMultiAccount: (...args: unknown[]) => mockMigrateToMultiAccount(...args),
  getActiveAccount: (...args: unknown[]) => mockGetActiveAccount(...args),
}))

vi.mock('./accountDiscovery', () => ({
  discoverAccounts: (...args: unknown[]) => mockDiscoverAccounts(...args),
}))

vi.mock('./sessionPasswordStore', () => ({
  setSessionPassword: (...args: unknown[]) => mockSetModuleSessionPassword(...args),
}))

vi.mock('./logger', () => ({
  walletLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  restoreWalletFromBackup,
  importBackupDatabase,
  openAndParseBackupFile,
  type FullBackup,
} from './restore'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function makeWalletKeys(overrides: Record<string, unknown> = {}) {
  return {
    mnemonic: VALID_MNEMONIC,
    walletType: 'yours',
    walletWif: 'L1walletWif',
    walletAddress: '1WalletAddr',
    walletPubKey: '02' + 'a'.repeat(64),
    ordWif: 'L2ordWif',
    ordAddress: '1OrdAddr',
    ordPubKey: '02' + 'b'.repeat(64),
    identityWif: 'L3identityWif',
    identityAddress: '1IdentityAddr',
    identityPubKey: '02' + 'c'.repeat(64),
    ...overrides,
  }
}

function makeMnemonicBackup(overrides: Partial<FullBackup> = {}): FullBackup {
  return {
    format: 'simply-sats-full',
    wallet: { mnemonic: VALID_MNEMONIC },
    ...overrides,
  }
}

function makeKeysBackup(overrides: Partial<FullBackup> = {}): FullBackup {
  return {
    format: 'simply-sats-full',
    wallet: {
      keys: {
        walletWif: 'L1walletWif',
        ordWif: 'L2ordWif',
        identityWif: 'L3identityWif',
      },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Restore Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // Default mocks for happy paths
    mockRestoreWallet.mockResolvedValue({
      ok: true,
      value: makeWalletKeys(),
    })
    mockImportFromJSON.mockResolvedValue({
      ok: true,
      value: makeWalletKeys({ mnemonic: '' }),
    })
    mockSaveWallet.mockResolvedValue({ ok: true })
    mockSaveWalletUnprotected.mockResolvedValue(undefined)
    mockMigrateToMultiAccount.mockResolvedValue(undefined)
    mockInvoke.mockResolvedValue(undefined)
    mockImportDatabase.mockResolvedValue(undefined)
    mockGetActiveAccount.mockResolvedValue({ id: 1 })
    mockDiscoverAccounts.mockResolvedValue(0)
  })

  // =========================================================================
  // restoreWalletFromBackup — mnemonic-based
  // =========================================================================

  describe('restoreWalletFromBackup (mnemonic-based)', () => {
    it('should restore wallet from backup with mnemonic', async () => {
      const backup = makeMnemonicBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).not.toHaveProperty('mnemonic')
      expect(result.value).not.toHaveProperty('walletWif')
      expect(result.value.walletAddress).toBe('1WalletAddr')
      expect(mockRestoreWallet).toHaveBeenCalledWith(VALID_MNEMONIC)
    })

    it('should save wallet with password when password is provided', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockSaveWallet).toHaveBeenCalledWith(
        expect.objectContaining({ walletAddress: '1WalletAddr' }),
        'testPassword'
      )
      expect(mockSaveWalletUnprotected).not.toHaveBeenCalled()
    })

    it('should save wallet unprotected when no password', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, null)

      expect(mockSaveWalletUnprotected).toHaveBeenCalled()
      expect(mockSaveWallet).not.toHaveBeenCalled()
    })

    it('should store keys in Rust key store', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockInvoke).toHaveBeenCalledWith('store_keys', {
        mnemonic: VALID_MNEMONIC,
        accountIndex: 0,
      })
    })

    it('should migrate to multi-account with mnemonic', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockMigrateToMultiAccount).toHaveBeenCalledWith(
        expect.objectContaining({ mnemonic: VALID_MNEMONIC }),
        'testPassword'
      )
    })

    it('should set session password', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockSetModuleSessionPassword).toHaveBeenCalledWith('testPassword')
    })

    it('should use empty string for session password when null', async () => {
      const backup = makeMnemonicBackup()
      await restoreWalletFromBackup(backup, null)

      expect(mockSetModuleSessionPassword).toHaveBeenCalledWith('')
    })

    it('should return error when restoreWallet fails', async () => {
      mockRestoreWallet.mockResolvedValue({
        ok: false,
        error: { message: 'Invalid mnemonic' },
      })

      const backup = makeMnemonicBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('Failed to restore wallet')
    })

    it('should return error when saveWallet fails', async () => {
      mockSaveWallet.mockResolvedValue({
        ok: false,
        error: 'Encryption failed',
      })

      const backup = makeMnemonicBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('Failed to save wallet')
    })

    it('should succeed even when Rust key store fails (non-fatal)', async () => {
      mockInvoke.mockRejectedValue(new Error('Rust key store error'))

      const backup = makeMnemonicBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      // Should still succeed — key store failure is non-fatal
      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // restoreWalletFromBackup — key-based
  // =========================================================================

  describe('restoreWalletFromBackup (key-based)', () => {
    it('should import wallet from backup with keys object', async () => {
      const backup = makeKeysBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value).not.toHaveProperty('mnemonic')
      expect(result.value).not.toHaveProperty('walletWif')
      expect(mockImportFromJSON).toHaveBeenCalled()
    })

    it('should save wallet with password for key-based backup', async () => {
      const backup = makeKeysBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockSaveWallet).toHaveBeenCalled()
    })

    it('should save wallet unprotected for key-based backup without password', async () => {
      const backup = makeKeysBackup()
      await restoreWalletFromBackup(backup, null)

      expect(mockSaveWalletUnprotected).toHaveBeenCalled()
    })

    it('should store keys directly when no mnemonic available', async () => {
      mockImportFromJSON.mockResolvedValue({
        ok: true,
        value: makeWalletKeys({ mnemonic: '' }),
      })

      const backup = makeKeysBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockInvoke).toHaveBeenCalledWith(
        'store_keys_direct',
        expect.objectContaining({
          walletWif: 'L1walletWif',
          mnemonic: null,
        })
      )
    })

    it('should store keys via mnemonic when imported keys include mnemonic', async () => {
      mockImportFromJSON.mockResolvedValue({
        ok: true,
        value: makeWalletKeys({ mnemonic: VALID_MNEMONIC, accountIndex: 2 }),
      })

      const backup = makeKeysBackup()
      await restoreWalletFromBackup(backup, 'testPassword')

      expect(mockInvoke).toHaveBeenCalledWith('store_keys', {
        mnemonic: VALID_MNEMONIC,
        accountIndex: 2,
      })
    })

    it('should return error when importFromJSON fails', async () => {
      mockImportFromJSON.mockResolvedValue({
        ok: false,
        error: { message: 'Unknown backup format' },
      })

      const backup = makeKeysBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('Failed to import wallet')
    })

    it('should succeed even when Rust key store fails for key-based restore', async () => {
      mockInvoke.mockRejectedValue(new Error('Rust key store unavailable'))

      const backup = makeKeysBackup()
      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(true)
    })
  })

  // =========================================================================
  // restoreWalletFromBackup — edge cases
  // =========================================================================

  describe('restoreWalletFromBackup (edge cases)', () => {
    it('should return error when backup has no mnemonic and no keys', async () => {
      const backup: FullBackup = {
        format: 'simply-sats-full',
        wallet: {},
      }

      const result = await restoreWalletFromBackup(backup, 'testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('does not contain wallet keys')
    })
  })

  // =========================================================================
  // importBackupDatabase
  // =========================================================================

  describe('importBackupDatabase', () => {
    const mockCallbacks = {
      refreshAccounts: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    }

    beforeEach(() => {
      mockCallbacks.refreshAccounts.mockClear()
      mockCallbacks.showToast.mockClear()
    })

    it('should import database from backup', async () => {
      const backup = makeMnemonicBackup({
        database: {
          utxos: [{ id: 1 }, { id: 2 }],
          transactions: [{ id: 1 }],
        } as unknown as import('../infrastructure/database').DatabaseBackup,
      })

      const stats = await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      expect(mockImportDatabase).toHaveBeenCalledWith(backup.database)
      expect(stats.utxoCount).toBe(2)
      expect(stats.txCount).toBe(1)
    })

    it('should return zero counts when no database in backup', async () => {
      const backup = makeMnemonicBackup()
      // backup has no database property

      const stats = await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      expect(mockImportDatabase).not.toHaveBeenCalled()
      expect(stats.utxoCount).toBe(0)
      expect(stats.txCount).toBe(0)
    })

    it('should trigger account discovery when mnemonic is available', async () => {
      mockDiscoverAccounts.mockResolvedValue(2)

      const backup = makeMnemonicBackup()
      await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      // Allow async discovery to complete
      await vi.waitFor(() => {
        expect(mockDiscoverAccounts).toHaveBeenCalledWith(
          VALID_MNEMONIC,
          'testPassword',
          1 // activeAfterRestore.id
        )
      })
    })

    it('should call refreshAccounts and showToast when accounts discovered', async () => {
      mockDiscoverAccounts.mockResolvedValue(3)

      const backup = makeMnemonicBackup()
      await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      // Allow async discovery to complete
      await vi.waitFor(() => {
        expect(mockCallbacks.refreshAccounts).toHaveBeenCalled()
        expect(mockCallbacks.showToast).toHaveBeenCalledWith(
          expect.stringContaining('3 additional accounts')
        )
      })
    })

    it('should not call refreshAccounts when no new accounts discovered', async () => {
      mockDiscoverAccounts.mockResolvedValue(0)

      const backup = makeMnemonicBackup()
      await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      // Allow async discovery to complete
      await vi.waitFor(() => {
        expect(mockDiscoverAccounts).toHaveBeenCalled()
      })

      expect(mockCallbacks.refreshAccounts).not.toHaveBeenCalled()
      expect(mockCallbacks.showToast).not.toHaveBeenCalled()
    })

    it('should not trigger discovery when no mnemonic in backup', async () => {
      const backup = makeKeysBackup()
      await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      expect(mockDiscoverAccounts).not.toHaveBeenCalled()
    })

    it('should handle discovery failure gracefully', async () => {
      mockDiscoverAccounts.mockRejectedValue(new Error('Discovery failed'))

      const backup = makeMnemonicBackup()
      // Should not throw
      const stats = await importBackupDatabase(backup, 'testPassword', mockCallbacks)

      expect(stats.utxoCount).toBe(0)
      expect(stats.txCount).toBe(0)
    })
  })

  // =========================================================================
  // openAndParseBackupFile
  // =========================================================================

  describe('openAndParseBackupFile', () => {
    it('should return cancelled when user cancels file dialog', async () => {
      mockOpen.mockResolvedValue(null)

      const result = await openAndParseBackupFile('testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('cancelled')
    })

    it('should return cancelled when open returns array', async () => {
      mockOpen.mockResolvedValue(['/path/a.json', '/path/b.json'])

      const result = await openAndParseBackupFile('testPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('cancelled')
    })

    it('should parse unencrypted backup file', async () => {
      const backup: FullBackup = {
        format: 'simply-sats-full',
        wallet: { mnemonic: VALID_MNEMONIC },
      }
      mockOpen.mockResolvedValue('/path/to/backup.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(backup))

      const result = await openAndParseBackupFile(null)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.backup.wallet.mnemonic).toBe(VALID_MNEMONIC)
    })

    it('should return error for invalid format', async () => {
      const badBackup = { format: 'unknown', wallet: {} }
      mockOpen.mockResolvedValue('/path/to/bad.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(badBackup))

      const result = await openAndParseBackupFile(null)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('invalid-format')
    })

    it('should return error for backup missing wallet field', async () => {
      const noWallet = { format: 'simply-sats-full' }
      mockOpen.mockResolvedValue('/path/to/nw.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(noWallet))

      const result = await openAndParseBackupFile(null)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('invalid-format')
    })

    it('should return encrypted-needs-password when encrypted and no password', async () => {
      const encrypted = {
        format: 'simply-sats-backup-encrypted',
        encrypted: { ciphertext: 'abc', iv: '123', salt: '456', version: 1, iterations: 600000 },
      }
      mockOpen.mockResolvedValue('/path/to/enc.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(encrypted))

      const result = await openAndParseBackupFile(null)

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('encrypted-needs-password')
    })

    it('should decrypt encrypted backup with password', async () => {
      const innerBackup: FullBackup = {
        format: 'simply-sats-full',
        wallet: { mnemonic: VALID_MNEMONIC },
      }
      const encrypted = {
        format: 'simply-sats-backup-encrypted',
        encrypted: { ciphertext: 'abc', iv: '123', salt: '456', version: 1, iterations: 600000 },
      }
      mockOpen.mockResolvedValue('/path/to/enc.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(encrypted))
      mockDecrypt.mockResolvedValue(JSON.stringify(innerBackup))

      const result = await openAndParseBackupFile('testPassword')

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.backup.wallet.mnemonic).toBe(VALID_MNEMONIC)
    })

    it('should return decrypt-failed when decryption fails', async () => {
      const encrypted = {
        format: 'simply-sats-backup-encrypted',
        encrypted: { ciphertext: 'abc', iv: '123', salt: '456', version: 1, iterations: 600000 },
      }
      mockOpen.mockResolvedValue('/path/to/enc.json')
      mockReadTextFile.mockResolvedValue(JSON.stringify(encrypted))
      mockDecrypt.mockRejectedValue(new Error('Decryption failed'))

      const result = await openAndParseBackupFile('wrongPassword')

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toBe('decrypt-failed')
    })
  })
})
