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
  createAccount: vi.fn().mockResolvedValue(1)
}))

// Mock domain wallet key derivation
vi.mock('../domain/wallet', () => ({
  deriveWalletKeysForAccount: vi.fn()
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
import { deriveWalletKeysForAccount } from '../domain/wallet'

const mockWocClient = createWocClient() as {
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

describe('discoverAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deriveWalletKeysForAccount).mockImplementation((_mnemonic, index) => makeMockKeys(index))
  })

  it('discovers 0 accounts when account 1 has no activity', async () => {
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: true, data: [] }) // wallet addr
      .mockResolvedValueOnce({ success: true, data: [] }) // ord addr

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
    expect(deriveWalletKeysForAccount).toHaveBeenCalledWith('test mnemonic', 1)
  })

  it('discovers accounts with wallet address activity', async () => {
    // Account 1: wallet has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: true, data: [{ tx_hash: 'abc', height: 850000 }] })
      .mockResolvedValueOnce({ success: true, data: [] })
      // Account 2: no activity
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true)
  })

  it('discovers accounts with ordinals address activity', async () => {
    // Account 1: only ordinals has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [{ tx_hash: 'def', height: 850001 }] })
      // Account 2: no activity
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(1)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true)
  })

  it('discovers multiple consecutive accounts', async () => {
    // Account 1: has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: true, data: [{ tx_hash: 'a', height: 1 }] })
      .mockResolvedValueOnce({ success: true, data: [] })
      // Account 2: has activity
      .mockResolvedValueOnce({ success: true, data: [{ tx_hash: 'b', height: 2 }] })
      .mockResolvedValueOnce({ success: true, data: [] })
      // Account 3: no activity (gap)
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValueOnce({ success: true, data: [] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(2)
    expect(createAccount).toHaveBeenCalledTimes(2)
    expect(createAccount).toHaveBeenCalledWith('Account 2', makeMockKeys(1), 'password', true)
    expect(createAccount).toHaveBeenCalledWith('Account 3', makeMockKeys(2), 'password', true)
  })

  it('treats API errors as no activity (stops discovery)', async () => {
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'Timeout' } })
      .mockResolvedValueOnce({ success: true, data: [] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('stops on createAccount failure', async () => {
    // Account 1: has activity
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValueOnce({ success: true, data: [{ tx_hash: 'a', height: 1 }] })
      .mockResolvedValueOnce({ success: true, data: [] })

    vi.mocked(createAccount).mockRejectedValueOnce(new Error('DB write failed'))

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(0) // Failed account isn't counted
    expect(createAccount).toHaveBeenCalledTimes(1)
  })

  it('respects max discovery cap of 20', async () => {
    // All accounts have activity — should stop at 20
    mockWocClient.getTransactionHistorySafe
      .mockResolvedValue({ success: true, data: [{ tx_hash: 'x', height: 1 }] })

    const found = await discoverAccounts('test mnemonic', 'password')

    expect(found).toBe(20)
    expect(createAccount).toHaveBeenCalledTimes(20)
    // Verify it checked accounts 1 through 20
    expect(deriveWalletKeysForAccount).toHaveBeenCalledTimes(20)
    expect(deriveWalletKeysForAccount).toHaveBeenLastCalledWith('test mnemonic', 20)
  })
})
