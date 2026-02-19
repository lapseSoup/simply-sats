import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock WocClient BEFORE imports
vi.mock('../infrastructure/api/wocClient', () => {
  const mockClient = {
    getBalanceSafe: vi.fn()
  }
  return {
    createWocClient: () => mockClient
  }
})

// Mock accounts service
vi.mock('./accounts', () => ({
  createAccount: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
  switchAccount: vi.fn().mockResolvedValue(true),
  getAccountByIdentity: vi.fn().mockResolvedValue(null)
}))

// Mock domain wallet key derivation
vi.mock('../domain/wallet', () => ({
  deriveWalletKeysForAccount: vi.fn()
}))

// Mock sync service (syncWallet no longer called during discovery — sync deferred to background)
vi.mock('./sync', () => ({
  syncWallet: vi.fn().mockResolvedValue(undefined)
}))

// Mock logger
vi.mock('./logger', () => ({
  accountLogger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn()
  }
}))

import { discoverAccounts } from './accountDiscovery'
import { createWocClient } from '../infrastructure/api/wocClient'
import { createAccount } from './accounts'
import { syncWallet } from './sync'
import { deriveWalletKeysForAccount } from '../domain/wallet'

const mockWocClient = createWocClient() as unknown as {
  getBalanceSafe: ReturnType<typeof vi.fn>
}

const makeMockKeys = (index: number) => ({
  mnemonic: 'test mnemonic',
  walletType: 'yours' as const,
  walletWif: `wif-${index}`,
  walletAddress: `wallet-addr-${index}`,
  walletPubKey: `wallet-pub-${index}`,
  ordWif: `ord-wif-${index}`,
  ordAddress: `ord-addr-${index}`,
  ordPubKey: `ord-pub-${index}`,
  identityWif: `id-wif-${index}`,
  identityAddress: `id-addr-${index}`,
  identityPubKey: `id-pub-${index}`
})

/**
 * Helper: mock address balance checks for one account with no activity.
 * All 3 addresses (wallet, ord, identity) return 0.
 * With parallel checks, all 3 values are consumed at once.
 */
const mockEmptyAccount = () => {
  mockWocClient.getBalanceSafe
    .mockResolvedValueOnce({ ok: true, value: 0 }) // wallet
    .mockResolvedValueOnce({ ok: true, value: 0 }) // ord
    .mockResolvedValueOnce({ ok: true, value: 0 }) // identity
}

/**
 * Helper: mock address balance checks for one account with wallet activity.
 * All 3 addresses are checked in parallel, so we queue 3 values.
 */
const mockActiveAccount = () => {
  mockWocClient.getBalanceSafe
    .mockResolvedValueOnce({ ok: true, value: 100 }) // wallet — active
    .mockResolvedValueOnce({ ok: true, value: 0 })   // ord
    .mockResolvedValueOnce({ ok: true, value: 0 })   // identity
}

/**
 * Helper: mock address balance checks for one account with ordinals activity.
 * All 3 addresses are checked in parallel, so we queue 3 values.
 */
const mockOrdActiveAccount = () => {
  mockWocClient.getBalanceSafe
    .mockResolvedValueOnce({ ok: true, value: 0 })   // wallet — empty
    .mockResolvedValueOnce({ ok: true, value: 100 }) // ord — active
    .mockResolvedValueOnce({ ok: true, value: 0 })   // identity
}

