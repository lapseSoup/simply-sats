// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DbError } from '../errors'

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

// S-64: Address validation runs before business logic — mock it to always pass
// so tests exercise the downstream paths (coin selection, broadcast, etc.)
vi.mock('../../domain/wallet/validation', () => ({
  isValidBSVAddress: vi.fn(() => true),
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
    mockMarkPending.mockResolvedValue({ ok: true, value: undefined })
    mockConfirmSpent.mockResolvedValue({ ok: true, value: undefined })
    mockRollback.mockResolvedValue({ ok: true, value: undefined })
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

      const result = await listOrdinal(
        TEST_ORD_WIF,
        mockOrdinalUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos,
        '1PayAddress123',
        '1OrdAddress456',
        50000
      )

      expect(result.ok).toBe(true)
      const txid = result.ok ? result.value : ''
      expect(txid).toBe('broadcasted_txid_123')
      expect(mockMarkPending).toHaveBeenCalledOnce()
      expect(mockCreateOrdListings).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith(mockTx)
      expect(mockConfirmSpent).toHaveBeenCalledOnce()

      // Verify listing config
      const config = mockCreateOrdListings.mock.calls[0]![0]
      expect(config.listings).toHaveLength(1)
      expect(config.listings[0]!.price).toBe(50000)
      expect(config.listings[0]!.payAddress).toBe('1PayAddress123')
      expect(config.listings[0]!.ordAddress).toBe('1OrdAddress456')
    })

    it('should rollback on broadcast failure', async () => {
      const mockTx = { id: () => 'mocktxid123' }
      mockCreateOrdListings.mockResolvedValue({
        tx: mockTx as never,
        spentOutpoints: ['abc123:0'],
        payChange: undefined,
      })
      mockBroadcast.mockRejectedValue(new Error('Broadcast failed'))

      const result = await listOrdinal(
        TEST_ORD_WIF,
        mockOrdinalUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos,
        '1PayAddress123',
        '1OrdAddress456',
        50000
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Broadcast failed')
      }

      expect(mockRollback).toHaveBeenCalledOnce()
      expect(mockConfirmSpent).not.toHaveBeenCalled()
    })

    it('should return error if UTXOs cannot be marked pending', async () => {
      mockMarkPending.mockResolvedValue({ ok: false, error: new DbError('DB error', 'QUERY_FAILED') })

      const result = await listOrdinal(
        TEST_ORD_WIF,
        mockOrdinalUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos,
        '1PayAddress123',
        '1OrdAddress456',
        50000
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Failed to mark UTXOs pending')
      }

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

      const config = mockCreateOrdListings.mock.calls[0]![0]
      // Payment UTXOs should have base64-encoded scripts
      expect(config.utxos[0]!.script).toBeDefined()
      expect(typeof config.utxos[0]!.script).toBe('string')
      // The listing UTXO should also have a base64-encoded script
      expect(config.listings[0]!.listingUtxo.script).toBeDefined()
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

      const result = await cancelOrdinalListing(
        TEST_ORD_WIF,
        listingUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos
      )

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value).toBe('cancel_broadcasted_txid')
      expect(mockMarkPending).toHaveBeenCalledOnce()
      expect(mockCancelOrdListings).toHaveBeenCalledOnce()
      expect(mockBroadcast).toHaveBeenCalledWith(mockTx)
      expect(mockConfirmSpent).toHaveBeenCalledOnce()
    })

    it('should rollback on cancellation failure', async () => {
      // markPending succeeds, but cancelOrdListings fails
      mockMarkPending.mockResolvedValue({ ok: true, value: undefined })
      mockCancelOrdListings.mockRejectedValue(new Error('Cancel script error'))

      const listingUtxo = {
        txid: 'listing_txid_abc123def456789abc123def456789abc123def456789abcd',
        vout: 0,
        satoshis: 1,
        script: 'lockscript123',
      }

      const result = await cancelOrdinalListing(
        TEST_ORD_WIF,
        listingUtxo,
        TEST_PAY_WIF,
        mockPaymentUtxos
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('Cancel script error')
      expect(mockRollback).toHaveBeenCalledOnce()
      expect(mockConfirmSpent).not.toHaveBeenCalled()
    })
  })
})

describe('purchaseOrdinal', () => {
  it('returns error if no payment UTXOs', async () => {
    // Dynamic import to pick up the updated module after vi.mock
    const { purchaseOrdinal } = await import('./marketplace')
    const result = await purchaseOrdinal({
      paymentWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73NUBBy7Y',
      paymentUtxos: [],
      ordAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf',
      listingUtxo: { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
      payout: 'dW5sb2Nrc2NyaXB0',
      priceSats: 10000,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('No payment UTXOs')
    }
  })
})
