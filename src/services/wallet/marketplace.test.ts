// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock js-1sat-ord before importing marketplace
vi.mock('js-1sat-ord', () => ({
  createOrdListings: vi.fn(),
  cancelOrdListings: vi.fn(),
}))

// Mock internal dependencies
vi.mock('./transactions', () => ({
  broadcastTransaction: vi.fn(),
}))

vi.mock('../sync', () => ({
  recordSentTransaction: vi.fn(),
  markUtxosPendingSpend: vi.fn(),
  confirmUtxosSpent: vi.fn(),
  rollbackPendingSpend: vi.fn(),
}))

vi.mock('../logger', () => ({
  walletLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock @bsv/sdk
vi.mock('@bsv/sdk', () => {
  const mockAddress = 'mockAddress123'
  const mockPublicKey = {
    toAddress: () => mockAddress,
  }
  const mockPrivateKey = {
    toPublicKey: () => mockPublicKey,
  }

  return {
    PrivateKey: {
      fromWif: vi.fn(() => mockPrivateKey),
    },
    P2PKH: vi.fn(() => ({
      lock: vi.fn(() => ({
        toHex: () => '76a91489abcdefab89abcdefab89abcdefab89abcdef88ac',
      })),
    })),
  }
})

import { listOrdinal, cancelOrdinalListing } from './marketplace'
import { createOrdListings, cancelOrdListings } from 'js-1sat-ord'
import { broadcastTransaction } from './transactions'
import {
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
} from '../sync'

const mockCreateOrdListings = vi.mocked(createOrdListings)
const mockCancelOrdListings = vi.mocked(cancelOrdListings)
const mockBroadcast = vi.mocked(broadcastTransaction)
const mockMarkPending = vi.mocked(markUtxosPendingSpend)
const mockConfirmSpent = vi.mocked(confirmUtxosSpent)
const mockRollback = vi.mocked(rollbackPendingSpend)

// Test data
const TEST_ORD_WIF = 'L1RMEbBkMJ3JKzn3e3cE9Fm4XLKP5Pmjbsci7dqASiJVTCTxhsWi'
const TEST_PAY_WIF = 'KxDQjJwvLdNNGhsmmjvnsjp4bfFmrp4zzfNCPkxSnVmfbbzqDnkx'

const mockOrdinalUtxo = {
  txid: 'abc123def456789abc123def456789abc123def456789abc123def456789abcd',
  vout: 0,
  satoshis: 1,
  script: 'deadbeef',
}

const mockPaymentUtxos = [
  {
    txid: 'pay123def456789abc123def456789abc123def456789abc123def456789abcd',
    vout: 0,
    satoshis: 10000,
    script: 'cafebabe',
  },
]

describe('Marketplace Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: all sync operations succeed
    mockMarkPending.mockResolvedValue(undefined)
    mockConfirmSpent.mockResolvedValue(undefined)
    mockRollback.mockResolvedValue(undefined)
  })

  describe('listOrdinal', () => {
    it('should list an ordinal successfully', async () => {
      const mockTx = { id: () => 'mocktxid123' }
      mockCreateOrdListings.mockResolvedValue({
        tx: mockTx as never,
        spentOutpoints: ['abc123:0'],
        payChange: undefined,
      })
      mockBroadcast.mockResolvedValue('broadcasted_txid_123')

      const txid = await listOrdinal(
        TEST_ORD_WIF,
        mockOrdinalUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos,
        '1PayAddress123',
        '1OrdAddress456',
        50000
      )

      expect(txid).toBe('broadcasted_txid_123')
      expect(mockMarkPending).toHaveBeenCalledOnce()
      expect(mockCreateOrdListings).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith(mockTx)
      expect(mockConfirmSpent).toHaveBeenCalledOnce()

      // Verify listing config
      const config = mockCreateOrdListings.mock.calls[0][0]
      expect(config.listings).toHaveLength(1)
      expect(config.listings[0].price).toBe(50000)
      expect(config.listings[0].payAddress).toBe('1PayAddress123')
      expect(config.listings[0].ordAddress).toBe('1OrdAddress456')
    })

    it('should rollback on broadcast failure', async () => {
      const mockTx = { id: () => 'mocktxid123' }
      mockCreateOrdListings.mockResolvedValue({
        tx: mockTx as never,
        spentOutpoints: ['abc123:0'],
        payChange: undefined,
      })
      mockBroadcast.mockRejectedValue(new Error('Broadcast failed'))

      await expect(
        listOrdinal(
          TEST_ORD_WIF,
          mockOrdinalUtxo,
          TEST_PAY_WIF,
          mockPaymentUtxos,
          '1PayAddress123',
          '1OrdAddress456',
          50000
        )
      ).rejects.toThrow('Broadcast failed')

      expect(mockRollback).toHaveBeenCalledOnce()
      expect(mockConfirmSpent).not.toHaveBeenCalled()
    })

    it('should throw if UTXOs cannot be marked pending', async () => {
      mockMarkPending.mockRejectedValue(new Error('DB error'))

      await expect(
        listOrdinal(
          TEST_ORD_WIF,
          mockOrdinalUtxo,
          TEST_PAY_WIF,
          mockPaymentUtxos,
          '1PayAddress123',
          '1OrdAddress456',
          50000
        )
      ).rejects.toThrow('Failed to prepare listing')

      expect(mockCreateOrdListings).not.toHaveBeenCalled()
      expect(mockBroadcast).not.toHaveBeenCalled()
    })

    it('should convert UTXO scripts to base64', async () => {
      const mockTx = { id: () => 'mocktxid123' }
      mockCreateOrdListings.mockResolvedValue({
        tx: mockTx as never,
        spentOutpoints: [],
        payChange: undefined,
      })
      mockBroadcast.mockResolvedValue('txid')

      await listOrdinal(
        TEST_ORD_WIF,
        mockOrdinalUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos,
        '1PayAddress123',
        '1OrdAddress456',
        1000
      )

      const config = mockCreateOrdListings.mock.calls[0][0]
      // Payment UTXOs should have base64-encoded scripts
      expect(config.utxos[0].script).toBeDefined()
      expect(typeof config.utxos[0].script).toBe('string')
      // The listing UTXO should also have a base64-encoded script
      expect(config.listings[0].listingUtxo.script).toBeDefined()
    })
  })

  describe('cancelOrdinalListing', () => {
    it('should cancel a listing successfully', async () => {
      const mockTx = { id: () => 'cancel_txid' }
      mockCancelOrdListings.mockResolvedValue({
        tx: mockTx as never,
        spentOutpoints: ['listing:0'],
        payChange: undefined,
      })
      mockBroadcast.mockResolvedValue('cancel_broadcasted_txid')

      const listingUtxo = {
        txid: 'listing_txid_abc123def456789abc123def456789abc123def456789abcd',
        vout: 0,
        satoshis: 1,
        script: 'lockscript123',
      }

      const txid = await cancelOrdinalListing(
        TEST_ORD_WIF,
        listingUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos
      )

      expect(txid).toBe('cancel_broadcasted_txid')
      expect(mockMarkPending).toHaveBeenCalledOnce()
      expect(mockCancelOrdListings).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith(mockTx)
      expect(mockConfirmSpent).toHaveBeenCalledOnce()
    })

    it('should rollback on cancellation failure', async () => {
      mockMarkPending.mockResolvedValue(undefined)
      mockCancelOrdListings.mockRejectedValue(new Error('Cancel script error'))

      const listingUtxo = {
        txid: 'listing_txid_abc123def456789abc123def456789abc123def456789abcd',
        vout: 0,
        satoshis: 1,
        script: 'lockscript123',
      }

      await expect(
        cancelOrdinalListing(
          TEST_ORD_WIF,
          listingUtxo,
          TEST_PAY_WIF,
          mockPaymentUtxos
        )
      ).rejects.toThrow('Cancel script error')

      expect(mockRollback).toHaveBeenCalledOnce()
      expect(mockConfirmSpent).not.toHaveBeenCalled()
    })
  })
})