describe('discoverAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(deriveWalletKeysForAccount).mockImplementation((_mnemonic, index) => Promise.resolve(makeMockKeys(index)))
    // Default all unstubbed address checks to "successful but zero balance" so tests can
    // override only the account indices relevant to each scenario.
    mockWocClient.getBalanceSafe.mockResolvedValue({ ok: true, value: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Run discoverAccounts while automatically advancing fake timers so
   * setTimeout-based delays don't block the test.
   */
  const runDiscovery = async (mnemonic: string, password: string | null, excludeId?: number) => {
    const promise = discoverAccounts(mnemonic, password, excludeId)
    // Repeatedly flush all pending timers + microtasks until the promise settles
    for (let i = 0; i < 500; i++) {
      await vi.runAllTimersAsync()
    }
    return promise
  }

  it('discovers 0 accounts when the full discovery window has no activity', async () => {
    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(200)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 200)
  })

  it('discovers accounts with wallet address activity (sync deferred)', async () => {
    // Account 1 (index 1): wallet has balance
    mockActiveAccount()

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    // Sync is deferred to background — not called during discovery
    expect(syncWallet).not.toHaveBeenCalled()
  })

  it('discovers accounts with ordinals address activity', async () => {
    // Account 1 (index 1): wallet empty, ord has balance
    mockOrdActiveAccount()

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers accounts with identity address activity', async () => {
    // Account 1 (index 1): wallet empty, ord empty, identity active
    mockWocClient.getBalanceSafe
      .mockResolvedValueOnce({ ok: true, value: 0 })   // wallet
      .mockResolvedValueOnce({ ok: true, value: 0 })   // ord
      .mockResolvedValueOnce({ ok: true, value: 100 }) // identity active

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers multiple consecutive accounts', async () => {
    // Account 1 (index 1): wallet active — short-circuits
    mockActiveAccount()
    // Account 2 (index 2): wallet active — short-circuits
    mockActiveAccount()
    // Accounts 3+ return the default empty

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(2)
    expect(createAccount).toHaveBeenCalledTimes(2)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    expect(createAccount).toHaveBeenCalledWith('Account 3', makeMockKeys(2), 'password', true, 2)
  })

  it('discovers account after multiple empty indices (before any found)', async () => {
    // Accounts 1-2 (indices 1,2): empty
    mockEmptyAccount() // index 1
    mockEmptyAccount() // index 2
    // Account 3 (index 3): wallet active — should still be discovered (no gap limit before first hit)
    mockActiveAccount()

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 4', makeMockKeys(3), 'password', true, 3)
  })

  it('discovers account at high derivation index beyond legacy cap', async () => {
    // Use a dynamic mock so index 50 is the first with activity.
    mockWocClient.getBalanceSafe.mockImplementation(async (address: string) => {
      const match = address.match(/-(\d+)$/)
      const index = match ? Number(match[1]) : -1
      const isWalletAddress = address.startsWith('wallet-addr-')

      if (isWalletAddress && index === 50) {
        return { ok: true, value: 100 }
      }

      return { ok: true, value: 0 }
    })

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 51', makeMockKeys(50), 'password', true, 50)
    expect(deriveWalletKeysForAccount).toHaveBeenCalledWith('test mnemonic', 50)
  })

  it('retries on API failure and discovers account on successful retry', async () => {
    // Index 1: wallet fails on first attempt (3 parallel checks)
    mockWocClient.getBalanceSafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: 0 })  // ord ok
      .mockResolvedValueOnce({ ok: true, value: 0 })  // identity ok — result: null (wallet failed)
    // Retry attempt 1: wallet has balance (3 parallel checks)
    mockWocClient.getBalanceSafe
      .mockResolvedValueOnce({ ok: true, value: 100 }) // wallet active — found!
      .mockResolvedValueOnce({ ok: true, value: 0 })   // ord
      .mockResolvedValueOnce({ ok: true, value: 0 })   // identity

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('skips account when all retries fail (API error persists)', async () => {
    // Index 1: wallet fails — makes result null
    mockWocClient.getBalanceSafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: 0 })  // ord ok
      .mockResolvedValueOnce({ ok: true, value: 0 })  // identity ok — null (wallet failed)
    // All 3 retries also fail (wallet always fails)
    for (let i = 0; i < 3; i++) {
      mockWocClient.getBalanceSafe
        .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
        .mockResolvedValueOnce({ ok: true, value: 0 })  // ord ok
        .mockResolvedValueOnce({ ok: true, value: 0 })  // identity ok — still null
    }

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('stops on createAccount failure', async () => {
    // Account 1 (index 1): has activity
    mockActiveAccount()

    vi.mocked(createAccount).mockRejectedValueOnce(new Error('DB write failed'))

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(0) // Failed account isn't counted
    expect(createAccount).toHaveBeenCalledTimes(1)
  })

  it('creates discovered account without immediate sync', async () => {
    // Account 1 (index 1): has activity
    mockActiveAccount()

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    // Sync is deferred to background
    expect(syncWallet).not.toHaveBeenCalled()
  })

  it('respects max discovery cap of 200', async () => {
    // All accounts have balance — wallet short-circuits after 1 call per account
    mockWocClient.getBalanceSafe
      .mockResolvedValue({ ok: true, value: 100 })

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(200)
    expect(createAccount).toHaveBeenCalledTimes(200)
    // Verify it checked accounts 1 through 200
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(200)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 200)
  })

  it('stops after gap limit of 5 consecutive confirmed-empty accounts post-first-hit', async () => {
    // Index 1: active
    mockActiveAccount()
    // Indices 2-6: all empty (5 consecutive empties after first hit)
    for (let i = 0; i < 5; i++) {
      mockEmptyAccount()
    }

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    // Should have stopped at index 6 (1 active + 5 empty = gap limit reached)
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(6)
  })

  it('does not count API failures toward gap limit', async () => {
    // Index 1: active (3 parallel address checks)
    mockActiveAccount()
    // Index 2: API failure (wallet fails, ord+identity ok) — result: null
    // Each attempt checks 3 addresses in parallel
    mockWocClient.getBalanceSafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'fail' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: 0 })  // ord ok
      .mockResolvedValueOnce({ ok: true, value: 0 })  // identity ok
    // All 3 retries for index 2 also fail (3 addresses per retry)
    for (let i = 0; i < 3; i++) {
      mockWocClient.getBalanceSafe
        .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'fail' } })
        .mockResolvedValueOnce({ ok: true, value: 0 })
        .mockResolvedValueOnce({ ok: true, value: 0 })
    }
    // Index 3: active — still discoverable because index 2 didn't count as empty
    mockActiveAccount()

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(2)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    // Index 3 is active; after it we need 5 empties before stopping
    // Index 4-8: empties → gap limit → stop
    expect(createAccount).toHaveBeenCalledWith('Account 4', makeMockKeys(3), 'password', true, 3)
  })
})
