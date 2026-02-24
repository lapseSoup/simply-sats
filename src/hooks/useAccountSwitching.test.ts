// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Mocks (must be before imports) ---

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../services/accounts', () => ({
  getActiveAccount: vi.fn(),
  switchAccount: vi.fn(),
}))

vi.mock('../services/accountDiscovery', () => ({
  discoverAccounts: vi.fn(),
}))

vi.mock('../services/sync', () => ({
  cancelSync: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  walletLogger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../services/sessionPasswordStore', () => ({
  getSessionPassword: vi.fn(),
  clearSessionPassword: vi.fn(),
  setSessionPassword: vi.fn(),
  NO_PASSWORD: '',
}))

// --- Imports ---

import {
  useAccountSwitching,
  isAccountSwitchInProgress,
  switchJustCompleted,
  getLastSwitchDiag,
} from './useAccountSwitching'
import { invoke } from '@tauri-apps/api/core'
import { switchAccount as switchAccountDb, getActiveAccount } from '../services/accounts'
import { discoverAccounts } from '../services/accountDiscovery'
import { cancelSync } from '../services/sync'
import { getSessionPassword, clearSessionPassword } from '../services/sessionPasswordStore'
import type { Account } from '../services/accounts'
import type { WalletKeys, PublicWalletKeys } from '../services/wallet'

const mockedInvoke = vi.mocked(invoke)
const mockedSwitchAccountDb = vi.mocked(switchAccountDb)
const mockedGetActiveAccount = vi.mocked(getActiveAccount)
const mockedGetSessionPassword = vi.mocked(getSessionPassword)
const mockedClearSessionPassword = vi.mocked(clearSessionPassword)
const mockedCancelSync = vi.mocked(cancelSync)
const mockedDiscoverAccounts = vi.mocked(discoverAccounts)

// --- Helpers ---

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    name: 'Test Account',
    identityAddress: '1TestIdentity',
    encryptedKeys: '{}',
    isActive: true,
    createdAt: Date.now(),
    derivationIndex: 0,
    ...overrides,
  }
}

function makeWalletKeys(overrides: Partial<WalletKeys> = {}): WalletKeys {
  return {
    mnemonic: 'test mnemonic words here for testing purposes only not real',
    walletType: 'yours',
    walletWif: 'wif-wallet',
    walletAddress: '1WalletAddress',
    walletPubKey: 'pubkey-wallet',
    ordWif: 'wif-ord',
    ordAddress: '1OrdAddress',
    ordPubKey: 'pubkey-ord',
    identityWif: 'wif-identity',
    identityAddress: '1IdentityAddress',
    identityPubKey: 'pubkey-identity',
    accountIndex: 0,
    ...overrides,
  }
}

function makePublicWalletKeys(overrides: Partial<PublicWalletKeys> = {}): PublicWalletKeys {
  return {
    walletType: 'yours',
    walletAddress: '1WalletAddress',
    walletPubKey: 'pubkey-wallet',
    ordAddress: '1OrdAddress',
    ordPubKey: 'pubkey-ord',
    identityAddress: '1IdentityAddress',
    identityPubKey: 'pubkey-identity',
    ...overrides,
  }
}

function makeOptions(overrides: Partial<Parameters<typeof useAccountSwitching>[0]> = {}) {
  return {
    fetchVersionRef: { current: 0 },
    accountsSwitchAccount: vi.fn().mockResolvedValue(null),
    accountsCreateNewAccount: vi.fn().mockResolvedValue(null),
    accountsImportAccount: vi.fn().mockResolvedValue(null),
    accountsDeleteAccount: vi.fn().mockResolvedValue(false),
    getKeysForAccount: vi.fn().mockResolvedValue(null),
    setWallet: vi.fn(),
    setIsLocked: vi.fn(),
    setLocks: vi.fn(),
    resetSync: vi.fn(),
    resetKnownUnlockedLocks: vi.fn(),
    storeKeysInRust: vi.fn().mockResolvedValue(undefined),
    refreshAccounts: vi.fn().mockResolvedValue(undefined),
    setActiveAccountState: vi.fn(),
    fetchDataFromDB: vi.fn().mockResolvedValue(undefined),
    wallet: null,
    accounts: [makeAccount({ id: 1 }), makeAccount({ id: 2, name: 'Account 2', derivationIndex: 1 })],
    ...overrides,
  }
}

// --- Tests ---

