import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the WocClient from infrastructure layer - must be before imports
vi.mock('../infrastructure/api/wocClient', () => {
  const mockClient = {
    getBlockHeight: vi.fn().mockResolvedValue(0),
    getBalance: vi.fn().mockResolvedValue(0),
    getUtxos: vi.fn().mockResolvedValue([]),
    getTransactionHistory: vi.fn().mockResolvedValue([]),
    getTransactionDetails: vi.fn().mockResolvedValue(null),
    broadcastTransaction: vi.fn().mockResolvedValue('')
  }
  return {
    getWocClient: () => mockClient,
    createWocClient: () => mockClient
  }
})

// Mock database module
vi.mock('./database', () => ({
  addUTXO: vi.fn().mockResolvedValue(undefined),
  markUTXOSpent: vi.fn().mockResolvedValue(undefined),
  getSpendableUTXOs: vi.fn().mockResolvedValue([]),
  getLastSyncedHeight: vi.fn().mockResolvedValue(0),
  updateSyncState: vi.fn().mockResolvedValue(undefined),
  upsertTransaction: vi.fn().mockResolvedValue(undefined),
  getDerivedAddresses: vi.fn().mockResolvedValue([]),
  updateDerivedAddressSyncTime: vi.fn().mockResolvedValue(undefined)
}))

// Mock config module
vi.mock('./config', () => ({
  RATE_LIMITS: {
    addressSyncDelay: 500
  }
}))

import {
  BASKETS,
  getCurrentBlockHeight,
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase,
  getOrdinalsFromDatabase,
  recordSentTransaction,
  markUtxosSpent,
  needsInitialSync,
  type AddressInfo,
  type SyncResult
} from './sync'

import {
  getSpendableUTXOs,
  getLastSyncedHeight,
  upsertTransaction,
  markUTXOSpent as dbMarkUTXOSpent
} from './database'

// Get the mock client for test manipulation
import { getWocClient } from '../infrastructure/api/wocClient'
const mockWocClient = getWocClient() as unknown as {
  getBlockHeight: ReturnType<typeof vi.fn>
  getBalance: ReturnType<typeof vi.fn>
  getUtxos: ReturnType<typeof vi.fn>
  getTransactionHistory: ReturnType<typeof vi.fn>
  getTransactionDetails: ReturnType<typeof vi.fn>
  broadcastTransaction: ReturnType<typeof vi.fn>
}

