// @vitest-environment node
/**
 * Tests for BasketService (BRC-46/112/114)
 *
 * BRC-112: Basket balance queries
 * BRC-46: Output relinquishment
 * BRC-114: Time-based action filtering
 *
 * Database is fully mocked — no SQLite runtime needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDbExecute,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('../../infrastructure/database/connection', () => ({
  getDatabase: () => ({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { BasketService } from './baskets'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BasketService', () => {
  let service: BasketService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new BasketService()
  })

  // =========================================================================
  // getBasketBalance (BRC-112)
  // =========================================================================
  describe('getBasketBalance (BRC-112)', () => {
    it('sums satoshis in a named basket', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 50000 }])

      const balance = await service.getBasketBalance('default')

      expect(balance).toBe(50000)
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('SUM(satoshis)'),
        expect.arrayContaining(['default']),
      )
    })

    it('returns 0 for empty basket', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 0 }])

      const balance = await service.getBasketBalance('nonexistent')

      expect(balance).toBe(0)
    })

    it('returns 0 when query returns null total', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: null }])

      const balance = await service.getBasketBalance('empty')

      expect(balance).toBe(0)
    })

    it('filters by account_id', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 25000 }])

      const balance = await service.getBasketBalance('default', 2)

      expect(balance).toBe(25000)
      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([2]),
      )
    })

    it('defaults account_id to 0', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 10000 }])

      await service.getBasketBalance('default')

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0]),
      )
    })

    it('excludes relinquished outputs from balance', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 30000 }])

      await service.getBasketBalance('default')

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('relinquished'),
        expect.any(Array),
      )
    })

    it('only counts spendable outputs', async () => {
      mockDbSelect.mockResolvedValueOnce([{ total: 30000 }])

      await service.getBasketBalance('default')

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('spendable = 1'),
        expect.any(Array),
      )
    })
  })

  // =========================================================================
  // relinquishOutput (BRC-46)
  // =========================================================================
  describe('relinquishOutput (BRC-46)', () => {
    it('marks an output as relinquished', async () => {
      mockDbExecute.mockResolvedValueOnce(undefined)

      const result = await service.relinquishOutput('default', 'abc123.0')

      expect(result.success).toBe(true)
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('relinquished'),
        expect.arrayContaining(['abc123', 0]),
      )
    })

    it('parses outpoint format correctly', async () => {
      mockDbExecute.mockResolvedValueOnce(undefined)

      await service.relinquishOutput('default', 'txid123.2')

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['txid123', 2]),
      )
    })

    it('scopes update to basket and account', async () => {
      mockDbExecute.mockResolvedValueOnce(undefined)

      await service.relinquishOutput('savings', 'txid456.1', 3)

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('basket = ?'),
        expect.arrayContaining(['savings', 3]),
      )
    })

    it('handles 64-char hex txid with high vout index', async () => {
      const longTxid = 'a'.repeat(64)
      mockDbExecute.mockResolvedValueOnce(undefined)

      await service.relinquishOutput('default', `${longTxid}.99`)

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([longTxid, 99]),
      )
    })

    it('throws on invalid outpoint format (no dot)', async () => {
      await expect(
        service.relinquishOutput('default', 'invalid'),
      ).rejects.toThrow('Invalid outpoint format')
    })

    it('throws on invalid outpoint format (non-numeric vout)', async () => {
      await expect(
        service.relinquishOutput('default', 'txid.abc'),
      ).rejects.toThrow('Invalid vout')
    })

    it('throws on empty outpoint', async () => {
      await expect(
        service.relinquishOutput('default', ''),
      ).rejects.toThrow()
    })
  })

  // =========================================================================
  // listActions (BRC-114)
  // =========================================================================
  describe('listActions (BRC-114)', () => {
    it('returns all actions without filters', async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: 1, txid: 'tx1', created_at: 1700000000 },
        { id: 2, txid: 'tx2', created_at: 1700000100 },
      ])

      const actions = await service.listActions({})

      expect(actions).toHaveLength(2)
    })

    it('always scopes to account_id', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({}, 5)

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('account_id = ?'),
        expect.arrayContaining([5]),
      )
    })

    it('filters by since timestamp', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({ since: 1700000000 })

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('created_at >= ?'),
        expect.arrayContaining([1700000000]),
      )
    })

    it('filters by until timestamp', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({ until: 1800000000 })

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('created_at <= ?'),
        expect.arrayContaining([1800000000]),
      )
    })

    it('applies limit and offset', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({ limit: 10, offset: 5 })

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.arrayContaining([10, 5]),
      )
    })

    it('applies offset only when limit is also set', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({ offset: 5 })

      const query = mockDbSelect.mock.calls[0]![0] as string
      // Offset without limit should not appear
      expect(query).not.toContain('OFFSET')
    })

    it('combines multiple filters', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({
        since: 1700000000,
        until: 1800000000,
        limit: 50,
      })

      const query = mockDbSelect.mock.calls[0]![0] as string
      expect(query).toContain('created_at >= ?')
      expect(query).toContain('created_at <= ?')
      expect(query).toContain('LIMIT ?')
    })

    it('orders results by created_at descending', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({})

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        expect.any(Array),
      )
    })

    it('defaults account_id to 0', async () => {
      mockDbSelect.mockResolvedValueOnce([])

      await service.listActions({})

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([0]),
      )
    })
  })
})
