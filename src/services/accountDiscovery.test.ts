import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  createAccount: vi.fn().mockResolvedValue({ ok: true, value: 1 })
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

/** Helper: mock 3 address checks (wallet, ord, identity) for one account with no activity */
const mockEmptyAccount = () => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [] }) // wallet
    .mockResolvedValueOnce({ ok: true, value: [] }) // ord
    .mockResolvedValueOnce({ ok: true, value: [] }) // identity
}

/** Helper: mock 3 address checks for one account with wallet activity */
const mockActiveAccount = (txHash = 'abc', height = 850000) => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: txHash, height }] }) // wallet
    .mockResolvedValueOnce({ ok: true, value: [] }) // ord
    .mockResolvedValueOnce({ ok: true, value: [] }) // identity
}

/** Helper: mock 3 address checks for one account with ordinals activity */
const mockOrdActiveAccount = (txHash = 'def', height = 850001) => {
  mockWocClient.getTransactionHistorySafe
    .mockResolvedValueOnce({ ok: true, value: [] }) // wallet
    .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: txHash, height }] }) // ord
    .mockResolvedValueOnce({ ok: true, value: [] }) // identity
}

describe('discoverAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deriveWalletKeysForAccount).mockImplementation((_mnemonic, index) => Promise.resolve(makeMockKeys(index)))
    // Default all unstubbed address checks to "successful but empty" so tests can
    // override only the account indices relevant to each scenario.
    mockWocClient.getTransactionHistorySafe.mockResolvedValue({ ok: true, value: [] })
  })

  it('discovers 0 accounts when the full discovery window has no activity', async () => {
    // Account 1: no activity
    mockEmptyAccount()
    // Account 2: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(20)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 20)
  })

  it('discovers accounts with wallet address activity and syncs them', async () => {
    // Account 1: wallet has activity
    mockActiveAccount('abc', 850000)
    // Account 2: no activity
    mockEmptyAccount()
    // Account 3: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    // Verify sync was called for the discovered account
    expect(syncWallet).toHaveBeenCalledTimes(1)
    const keys = makeMockKeys(1)
    expect(syncWallet).toHaveBeenCalledWith(keys.walletAddress, keys.ordAddress, keys.identityAddress, 1, keys.walletPubKey)
  })

  it('discovers accounts with ordinals address activity', async () => {
    // Account 1: only ordinals has activity
    mockOrdActiveAccount('def', 850001)
    // Account 2: no activity
    mockEmptyAccount()
    // Account 3: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers accounts with identity address activity', async () => {
    // Account 1: only identity has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: true, value: [] }) // wallet
      .mockResolvedValueOnce({ ok: true, value: [] }) // ord
      .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: 'id-tx', height: 850002 }] }) // identity active!
    // Account 2: no activity
    mockEmptyAccount()
    // Account 3: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
  })

  it('discovers multiple consecutive accounts', async () => {
    // Account 1: has activity
    mockActiveAccount('a', 1)
    // Account 2: has activity
    mockActiveAccount('b', 2)
    // Account 3: no activity
    mockEmptyAccount()
    // Account 4: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(2)
    expect(createAccount).toHaveBeenCalledTimes(2)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true, 1)
    expect(createAccount).toHaveBeenCalledWith('Account 3', makeMockKeys(2), 'password', true, 2)
  })

  it('discovers account after multiple empty indices', async () => {
    // Account 1: no activity (empty)
    mockEmptyAccount()
    // Account 2: no activity (empty)
    mockEmptyAccount()
    // Account 3: has activity — should still be discovered
    mockActiveAccount('found-it', 850000)

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 4', makeMockKeys(3), 'password', true, 3)
  })

  it('retries on API failure and stops only if retry also fails', async () => {
    // First attempt: API failure on all 3 addresses
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
    // Retry after delay: all 3 succeed but empty
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
    // Account 2: empty
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('discovers account on retry after initial API failure', async () => {
    // First attempt: API failure on wallet + ordinals
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: '429' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: '429' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: '429' } })
    // Retry: has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ ok: true, value: [{ tx_hash: 'abc', height: 850000 }] })
      .mockResolvedValueOnce({ ok: true, value: [] })
      .mockResolvedValueOnce({ ok: true, value: [] })
    // Account 2: no activity
    mockEmptyAccount()
    // Account 3: no activity
    mockEmptyAccount()

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
  })

  it('stops on createAccount failure', async () => {
    // Account 1: has activity
    mockActiveAccount('a', 1)
    // Account 2: no activity
    mockEmptyAccount()
    // Account 3: no activity
    mockEmptyAccount()

    vi.mocked(createAccount).mockRejectedValueOnce(new Error('DB write failed'))

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0) // Failed account isn't counted
    expect(createAccount).toHaveBeenCalledTimes(1)
  })

  it('respects max discovery cap of 20', async () => {
    // All accounts have activity — should stop at 20
    // Each account check does 3 calls (wallet, ord, identity)
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValue({ ok: true, value: [{ tx_hash: 'x', height: 1 }] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(20)
    expect(createAccount).toHaveBeenCalledTimes(20)
    // Verify it checked accounts 1 through 20
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(20)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 20)
  })
})