describe('useAccountSwitching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: Rust invoke succeeds
    mockedInvoke.mockResolvedValue(makePublicWalletKeys())
    mockedSwitchAccountDb.mockResolvedValue(true)
    mockedGetSessionPassword.mockReturnValue('testpassword')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('switchAccount — Rust-first path', () => {
    it('switches account successfully via Rust key derivation', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      expect(success).toBe(true)
      expect(mockedInvoke).toHaveBeenCalledWith('switch_account_from_store', { accountIndex: 1 })
      expect(mockedSwitchAccountDb).toHaveBeenCalledWith(2)
      expect(opts.setWallet).toHaveBeenCalledTimes(1)
      // Wallet keys should have mnemonic cleared
      const walletArg = vi.mocked(opts.setWallet).mock.calls[0]![0] as WalletKeys
      expect(walletArg.mnemonic).toBe('')
      expect(walletArg.walletAddress).toBe('1WalletAddress')
      expect(opts.setIsLocked).toHaveBeenCalledWith(false)
      expect(opts.setActiveAccountState).toHaveBeenCalled()
    })

    it('cancels in-flight sync before switching', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(mockedCancelSync).toHaveBeenCalledTimes(1)
    })

    it('increments fetchVersionRef to invalidate stale callbacks', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      const initialVersion = opts.fetchVersionRef.current
      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(opts.fetchVersionRef.current).toBeGreaterThan(initialVersion)
    })

    it('resets known unlocked locks on switch', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(opts.resetKnownUnlockedLocks).toHaveBeenCalledTimes(1)
    })

    it('does NOT call storeKeysInRust when keys come from Rust', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      // Rust-derived keys are already stored — no need to store again
      expect(opts.storeKeysInRust).not.toHaveBeenCalled()
    })

    it('calls fetchDataFromDB to preload cached data', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(1)
      const [keys, accountId] = vi.mocked(opts.fetchDataFromDB).mock.calls[0]!
      expect(keys.walletAddress).toBe('1WalletAddress')
      expect(accountId).toBe(2)
    })

    it('returns false when target account is not found', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(999)
      })

      expect(success).toBe(false)
      expect(opts.setWallet).not.toHaveBeenCalled()
      expect(getLastSwitchDiag()).toContain('not in')
    })

    it('returns false when DB active account update fails', async () => {
      mockedSwitchAccountDb.mockResolvedValue(false)
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      expect(success).toBe(false)
      expect(opts.setWallet).not.toHaveBeenCalled()
    })

    it('calls rotate_session_for_account after setting wallet', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(mockedInvoke).toHaveBeenCalledWith('rotate_session_for_account', { accountId: 2 })
    })

    it('handles rotate_session_for_account timeout gracefully', async () => {
      // First call is switch_account_from_store (succeeds), second is rotate_session (times out)
      mockedInvoke
        .mockResolvedValueOnce(makePublicWalletKeys())
        .mockRejectedValueOnce(new Error('rotate_session timed out'))
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      // Should still succeed despite rotate_session failure
      expect(success).toBe(true)
      expect(opts.setWallet).toHaveBeenCalledTimes(1)
    })
  })

  describe('switchAccount — password fallback path', () => {
    beforeEach(() => {
      // Rust invoke fails — triggers fallback
      mockedInvoke.mockRejectedValue(new Error('No mnemonic in store'))
    })

    it('falls back to password-based switch when Rust derivation fails', async () => {
      const fallbackKeys = makeWalletKeys({ walletAddress: '1FallbackAddr' })
      const opts = makeOptions({
        accountsSwitchAccount: vi.fn().mockResolvedValue(fallbackKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      expect(success).toBe(true)
      expect(opts.accountsSwitchAccount).toHaveBeenCalledWith(2, 'testpassword')
      expect(mockedClearSessionPassword).toHaveBeenCalled()
    })

    it('calls storeKeysInRust for password-fallback keys', async () => {
      const fallbackKeys = makeWalletKeys({ accountIndex: 1 })
      const opts = makeOptions({
        accountsSwitchAccount: vi.fn().mockResolvedValue(fallbackKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(opts.storeKeysInRust).toHaveBeenCalledWith(fallbackKeys.mnemonic, 1)
    })

    it('returns false when no session password and Rust fails', async () => {
      mockedGetSessionPassword.mockReturnValue(null)
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      expect(success).toBe(false)
      expect(opts.setWallet).not.toHaveBeenCalled()
      expect(getLastSwitchDiag()).toContain('NO PWD')
    })

    it('does NOT clear session password if password switch throws', async () => {
      const opts = makeOptions({
        accountsSwitchAccount: vi.fn().mockRejectedValue(new Error('decrypt failed')),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      expect(success).toBe(false)
      expect(mockedClearSessionPassword).not.toHaveBeenCalled()
    })
  })

  describe('switchAccount — mutex / queuing behavior', () => {
    it('queues a switch when one is already in progress', async () => {
      // Make the first switch slow so we can queue a second
      let resolveFirst: (v: PublicWalletKeys) => void
      mockedInvoke.mockImplementationOnce(
        () => new Promise<PublicWalletKeys>((resolve) => { resolveFirst = resolve })
      )

      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let firstResult: boolean | undefined
      let secondResult: boolean | undefined

      // Start first switch (will block)
      const firstPromise = act(async () => {
        firstResult = await result.current.switchAccount(1)
      })

      // Queue second switch while first is in progress
      await act(async () => {
        secondResult = await result.current.switchAccount(2)
      })

      // Second switch should return false (queued, not executed)
      expect(secondResult).toBe(false)

      // Now resolve the first switch
      mockedInvoke.mockResolvedValue(makePublicWalletKeys())
      resolveFirst!(makePublicWalletKeys())
      await firstPromise

      expect(firstResult).toBe(true)
    })

    it('executes queued switch after current one finishes', async () => {
      let resolveFirst: () => void
      const firstPromise = new Promise<void>((r) => { resolveFirst = r })

      // Make fetchDataFromDB block for the first call
      const opts = makeOptions({
        fetchDataFromDB: vi.fn()
          .mockImplementationOnce(() => firstPromise)
          .mockResolvedValue(undefined),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      // Start first switch (blocks on fetchDataFromDB)
      const switch1 = act(async () => {
        await result.current.switchAccount(1)
      })

      // Queue switch to account 2
      await act(async () => {
        result.current.switchAccount(2)
      })

      // Resolve the first switch
      resolveFirst!()
      await switch1

      // Give the queued switch time to execute
      await act(async () => {
        await new Promise(r => setTimeout(r, 50))
      })

      // The queued switch to account 2 should have been initiated
      // We can verify by checking that setActiveAccountState was called with account id 2
      const calls = vi.mocked(opts.setActiveAccountState).mock.calls
      const lastCall = calls[calls.length - 1]
      if (lastCall) {
        const [account, _accountId] = lastCall
        // The queued switch should be for account 2
        expect(account?.id === 2 || _accountId === 2).toBe(true)
      }
    })
  })

  describe('switchJustCompleted and switchInProgress', () => {
    it('switchInProgress is false before and after a successful switch', async () => {
      expect(isAccountSwitchInProgress()).toBe(false)

      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(isAccountSwitchInProgress()).toBe(false)
    })

    it('switchInProgress is false after a failed switch', async () => {
      const opts = makeOptions({ accounts: [] })
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(999)
      })

      expect(isAccountSwitchInProgress()).toBe(false)
    })

    it('switchJustCompleted returns true within 2s of successful switch', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      expect(switchJustCompleted()).toBe(true)
    })

    it('switchJustCompleted returns false after 2s window', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      // Fast-forward past the 2-second window
      vi.useFakeTimers()
      vi.advanceTimersByTime(2001)
      expect(switchJustCompleted()).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('createNewAccount', () => {
    it('creates account successfully with session password', async () => {
      const newKeys = makeWalletKeys({ accountIndex: 2 })
      const opts = makeOptions({
        accountsCreateNewAccount: vi.fn().mockResolvedValue(newKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.createNewAccount('New Account')
      })

      expect(success).toBe(true)
      expect(opts.accountsCreateNewAccount).toHaveBeenCalledWith('New Account', 'testpassword')
      expect(opts.storeKeysInRust).toHaveBeenCalledWith(newKeys.mnemonic, 2)
      // Wallet should have mnemonic cleared
      const walletArg = vi.mocked(opts.setWallet).mock.calls[0]![0] as WalletKeys
      expect(walletArg.mnemonic).toBe('')
    })

    it('returns false when no session password', async () => {
      mockedGetSessionPassword.mockReturnValue(null)
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.createNewAccount('New Account')
      })

      expect(success).toBe(false)
      expect(opts.accountsCreateNewAccount).not.toHaveBeenCalled()
    })

    it('blocks creation when 10 accounts already exist', async () => {
      const tenAccounts = Array.from({ length: 10 }, (_, i) =>
        makeAccount({ id: i + 1, name: `Account ${i + 1}` })
      )
      const opts = makeOptions({ accounts: tenAccounts })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.createNewAccount('Account 11')
      })

      expect(success).toBe(false)
      expect(opts.accountsCreateNewAccount).not.toHaveBeenCalled()
    })

    it('passes null password when NO_PASSWORD sentinel is active', async () => {
      mockedGetSessionPassword.mockReturnValue('') // NO_PASSWORD is ''
      const newKeys = makeWalletKeys()
      const opts = makeOptions({
        accountsCreateNewAccount: vi.fn().mockResolvedValue(newKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.createNewAccount('No-Pwd Account')
      })

      expect(opts.accountsCreateNewAccount).toHaveBeenCalledWith('No-Pwd Account', null)
    })

    it('returns false when accountsCreateNewAccount returns null', async () => {
      const opts = makeOptions({
        accountsCreateNewAccount: vi.fn().mockResolvedValue(null),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.createNewAccount('Fail')
      })

      expect(success).toBe(false)
      expect(opts.setWallet).not.toHaveBeenCalled()
    })
  })

  describe('importAccount', () => {
    it('imports account and triggers discovery', async () => {
      const importedKeys = makeWalletKeys({ accountIndex: 2 })
      mockedGetActiveAccount.mockResolvedValue(makeAccount({ id: 3 }))
      mockedDiscoverAccounts.mockResolvedValue(2)
      const opts = makeOptions({
        accountsImportAccount: vi.fn().mockResolvedValue(importedKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.importAccount('Imported', 'word1 word2 word3')
      })

      expect(success).toBe(true)
      expect(opts.accountsImportAccount).toHaveBeenCalledWith('Imported', 'word1 word2 word3', 'testpassword')
      expect(opts.storeKeysInRust).toHaveBeenCalled()
      expect(opts.setIsLocked).toHaveBeenCalledWith(false)
    })

    it('returns false when no session password', async () => {
      mockedGetSessionPassword.mockReturnValue(null)
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.importAccount('Fail', 'mnemonic words')
      })

      expect(success).toBe(false)
    })

    it('returns false when import returns null keys', async () => {
      const opts = makeOptions({
        accountsImportAccount: vi.fn().mockResolvedValue(null),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.importAccount('Fail', 'mnemonic words')
      })

      expect(success).toBe(false)
      expect(opts.setWallet).not.toHaveBeenCalled()
    })
  })

  describe('deleteAccount', () => {
    it('deletes account successfully', async () => {
      const opts = makeOptions({
        accountsDeleteAccount: vi.fn().mockResolvedValue(true),
        wallet: makeWalletKeys(),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.deleteAccount(2)
      })

      expect(success).toBe(true)
      expect(opts.accountsDeleteAccount).toHaveBeenCalledWith(2)
    })

    it('returns false when deletion fails', async () => {
      const opts = makeOptions({
        accountsDeleteAccount: vi.fn().mockResolvedValue(false),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.deleteAccount(2)
      })

      expect(success).toBe(false)
    })

    it('switches to remaining account via Rust when wallet is null after delete', async () => {
      const remainingAccount = makeAccount({ id: 1 })
      mockedGetActiveAccount.mockResolvedValue(remainingAccount)
      const rustKeys = makePublicWalletKeys({ walletAddress: '1RemainingAddr' })
      mockedInvoke.mockResolvedValue(rustKeys)

      const opts = makeOptions({
        accountsDeleteAccount: vi.fn().mockResolvedValue(true),
        wallet: null,
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.deleteAccount(2)
      })

      // Should have invoked Rust to derive keys for the remaining account
      expect(mockedInvoke).toHaveBeenCalledWith('switch_account_from_store', { accountIndex: 0 })
      expect(opts.setWallet).toHaveBeenCalled()
    })

    it('falls back to password derivation after delete when Rust fails', async () => {
      const remainingAccount = makeAccount({ id: 1 })
      mockedGetActiveAccount.mockResolvedValue(remainingAccount)
      mockedInvoke.mockRejectedValue(new Error('no mnemonic'))
      const fallbackKeys = makeWalletKeys()
      const opts = makeOptions({
        accountsDeleteAccount: vi.fn().mockResolvedValue(true),
        wallet: null,
        getKeysForAccount: vi.fn().mockResolvedValue(fallbackKeys),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.deleteAccount(2)
      })

      expect(opts.getKeysForAccount).toHaveBeenCalledWith(remainingAccount, 'testpassword')
      expect(opts.setWallet).toHaveBeenCalledWith(fallbackKeys)
    })
  })

  describe('fetchDataFromDB error handling during switch', () => {
    it('succeeds even when fetchDataFromDB throws (best-effort preload)', async () => {
      const opts = makeOptions({
        fetchDataFromDB: vi.fn().mockRejectedValue(new Error('DB error')),
      })
      const { result } = renderHook(() => useAccountSwitching(opts))

      let success = false
      await act(async () => {
        success = await result.current.switchAccount(2)
      })

      // Should still succeed — fetchDataFromDB failure is non-blocking
      expect(success).toBe(true)
      expect(opts.setActiveAccountState).toHaveBeenCalled()
    })
  })

  describe('diagnostic string', () => {
    it('records diagnostic info during switch', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useAccountSwitching(opts))

      await act(async () => {
        await result.current.switchAccount(2)
      })

      const diag = getLastSwitchDiag()
      expect(diag).toContain('switch complete')
    })
  })
})