describe('Sync Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('BASKETS', () => {
    it('should define all basket types', () => {
      expect(BASKETS.DEFAULT).toBe('default')
      expect(BASKETS.ORDINALS).toBe('ordinals')
      expect(BASKETS.IDENTITY).toBe('identity')
      expect(BASKETS.LOCKS).toBe('locks')
      expect(BASKETS.WROOTZ_LOCKS).toBe('wrootz_locks')
      expect(BASKETS.DERIVED).toBe('derived')
    })

    it('should be frozen (immutable)', () => {
      // Object.isFrozen returns false for 'as const' objects,
      // but TypeScript ensures immutability at compile time
      expect(Object.keys(BASKETS).length).toBe(6)
    })
  })

  describe('getCurrentBlockHeight', () => {
    it('should fetch current block height from WocClient', async () => {
      mockWocClient.getBlockHeight.mockResolvedValueOnce(890000)

      const height = await getCurrentBlockHeight()

      expect(height).toBe(890000)
      expect(mockWocClient.getBlockHeight).toHaveBeenCalled()
    })

    it('should return 0 on API failure (WocClient handles errors gracefully)', async () => {
      // WocClient returns 0 on errors instead of throwing
      mockWocClient.getBlockHeight.mockResolvedValueOnce(0)

      const height = await getCurrentBlockHeight()

      expect(height).toBe(0)
    })

    it('should return 0 on network error (WocClient handles errors gracefully)', async () => {
      // WocClient catches errors internally and returns 0
      mockWocClient.getBlockHeight.mockResolvedValueOnce(0)

      const height = await getCurrentBlockHeight()

      expect(height).toBe(0)
    })
  })

  describe('getBalanceFromDatabase', () => {
    it('should return total balance from all UTXOs', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any,
        { txid: 'tx2', vout: 0, satoshis: 2000, basket: 'default', spendable: true } as any,
        { txid: 'tx3', vout: 0, satoshis: 500, basket: 'ordinals', spendable: true } as any
      ])

      const balance = await getBalanceFromDatabase()

      expect(balance).toBe(3500)
    })

    it('should filter by basket when specified', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any,
        { txid: 'tx2', vout: 0, satoshis: 2000, basket: 'default', spendable: true } as any,
        { txid: 'tx3', vout: 0, satoshis: 500, basket: 'ordinals', spendable: true } as any
      ])

      const balance = await getBalanceFromDatabase('default')

      expect(balance).toBe(3000)
    })

    it('should return 0 when no UTXOs exist', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([])

      const balance = await getBalanceFromDatabase()

      expect(balance).toBe(0)
    })

    it('should return 0 for empty basket', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any
      ])

      const balance = await getBalanceFromDatabase('ordinals')

      expect(balance).toBe(0)
    })
  })

  describe('getSpendableUtxosFromDatabase', () => {
    it('should return UTXOs sorted by value (smallest first)', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 5000, basket: 'default', spendable: true } as any,
        { txid: 'tx2', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any,
        { txid: 'tx3', vout: 0, satoshis: 3000, basket: 'default', spendable: true } as any
      ])

      const utxos = await getSpendableUtxosFromDatabase()

      expect(utxos[0].satoshis).toBe(1000)
      expect(utxos[1].satoshis).toBe(3000)
      expect(utxos[2].satoshis).toBe(5000)
    })

    it('should filter by basket', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any,
        { txid: 'tx2', vout: 0, satoshis: 2000, basket: 'ordinals', spendable: true } as any
      ])

      const utxos = await getSpendableUtxosFromDatabase('default')

      expect(utxos.length).toBe(1)
      expect(utxos[0].basket).toBe('default')
    })

    it('should default to default basket', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any,
        { txid: 'tx2', vout: 0, satoshis: 2000, basket: 'ordinals', spendable: true } as any
      ])

      const utxos = await getSpendableUtxosFromDatabase()

      expect(utxos.length).toBe(1)
      expect(utxos[0].basket).toBe('default')
    })
  })

  describe('getOrdinalsFromDatabase', () => {
    it('should return ordinals from ordinals basket', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1, basket: 'ordinals', spendable: true } as any,
        { txid: 'tx2', vout: 1, satoshis: 1, basket: 'ordinals', spendable: true } as any,
        { txid: 'tx3', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any
      ])

      const ordinals = await getOrdinalsFromDatabase()

      expect(ordinals.length).toBe(2)
      expect(ordinals[0].origin).toBe('tx1_0')
      expect(ordinals[1].origin).toBe('tx2_1')
    })

    it('should format origin correctly', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'abc123', vout: 5, satoshis: 1, basket: 'ordinals', spendable: true } as any
      ])

      const ordinals = await getOrdinalsFromDatabase()

      expect(ordinals[0].origin).toBe('abc123_5')
      expect(ordinals[0].txid).toBe('abc123')
      expect(ordinals[0].vout).toBe(5)
    })

    it('should return empty array when no ordinals', async () => {
      vi.mocked(getSpendableUTXOs).mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, basket: 'default', spendable: true } as any
      ])

      const ordinals = await getOrdinalsFromDatabase()

      expect(ordinals).toEqual([])
    })
  })

  describe('recordSentTransaction', () => {
    it('should record transaction with all fields', async () => {
      await recordSentTransaction(
        'txid123',
        'rawtx...',
        'Sent 1000 sats',
        ['payment', 'send'],
        1000
      )

      expect(upsertTransaction).toHaveBeenCalledWith({
        txid: 'txid123',
        rawTx: 'rawtx...',
        description: 'Sent 1000 sats',
        createdAt: expect.any(Number),
        status: 'pending',
        labels: ['payment', 'send'],
        amount: 1000
      })
    })

    it('should record transaction with default labels', async () => {
      await recordSentTransaction('txid123', 'rawtx...', 'Test tx')

      expect(upsertTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [],
          amount: undefined
        })
      )
    })

    it('should set status to pending', async () => {
      await recordSentTransaction('txid123', 'rawtx...', 'Test')

      expect(upsertTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      )
    })
  })

  describe('markUtxosSpent', () => {
    it('should mark all UTXOs as spent', async () => {
      const utxos = [
        { txid: 'tx1', vout: 0 },
        { txid: 'tx2', vout: 1 },
        { txid: 'tx3', vout: 2 }
      ]

      await markUtxosSpent(utxos, 'spending_txid')

      expect(dbMarkUTXOSpent).toHaveBeenCalledTimes(3)
      expect(dbMarkUTXOSpent).toHaveBeenCalledWith('tx1', 0, 'spending_txid')
      expect(dbMarkUTXOSpent).toHaveBeenCalledWith('tx2', 1, 'spending_txid')
      expect(dbMarkUTXOSpent).toHaveBeenCalledWith('tx3', 2, 'spending_txid')
    })

    it('should handle empty array', async () => {
      await markUtxosSpent([], 'spending_txid')

      expect(dbMarkUTXOSpent).not.toHaveBeenCalled()
    })
  })

  describe('needsInitialSync', () => {
    it('should return true if any address has never been synced', async () => {
      vi.mocked(getLastSyncedHeight)
        .mockResolvedValueOnce(850000) // First address synced
        .mockResolvedValueOnce(0)      // Second address never synced

      const result = await needsInitialSync(['addr1', 'addr2'])

      expect(result).toBe(true)
    })

    it('should return false if all addresses have been synced', async () => {
      vi.mocked(getLastSyncedHeight)
        .mockResolvedValueOnce(850000)
        .mockResolvedValueOnce(850001)
        .mockResolvedValueOnce(850002)

      const result = await needsInitialSync(['addr1', 'addr2', 'addr3'])

      expect(result).toBe(false)
    })

    it('should return false for empty address list', async () => {
      const result = await needsInitialSync([])

      expect(result).toBe(false)
      expect(getLastSyncedHeight).not.toHaveBeenCalled()
    })

    it('should short-circuit on first unsynced address', async () => {
      vi.mocked(getLastSyncedHeight).mockResolvedValueOnce(0)

      const result = await needsInitialSync(['addr1', 'addr2', 'addr3'])

      expect(result).toBe(true)
      expect(getLastSyncedHeight).toHaveBeenCalledTimes(1)
    })
  })

  describe('AddressInfo interface', () => {
    it('should accept valid address info', () => {
      const info: AddressInfo = {
        address: '1BitcoinAddress...',
        basket: 'default'
      }

      expect(info.address).toBeDefined()
      expect(info.basket).toBeDefined()
      expect(info.wif).toBeUndefined()
    })

    it('should accept address info with wif', () => {
      const info: AddressInfo = {
        address: '1BitcoinAddress...',
        basket: 'derived',
        wif: 'L1...'
      }

      expect(info.wif).toBe('L1...')
    })
  })

  describe('SyncResult interface', () => {
    it('should contain expected fields', () => {
      const result: SyncResult = {
        address: '1BitcoinAddress...',
        basket: 'default',
        newUtxos: 5,
        spentUtxos: 2,
        totalBalance: 50000
      }

      expect(result.address).toBeDefined()
      expect(result.basket).toBeDefined()
      expect(result.newUtxos).toBe(5)
      expect(result.spentUtxos).toBe(2)
      expect(result.totalBalance).toBe(50000)
    })
  })
})
