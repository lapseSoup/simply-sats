// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// --- Mocks (must be before imports) ---

vi.mock('../services/sync', () => ({
  needsInitialSync: vi.fn(),
  syncWallet: vi.fn(),
  getLastSyncTimeForAccount: vi.fn(),
}))

vi.mock('../services/accountDiscovery', () => ({
  discoverAccounts: vi.fn(),
}))

vi.mock('../services/accounts', () => ({
  getAccountKeys: vi.fn(),
  getAllAccounts: vi.fn(),
}))

vi.mock('../services/sessionPasswordStore', () => ({
  getSessionPassword: vi.fn(),
}))

vi.mock('./useAccountSwitching', () => ({
  switchJustCompleted: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// --- Imports ---

import { useCheckSync } from './useCheckSync'
import { needsInitialSync, getLastSyncTimeForAccount } from '../services/sync'
import { discoverAccounts } from '../services/accountDiscovery'
import { getAccountKeys, getAllAccounts } from '../services/accounts'
import { getSessionPassword } from '../services/sessionPasswordStore'
import { switchJustCompleted } from './useAccountSwitching'
import type { WalletKeys } from '../services/wallet'
import type { Account } from '../services/accounts'

const mockedNeedsInitialSync = vi.mocked(needsInitialSync)
const mockedGetLastSyncTimeForAccount = vi.mocked(getLastSyncTimeForAccount)
const mockedDiscoverAccounts = vi.mocked(discoverAccounts)
const mockedGetAccountKeys = vi.mocked(getAccountKeys)
const mockedGetAllAccounts = vi.mocked(getAllAccounts)
const mockedGetSessionPassword = vi.mocked(getSessionPassword)
const mockedSwitchJustCompleted = vi.mocked(switchJustCompleted)

// --- Helpers ---

function makeWalletKeys(overrides: Partial<WalletKeys> = {}): WalletKeys {
  return {
    mnemonic: '',
    walletType: 'yours',
    walletWif: '',
    walletAddress: '1WalletAddr',
    walletPubKey: 'pubkey',
    ordWif: '',
    ordAddress: '1OrdAddr',
    ordPubKey: 'ordpub',
    identityWif: '',
    identityAddress: '1IdAddr',
    identityPubKey: 'idpub',
    ...overrides,
  }
}

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

function makeOptions(overrides: Partial<Parameters<typeof useCheckSync>[0]> = {}) {
  return {
    wallet: makeWalletKeys() as WalletKeys | null,
    activeAccountId: 1 as number | null,
    accounts: [makeAccount({ id: 1 })],
    fetchDataFromDB: vi.fn().mockResolvedValue(undefined),
    fetchData: vi.fn().mockResolvedValue(undefined),
    performSync: vi.fn().mockResolvedValue(undefined),
    refreshTokens: vi.fn().mockResolvedValue(undefined),
    consumePendingDiscovery: vi.fn().mockReturnValue(null),
    peekPendingDiscovery: vi.fn().mockReturnValue(null),
    clearPendingDiscovery: vi.fn(),
    refreshAccounts: vi.fn().mockResolvedValue(undefined),
    setSyncPhase: vi.fn(),
    showToast: vi.fn(),
    ...overrides,
  }
}

/**
 * Helper: flush all pending microtasks and short timers.
 * useCheckSync fires checkSync().catch(...) in a useEffect, so we need to
 * wait for the async pipeline to settle.
 */
async function flushAsync(ms = 50): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

// --- Tests ---

describe('useCheckSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockedSwitchJustCompleted.mockReturnValue(false)
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now()) // fresh by default
    mockedGetSessionPassword.mockReturnValue('testpwd')
    mockedGetAccountKeys.mockResolvedValue(null)
    mockedGetAllAccounts.mockResolvedValue([])
    mockedDiscoverAccounts.mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ── Guard clauses ──────────────────────────────────────────────────

  it('skips when wallet is null', async () => {
    const opts = makeOptions({ wallet: null })
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    expect(opts.fetchDataFromDB).not.toHaveBeenCalled()
    expect(opts.fetchData).not.toHaveBeenCalled()
    expect(opts.performSync).not.toHaveBeenCalled()
  })

  it('skips when activeAccountId is null', async () => {
    const opts = makeOptions({ activeAccountId: null })
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    expect(opts.fetchDataFromDB).not.toHaveBeenCalled()
    expect(opts.fetchData).not.toHaveBeenCalled()
    expect(opts.performSync).not.toHaveBeenCalled()
  })

  // ── Initial sync (blocking) ────────────────────────────────────────

  it('performs blocking initial sync when needsInitialSync returns true', async () => {
    mockedNeedsInitialSync.mockResolvedValue(true)
    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    // Should call fetchDataFromDB first, then performSync (blocking), then fetchData
    expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(1)
    expect(opts.performSync).toHaveBeenCalledWith(true)
    expect(opts.fetchData).toHaveBeenCalledTimes(1)
    expect(opts.setSyncPhase).toHaveBeenCalledWith('syncing')
    expect(opts.showToast).toHaveBeenCalledWith('Wallet ready \u2713', 'success')
  })

  // ── Post-switch path ───────────────────────────────────────────────

  it('skips fetchDataFromDB when switchJustCompleted is true', async () => {
    mockedSwitchJustCompleted.mockReturnValue(true)
    mockedNeedsInitialSync.mockResolvedValue(false)
    // Return a very old sync time so the stale path would trigger
    mockedGetLastSyncTimeForAccount.mockResolvedValue(0)

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    // Should NOT call fetchDataFromDB (useAccountSwitching already loaded data)
    expect(opts.fetchDataFromDB).not.toHaveBeenCalled()
  })

  it('performs background sync for post-switch account that has never been synced', async () => {
    mockedSwitchJustCompleted.mockReturnValue(true)
    mockedNeedsInitialSync.mockResolvedValue(true)

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    // Post-switch + needsSync should trigger background (non-blocking) sync
    expect(opts.performSync).toHaveBeenCalledWith(false, false, true)
    // Should NOT set 'syncing' phase (non-blocking path)
    expect(opts.setSyncPhase).not.toHaveBeenCalledWith('syncing')
  })

  // ── Stale data path ────────────────────────────────────────────────

  it('triggers background sync when data is stale', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    // Set last sync time to 10 minutes ago (beyond the 5-minute cooldown)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now() - 10 * 60 * 1000)

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    // Should call fetchDataFromDB (always for non-post-switch), then background sync
    expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(1)
    expect(opts.performSync).toHaveBeenCalledWith(false, false, true)
  })

  // ── Fresh data path ────────────────────────────────────────────────

  it('only calls fetchData (no sync) when data is fresh', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    // Very recent sync — within cooldown
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now() - 1000)

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(1)
    expect(opts.performSync).not.toHaveBeenCalled()
    expect(opts.fetchData).toHaveBeenCalledTimes(1)
  })

  // ── Token refresh ──────────────────────────────────────────────────

  it('calls refreshTokens after sync pipeline completes', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    expect(opts.refreshTokens).toHaveBeenCalledTimes(1)
  })

  it('handles refreshTokens failure gracefully (does not crash)', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())

    const opts = makeOptions({
      refreshTokens: vi.fn().mockRejectedValue(new Error('Token API down')),
    })
    renderHook(() => useCheckSync(opts))

    // Should not throw
    await flushAsync()

    expect(opts.refreshTokens).toHaveBeenCalledTimes(1)
  })

  // ── Discovery ──────────────────────────────────────────────────────

  it('runs account discovery when discoveryParams are available', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())
    mockedDiscoverAccounts.mockResolvedValue(2)
    mockedGetAllAccounts.mockResolvedValue([makeAccount({ id: 1 }), makeAccount({ id: 2 })])

    const discoveryParams = {
      mnemonic: 'test mnemonic',
      password: 'testpwd',
      excludeAccountId: 1,
    }

    const opts = makeOptions({
      peekPendingDiscovery: vi.fn().mockReturnValue(discoveryParams),
    })
    renderHook(() => useCheckSync(opts))

    // Need to wait longer for the 1-second delay before discovery
    await vi.advanceTimersByTimeAsync(2000)
    await flushAsync()

    expect(opts.clearPendingDiscovery).toHaveBeenCalledTimes(1)
    expect(mockedDiscoverAccounts).toHaveBeenCalledWith('test mnemonic', 'testpwd', 1)
    expect(opts.refreshAccounts).toHaveBeenCalled()
    expect(opts.showToast).toHaveBeenCalledWith('Discovered 2 additional accounts', 'success')
  })

  it('shows toast when no additional accounts are found', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())
    mockedDiscoverAccounts.mockResolvedValue(0)

    const discoveryParams = {
      mnemonic: 'test mnemonic',
      password: null,
    }

    const opts = makeOptions({
      peekPendingDiscovery: vi.fn().mockReturnValue(discoveryParams),
    })
    renderHook(() => useCheckSync(opts))

    await vi.advanceTimersByTimeAsync(2000)
    await flushAsync()

    expect(opts.showToast).toHaveBeenCalledWith('No additional accounts found')
  })

  it('shows error toast when discovery fails', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())
    mockedDiscoverAccounts.mockRejectedValue(new Error('Discovery failed'))

    const discoveryParams = {
      mnemonic: 'test mnemonic',
      password: 'pwd',
    }

    const opts = makeOptions({
      peekPendingDiscovery: vi.fn().mockReturnValue(discoveryParams),
    })
    renderHook(() => useCheckSync(opts))

    await vi.advanceTimersByTimeAsync(2000)
    await flushAsync()

    expect(opts.showToast).toHaveBeenCalledWith('Account discovery failed', 'error')
  })

  // ── Cleanup / cancellation ─────────────────────────────────────────

  it('returns a cleanup function that sets cancelled flag', async () => {
    const opts = makeOptions()
    const { unmount } = renderHook(() => useCheckSync(opts))

    // Unmounting triggers the cleanup which sets cancelled = true
    unmount()

    // After unmount, no further side effects should occur.
    // The key thing is that the hook doesn't throw on unmount.
  })

  // ── Re-fires on activeAccountId change ─────────────────────────────

  it('re-fires checkSync when activeAccountId changes', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())

    const opts = makeOptions({ activeAccountId: 1 })
    const { rerender } = renderHook(
      (props) => useCheckSync(props),
      { initialProps: opts }
    )

    await flushAsync()

    // Initial call
    expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(1)

    // Change activeAccountId
    const updatedOpts = { ...opts, activeAccountId: 2 }
    rerender(updatedOpts)

    await flushAsync()

    // Should fire again with the new account
    expect(opts.fetchDataFromDB).toHaveBeenCalledTimes(2)
  })

  // ── Clears syncPhase on error ──────────────────────────────────────

  it('clears sync phase on pipeline error (B-40 fix)', async () => {
    mockedNeedsInitialSync.mockRejectedValue(new Error('DB locked'))

    const opts = makeOptions()
    renderHook(() => useCheckSync(opts))

    await flushAsync()

    // syncPhase should be cleared via the catch/finally block
    expect(opts.setSyncPhase).toHaveBeenCalledWith(null)
  })

  // ── Background sync of inactive accounts ───────────────────────────

  it('background-syncs inactive accounts after delay', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())
    mockedGetSessionPassword.mockReturnValue('testpwd')

    const otherAccount = makeAccount({ id: 2, name: 'Other Account', derivationIndex: 1 })
    const otherKeys = makeWalletKeys({ walletAddress: '1OtherAddr' })
    mockedGetAccountKeys.mockResolvedValue(otherKeys)

    const opts = makeOptions({
      accounts: [makeAccount({ id: 1 }), otherAccount],
    })
    renderHook(() => useCheckSync(opts))

    // Wait for the initial pipeline to settle
    await flushAsync()

    // Advance past the 10-second delay for inactive account sync
    await vi.advanceTimersByTimeAsync(11_000)
    await flushAsync()

    expect(mockedGetAccountKeys).toHaveBeenCalledWith(otherAccount, 'testpwd')
  })

  it('skips background sync of inactive accounts when discovery is pending', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())

    const discoveryParams = {
      mnemonic: 'test',
      password: 'pwd',
    }
    mockedDiscoverAccounts.mockResolvedValue(0)

    const otherAccount = makeAccount({ id: 2, name: 'Other Account', derivationIndex: 1 })
    const opts = makeOptions({
      accounts: [makeAccount({ id: 1 }), otherAccount],
      peekPendingDiscovery: vi.fn().mockReturnValue(discoveryParams),
    })
    renderHook(() => useCheckSync(opts))

    await vi.advanceTimersByTimeAsync(15_000)
    await flushAsync()

    // Should NOT sync inactive accounts when discovery is pending
    expect(mockedGetAccountKeys).not.toHaveBeenCalledWith(otherAccount, expect.anything())
  })

  it('skips background sync when wallet is locked during delay (B-96)', async () => {
    mockedNeedsInitialSync.mockResolvedValue(false)
    mockedGetLastSyncTimeForAccount.mockResolvedValue(Date.now())

    const otherAccount = makeAccount({ id: 2, name: 'Other', derivationIndex: 1 })
    const opts = makeOptions({
      accounts: [makeAccount({ id: 1 }), otherAccount],
    })
    renderHook(() => useCheckSync(opts))

    // Let the initial pipeline finish
    await flushAsync()

    // Simulate wallet lock AFTER pipeline starts but BEFORE background sync reads password
    mockedGetSessionPassword.mockReturnValue(null)

    await vi.advanceTimersByTimeAsync(11_000)
    await flushAsync()

    // Should NOT call getAccountKeys because session password was null after the delay
    expect(mockedGetAccountKeys).not.toHaveBeenCalled()
  })
})
