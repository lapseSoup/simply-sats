import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock WocClient BEFORE imports
vi.mock('../infrastructure/api/wocClient', () => {
  const mockClient = {
    getTransactionHistorySafe: vi.fn()
  }
  return {
    createWocClient: () => mockClient
  }
})

// Mock accounts service
vi.mock('./accounts', () => ({
  createAccount: vi.fn().mockResolvedValue({ ok: true, value: 1 }),
  switchAccount: vi.fn().mockResolvedValue(true)
}))

// Mock domain wallet key derivation
vi.mock('../domain/wallet', () => ({
  deriveWalletKeysForAccount: vi.fn()
}))

// Mock sync service
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
  getTransactionHistorySafe: ReturnType<typeof vi.fn>
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
 * Helper: mock serial address checks for one account with no activity.
 * New implementation checks addresses one at a time (wallet → ord → identity).
 */
const mockEmptyAccount = () => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [] }) // wallet
    .mockResolvedValueOnce({ ok: true, value: [] }) // ord
    .mockResolvedValueOnce({ ok: true, value: [] }) // identity
}

/**
 * Helper: mock serial address checks for one account with wallet activity.
 * Short-circuits after wallet returns activity (ord+identity not called for this account).
 */
const mockActiveAccount = (txHash = 'abc', height = 850000) => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: txHash, height }] }) // wallet — active, short-circuits
}

/**
 * Helper: mock serial address checks for one account with ordinals activity.
 * wallet is checked first (empty), then ord (active) — identity not called.
 */
const mockOrdActiveAccount = (txHash = 'def', height = 850001) => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [] })                             // wallet — empty
    .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: txHash, height }] }) // ord — active, short-circuits
}

describe('discoverAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(deriveWalletKeysForAccount).mockImplementation((_mnemonic, index) => Promise.resolve(makeMockKeys(index)))
    // Default all unstubbed address checks to "successful but empty" so tests can
    // override only the account indices relevant to each scenario.
    mockWocClient.getTransactionHistorySafe.mockResolvedValue({ ok: true, value: [] })
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

  it('discovers accounts with wallet address activity and syncs them', async () => {
    // Account 1 (index 1): wallet has activity — short-circuits after 1 call
    mockActiveAccount('abc', 850000)

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    // Verify sync was called for the discovered account
    expect(syncWallet).toHaveBeenCalledTimes(1)
    const keys = makeMockKeys(1)
    expect(syncWallet).toHaveBeenCalledWith(keys.walletAddress, keys.ordAddress, keys.identityAddress, 1, keys.walletPubKey)
  })

  it('discovers accounts with ordinals address activity', async () => {
    // Account 1 (index 1): wallet empty, ord has activity
    mockOrdActiveAccount('def', 850001)

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers accounts with identity address activity', async () => {
    // Account 1 (index 1): wallet empty, ord empty, identity active
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: true, value: [] }) // wallet
      .mockResolvedValueOnce({ ok: true, value: [] }) // ord
      .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: 'id-tx', height: 850002 }] }) // identity active

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers multiple consecutive accounts', async () => {
    // Account 1 (index 1): wallet active — short-circuits
    mockActiveAccount('a', 1)
    // Account 2 (index 2): wallet active — short-circuits
    mockActiveAccount('b', 2)
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
    mockActiveAccount('found-it', 850000)

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 4', makeMockKeys(3), 'password', true, 3)
  })

  it('discovers account at high derivation index beyond legacy cap', async () => {
    // Use a dynamic mock so index 50 is the first with activity.
    mockWocClient.getTransactionHistorySafe.mockImplementation(async (address: string) => {
      const match = address.match(/-(\d+)$/)
      const index = match ? Number(match[1]) : -1
      const isWalletAddress = address.startsWith('wallet-addr-')

      if (isWalletAddress && index === 50) {
        return { ok: true, value: [{ tx_hash: 'high-index-tx', height: 850123 }] }
      }

      return { ok: true, value: [] }
    })

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 51', makeMockKeys(50), 'password', true, 50)
    expect(deriveWalletKeysForAccount).toHaveBeenCalledWith('test mnemonic', 50)
  })

  it('retries on API failure and discovers account on successful retry', async () => {
    // Index 1: all 3 addresses fail on first attempt
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: [] })  // ord ok (continues despite wallet fail)
      .mockResolvedValueOnce({ ok: true, value: [] })  // identity ok — result: null (wallet failed)
    // Retry attempt 1: wallet has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: 'abc', height: 850000 }] }) // wallet active — found!

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('skips account when all retries fail (API error persists)', async () => {
    // Index 1: wallet fails — makes result null
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: [] })  // ord ok
      .mockResolvedValueOnce({ ok: true, value: [] })  // identity ok — null (wallet failed)
    // All 3 retries also fail (wallet always fails)
    for (let i = 0; i < 3; i++) {
      mockWocClient.getTransactionHistorySafe
        .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } }) // wallet fail
        .mockResolvedValueOnce({ ok: true, value: [] })  // ord ok
        .mockResolvedValueOnce({ ok: true, value: [] })  // identity ok — still null
    }

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('stops on createAccount failure', async () => {
    // Account 1 (index 1): has activity
    mockActiveAccount('a', 1)

    vi.mocked(createAccount).mockRejectedValueOnce(new Error('DB write failed'))

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(0) // Failed account isn't counted
    expect(createAccount).toHaveBeenCalledTimes(1)
  })

  it('keeps discovered account when initial sync fails', async () => {
    // Account 1 (index 1): has activity
    mockActiveAccount('a', 1)

    vi.mocked(syncWallet).mockRejectedValueOnce(new Error('sync failed'))

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(syncWallet).toHaveBeenCalledTimes(1)
  })

  it('respects max discovery cap of 200', async () => {
    // All accounts have activity — wallet short-circuits after 1 call per account
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValue({ ok: true, value: [{ tx_hash: 'x', height: 1 }] })

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(200)
    expect(createAccount).toHaveBeenCalledTimes(200)
    // Verify it checked accounts 1 through 200
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(200)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 200)
  })

  it('stops after gap limit of 20 consecutive confirmed-empty accounts post-first-hit', async () => {
    // Index 1: active
    mockActiveAccount('a', 1)
    // Indices 2-21: all empty (20 consecutive empties after first hit)
    for (let i = 0; i < 20; i++) {
      mockEmptyAccount()
    }

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(1)
    // Should have stopped at index 21 (1 active + 20 empty = gap limit reached)
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(21)
  })

  it('does not count API failures toward gap limit', async () => {
    // Index 1: active
    mockActiveAccount('a', 1)
    // Index 2: API failure (wallet fails) — should NOT count toward gap limit
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'fail' } }) // wallet fail
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
    // All retries for index 2 also fail
    for (let i = 0; i < 3; i++) {
      mockWocClient.getTransactionHistorySafe
        .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'fail' } })
        .mockResolvedValueOnce({ ok: true, value: [] })
        .mockResolvedValueOnce({ ok: true, value: [] })
    }
    // Index 3: active — still discoverable because index 2 didn't count as empty
    mockActiveAccount('b', 3)

    const found = await runDiscovery('test mnemonic', 'password')

    expect(found).toBe(2)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    expect(createAccount).toHaveBeenCalledWith('Account 4', makeMockKeys(3), 'password', true, 3)
  })
})
