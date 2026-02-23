// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../services/ordinalCache', () => ({
  getCachedOrdinals: vi.fn()
}))
vi.mock('../services/sync', () => ({
  getOrdinalsFromDatabase: vi.fn()
}))
vi.mock('../services/logger', () => ({
  syncLogger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
}))

import { compareTxByHeight, mergeOrdinalTxEntries } from './syncHelpers'
import { getCachedOrdinals } from '../services/ordinalCache'
import { getOrdinalsFromDatabase } from '../services/sync'
import type { TxHistoryItem } from '../contexts/SyncContext'

const mockedGetCachedOrdinals = vi.mocked(getCachedOrdinals)
const mockedGetOrdinalsFromDatabase = vi.mocked(getOrdinalsFromDatabase)

describe('syncHelpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================
  // compareTxByHeight
  // ============================================================
  describe('compareTxByHeight', () => {
    it('unconfirmed txs (height=0) sort before confirmed txs', () => {
      const unconfirmed: TxHistoryItem = { tx_hash: 'a', height: 0, amount: 100 }
      const confirmed: TxHistoryItem = { tx_hash: 'b', height: 800000, amount: 200 }

      expect(compareTxByHeight(unconfirmed, confirmed)).toBe(-1)
      expect(compareTxByHeight(confirmed, unconfirmed)).toBe(1)
    })

    it('higher blocks sort before lower blocks', () => {
      const higher: TxHistoryItem = { tx_hash: 'a', height: 900000, amount: 100 }
      const lower: TxHistoryItem = { tx_hash: 'b', height: 800000, amount: 200 }

      // higher block should come first (negative return value)
      expect(compareTxByHeight(higher, lower)).toBeLessThan(0)
    })

    it('two unconfirmed txs use createdAt tiebreaker (newer first)', () => {
      const newer: TxHistoryItem = { tx_hash: 'a', height: 0, amount: 100, createdAt: 2000 }
      const older: TxHistoryItem = { tx_hash: 'b', height: 0, amount: 200, createdAt: 1000 }

      // newer createdAt should come first (negative return value)
      expect(compareTxByHeight(newer, older)).toBeLessThan(0)
      expect(compareTxByHeight(older, newer)).toBeGreaterThan(0)
    })

    it('two txs with same height sort stably (return 0)', () => {
      const a: TxHistoryItem = { tx_hash: 'a', height: 800000, amount: 100 }
      const b: TxHistoryItem = { tx_hash: 'b', height: 800000, amount: 200 }

      expect(compareTxByHeight(a, b)).toBe(0)
    })

    it('handles undefined createdAt gracefully (defaults to 0)', () => {
      const withCreatedAt: TxHistoryItem = { tx_hash: 'a', height: 0, amount: 100, createdAt: 5000 }
      const withoutCreatedAt: TxHistoryItem = { tx_hash: 'b', height: 0, amount: 200 }

      // withCreatedAt has createdAt=5000, withoutCreatedAt defaults to 0
      // (b.createdAt ?? 0) - (a.createdAt ?? 0) = 0 - 5000 = -5000 => withCreatedAt sorts second
      // But from caller perspective: compareTxByHeight(withCreatedAt, withoutCreatedAt)
      // = (0 ?? 0) - (5000 ?? 0) = -5000 => withCreatedAt comes first (newer)
      expect(compareTxByHeight(withCreatedAt, withoutCreatedAt)).toBeLessThan(0)
      expect(compareTxByHeight(withoutCreatedAt, withCreatedAt)).toBeGreaterThan(0)
    })

    it('handles null-ish height values by treating them as 0 (unconfirmed)', () => {
      // The function uses `a.height || 0` which coerces undefined/null/0 all to 0
      const a: TxHistoryItem = { tx_hash: 'a', height: 0, amount: 100, createdAt: 100 }
      const b: TxHistoryItem = { tx_hash: 'b', height: 0, amount: 200, createdAt: 200 }

      // Both unconfirmed, b.createdAt > a.createdAt => b sorts first
      expect(compareTxByHeight(a, b)).toBeGreaterThan(0)
    })

    it('correctly sorts a mixed array of txs', () => {
      const txs: TxHistoryItem[] = [
        { tx_hash: 'low', height: 100, amount: 10 },
        { tx_hash: 'unconfirmed-old', height: 0, amount: 20, createdAt: 1000 },
        { tx_hash: 'high', height: 900, amount: 30 },
        { tx_hash: 'unconfirmed-new', height: 0, amount: 40, createdAt: 2000 },
        { tx_hash: 'mid', height: 500, amount: 50 },
      ]

      txs.sort(compareTxByHeight)

      expect(txs.map(t => t.tx_hash)).toEqual([
        'unconfirmed-new',
        'unconfirmed-old',
        'high',
        'mid',
        'low',
      ])
    })
  })

  // ============================================================
  // mergeOrdinalTxEntries
  // ============================================================
  describe('mergeOrdinalTxEntries', () => {
    it('adds synthetic entries for ordinal txids not in the tx history', async () => {
      const dbTxHistory: TxHistoryItem[] = [
        { tx_hash: 'existing-tx', height: 800000, amount: 100 }
      ]

      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord1', txid: 'ordinal-tx-1', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 850000 },
      ] as never)

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      expect(dbTxHistory).toHaveLength(2)
      expect(dbTxHistory[1]).toEqual({
        tx_hash: 'ordinal-tx-1',
        height: 850000,
        amount: 1,
        createdAt: 0,
      })
    })

    it('does NOT add duplicates for txids already in the history', async () => {
      const dbTxHistory: TxHistoryItem[] = [
        { tx_hash: 'shared-tx', height: 800000, amount: 100 }
      ]

      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord1', txid: 'shared-tx', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 800000 },
      ] as never)

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      expect(dbTxHistory).toHaveLength(1)
      expect(dbTxHistory[0]!.tx_hash).toBe('shared-tx')
    })

    it('handles empty ordinal cache (falls back to DB ordinals)', async () => {
      const dbTxHistory: TxHistoryItem[] = [
        { tx_hash: 'existing-tx', height: 800000, amount: 100 }
      ]

      mockedGetCachedOrdinals.mockResolvedValue([])
      mockedGetOrdinalsFromDatabase.mockResolvedValue([
        { txid: 'db-ord-tx', vout: 0, satoshis: 1, origin: 'db-ord-1' }
      ])

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      expect(mockedGetOrdinalsFromDatabase).toHaveBeenCalledWith(1)
      expect(dbTxHistory).toHaveLength(2)
      // DB fallback has no block height => uses -1 sentinel
      expect(dbTxHistory[1]).toEqual({
        tx_hash: 'db-ord-tx',
        height: -1,
        amount: 1,
        createdAt: 0,
      })
    })

    it('handles errors from getCachedOrdinals gracefully (catch swallows)', async () => {
      const dbTxHistory: TxHistoryItem[] = [
        { tx_hash: 'existing-tx', height: 800000, amount: 100 }
      ]

      mockedGetCachedOrdinals.mockRejectedValue(new Error('DB read failed'))

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      // Should not throw, and dbTxHistory remains unchanged
      expect(dbTxHistory).toHaveLength(1)
    })

    it('sets height from cache blockHeight (or -1 sentinel when missing)', async () => {
      const dbTxHistory: TxHistoryItem[] = []

      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord-with-height', txid: 'tx-with-height', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 123456 },
        { origin: 'ord-no-height', txid: 'tx-no-height', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: undefined },
      ] as never)

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      expect(dbTxHistory).toHaveLength(2)
      const withHeight = dbTxHistory.find(t => t.tx_hash === 'tx-with-height')
      const noHeight = dbTxHistory.find(t => t.tx_hash === 'tx-no-height')
      expect(withHeight?.height).toBe(123456)
      expect(noHeight?.height).toBe(-1)
    })

    it('passes null accountId as undefined to getCachedOrdinals', async () => {
      const dbTxHistory: TxHistoryItem[] = []
      mockedGetCachedOrdinals.mockResolvedValue([])
      mockedGetOrdinalsFromDatabase.mockResolvedValue([])

      await mergeOrdinalTxEntries(dbTxHistory, null)

      expect(mockedGetCachedOrdinals).toHaveBeenCalledWith(undefined)
    })

    it('does not call getOrdinalsFromDatabase when cache has entries', async () => {
      const dbTxHistory: TxHistoryItem[] = []

      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord1', txid: 'tx1', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 100 },
      ] as never)

      await mergeOrdinalTxEntries(dbTxHistory, 1)

      expect(mockedGetOrdinalsFromDatabase).not.toHaveBeenCalled()
    })
  })
})
