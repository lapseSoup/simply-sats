// @vitest-environment node

/**
 * Tests for Token Service (tokens.ts)
 *
 * Covers: setTokenNetwork, fetchTokenBalances, fetchTokenDetails,
 *         fetchBsv21Details, fetchTokenUtxos, getTokenByTicker,
 *         getTokenById, getAllTokens, updateTokenBalance,
 *         getTokenBalancesFromDb, ensureTokensTables
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGpGet,
  mockDbSelect,
  mockDbExecute,
  mockWithTransaction,
} = vi.hoisted(() => ({
  mockGpGet: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbExecute: vi.fn(),
  mockWithTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

vi.mock('../infrastructure/api/clients', () => ({
  gpOrdinalsApi: { get: (...args: unknown[]) => mockGpGet(...args) },
}))

vi.mock('./database', () => ({
  getDatabase: () => ({
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  }),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...(args as [() => Promise<unknown>])),
}))

vi.mock('./logger', () => ({
  tokenLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./wallet', () => ({
  broadcastTransaction: vi.fn(),
  calculateTxFee: vi.fn().mockReturnValue(200),
  type: {},
}))

vi.mock('@bsv/sdk', () => ({
  Transaction: class { },
  PrivateKey: class { static fromWif() { return {} } },
  P2PKH: class { lock() { return { toHex: () => 'script', toBinary: () => new Uint8Array() } } },
  Script: class { static fromHex() { return {} } },
}))

vi.mock('../domain/types', () => ({
  ok: (v: unknown) => ({ ok: true, value: v }),
  err: (e: unknown) => ({ ok: false, error: e }),
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  setTokenNetwork,
  fetchTokenBalances,
  fetchTokenDetails,
  fetchBsv21Details,
  fetchTokenUtxos,
  getTokenByTicker,
  getTokenById,
  getAllTokens,
  updateTokenBalance,
  ensureTokensTables,
} from './tokens'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Token Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockWithTransaction.mockImplementation(async (fn: () => Promise<unknown>) => fn())
    mockDbExecute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 })
  })

  // =========================================================================
  // setTokenNetwork
  // =========================================================================

  describe('setTokenNetwork', () => {
    it('should be a no-op (does not throw)', () => {
      expect(() => setTokenNetwork('mainnet')).not.toThrow()
      expect(() => setTokenNetwork('testnet')).not.toThrow()
    })
  })

  // =========================================================================
  // fetchTokenBalances
  // =========================================================================

  describe('fetchTokenBalances', () => {
    it('should fetch and return token balances', async () => {
      const gpData = [
        {
          tick: 'PEPE',
          dec: 8,
          all: { confirmed: '100000000', pending: '0' },
          listed: { confirmed: '0', pending: '0' },
        },
      ]
      mockGpGet.mockResolvedValueOnce({ ok: true, value: gpData })
      // getTokenByTicker returns null (new token)
      mockDbSelect.mockResolvedValue([])
      mockDbExecute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 1 })

      const result = await fetchTokenBalances('1TestAddr')

      expect(result).toHaveLength(1)
      expect(result[0]!.token.ticker).toBe('PEPE')
      expect(result[0]!.confirmed).toBe(100000000n)
      expect(result[0]!.total).toBe(100000000n)
    })

    it('should return empty array when API fails', async () => {
      mockGpGet.mockResolvedValue({ ok: false, error: { message: 'API down' } })

      const result = await fetchTokenBalances('1TestAddr')

      expect(result).toEqual([])
    })

    it('should handle API exception gracefully', async () => {
      mockGpGet.mockRejectedValue(new Error('Network error'))

      const result = await fetchTokenBalances('1TestAddr')

      expect(result).toEqual([])
    })

    it('should handle BSV21 tokens (using id instead of tick)', async () => {
      const gpData = [
        {
          id: 'contract123',
          sym: 'TOKEN',
          dec: 18,
          all: { confirmed: '5000', pending: '100' },
        },
      ]
      mockGpGet.mockResolvedValueOnce({ ok: true, value: gpData })
      mockDbSelect.mockResolvedValue([])
      mockDbExecute.mockResolvedValue({ lastInsertId: 2, rowsAffected: 1 })

      const result = await fetchTokenBalances('1TestAddr')

      expect(result).toHaveLength(1)
      expect(result[0]!.token.protocol).toBe('bsv21')
      expect(result[0]!.token.contractTxid).toBe('contract123')
    })
  })

  // =========================================================================
  // fetchTokenDetails
  // =========================================================================

  describe('fetchTokenDetails', () => {
    it('should return token details for a valid ticker', async () => {
      mockGpGet.mockResolvedValue({
        ok: true,
        value: {
          tick: 'PEPE',
          max: '21000000',
          lim: '1000',
          dec: 8,
          icon: 'https://example.com/pepe.png',
        },
      })

      const result = await fetchTokenDetails('PEPE')

      expect(result).not.toBeNull()
      expect(result!.ticker).toBe('PEPE')
      expect(result!.totalSupply).toBe('21000000')
      expect(result!.decimals).toBe(8)
      expect(result!.protocol).toBe('bsv20')
    })

    it('should return null when API fails', async () => {
      mockGpGet.mockResolvedValue({ ok: false, error: { message: 'not found' } })

      const result = await fetchTokenDetails('UNKNOWN')

      expect(result).toBeNull()
    })

    it('should return null on exception', async () => {
      mockGpGet.mockRejectedValue(new Error('Network error'))

      const result = await fetchTokenDetails('PEPE')

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // fetchBsv21Details
  // =========================================================================

  describe('fetchBsv21Details', () => {
    it('should return BSV21 token details', async () => {
      mockGpGet.mockResolvedValue({
        ok: true,
        value: {
          sym: 'MYTOKEN',
          id: 'contract456',
          dec: 18,
          max: '1000000',
          icon: 'https://example.com/icon.png',
        },
      })

      const result = await fetchBsv21Details('contract456')

      expect(result).not.toBeNull()
      expect(result!.protocol).toBe('bsv21')
      expect(result!.contractTxid).toBe('contract456')
      expect(result!.ticker).toBe('MYTOKEN')
    })

    it('should return null when API fails', async () => {
      mockGpGet.mockResolvedValue({ ok: false, error: { message: 'not found' } })

      const result = await fetchBsv21Details('unknown')

      expect(result).toBeNull()
    })

    it('should return null on exception', async () => {
      mockGpGet.mockRejectedValue(new Error('Network error'))

      const result = await fetchBsv21Details('contract456')

      expect(result).toBeNull()
    })

    it('should use contractId as ticker when sym is missing', async () => {
      mockGpGet.mockResolvedValue({
        ok: true,
        value: { id: 'contract789', dec: 0 },
      })

      const result = await fetchBsv21Details('contract789')

      expect(result!.ticker).toBe('contract789')
    })
  })

  // =========================================================================
  // fetchTokenUtxos
  // =========================================================================

  describe('fetchTokenUtxos', () => {
    it('should return confirmed token UTXOs', async () => {
      mockGpGet.mockResolvedValue({
        ok: true,
        value: [
          { status: 1, txid: 'tx1', vout: 0, amt: '100', tick: 'PEPE' },
          { status: 0, txid: 'tx2', vout: 0, amt: '50', tick: 'PEPE' }, // Unconfirmed
        ],
      })

      const result = await fetchTokenUtxos('PEPE', '1TestAddr')

      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx1')
      expect(result[0]!.status).toBe(1)
    })

    it('should return empty array when API fails', async () => {
      mockGpGet.mockResolvedValue({ ok: false, error: { message: 'error' } })

      const result = await fetchTokenUtxos('PEPE', '1TestAddr')

      expect(result).toEqual([])
    })

    it('should return empty array on exception', async () => {
      mockGpGet.mockRejectedValue(new Error('Network error'))

      const result = await fetchTokenUtxos('PEPE', '1TestAddr')

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // getTokenByTicker
  // =========================================================================

  describe('getTokenByTicker', () => {
    it('should return token from database', async () => {
      mockDbSelect.mockResolvedValue([
        {
          id: 1,
          ticker: 'PEPE',
          protocol: 'bsv20',
          contract_txid: null,
          name: 'PEPE',
          decimals: 8,
          total_supply: '21000000',
          icon_url: null,
          verified: 0,
          created_at: 1000000,
        },
      ])

      const result = await getTokenByTicker('PEPE')

      expect(result).not.toBeNull()
      expect(result!.ticker).toBe('PEPE')
      expect(result!.verified).toBe(false)
    })

    it('should return null when token not found', async () => {
      mockDbSelect.mockResolvedValue([])

      const result = await getTokenByTicker('UNKNOWN')

      expect(result).toBeNull()
    })

    it('should return null on database error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getTokenByTicker('PEPE')

      expect(result).toBeNull()
    })

    it('should default to bsv20 protocol', async () => {
      mockDbSelect.mockResolvedValue([])

      await getTokenByTicker('PEPE')

      expect(mockDbSelect).toHaveBeenCalledWith(
        expect.any(String),
        ['PEPE', 'bsv20']
      )
    })
  })

  // =========================================================================
  // getTokenById
  // =========================================================================

  describe('getTokenById', () => {
    it('should return token by ID', async () => {
      mockDbSelect.mockResolvedValue([
        {
          id: 42,
          ticker: 'TOKEN',
          protocol: 'bsv21',
          contract_txid: 'ctx123',
          name: 'My Token',
          decimals: 18,
          total_supply: null,
          icon_url: null,
          verified: 1,
          created_at: 2000000,
        },
      ])

      const result = await getTokenById(42)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(42)
      expect(result!.verified).toBe(true)
      expect(result!.protocol).toBe('bsv21')
    })

    it('should return null when ID not found', async () => {
      mockDbSelect.mockResolvedValue([])

      const result = await getTokenById(999)

      expect(result).toBeNull()
    })

    it('should return null on database error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getTokenById(42)

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // getAllTokens
  // =========================================================================

  describe('getAllTokens', () => {
    it('should return all tokens from database', async () => {
      mockDbSelect.mockResolvedValue([
        { id: 1, ticker: 'AAA', protocol: 'bsv20', contract_txid: null, name: 'AAA', decimals: 0, total_supply: null, icon_url: null, verified: 0, created_at: 1000 },
        { id: 2, ticker: 'BBB', protocol: 'bsv21', contract_txid: 'ctx1', name: 'BBB', decimals: 18, total_supply: '1000000', icon_url: null, verified: 1, created_at: 2000 },
      ])

      const result = await getAllTokens()

      expect(result).toHaveLength(2)
      expect(result[0]!.ticker).toBe('AAA')
      expect(result[1]!.ticker).toBe('BBB')
    })

    it('should return empty array on database error', async () => {
      mockDbSelect.mockRejectedValue(new Error('DB error'))

      const result = await getAllTokens()

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // updateTokenBalance
  // =========================================================================

  describe('updateTokenBalance', () => {
    it('should execute upsert query', async () => {
      await updateTokenBalance(1, 42, '100000')

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO token_balances'),
        expect.arrayContaining([1, 42, undefined, '100000'])
      )
    })

    it('should pass utxoId when provided', async () => {
      await updateTokenBalance(1, 42, '100000', 99)

      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([1, 42, 99, '100000'])
      )
    })
  })

  // =========================================================================
  // ensureTokensTables
  // =========================================================================

  describe('ensureTokensTables', () => {
    it('should not throw when tables exist', async () => {
      mockDbSelect.mockResolvedValue([{ id: 1 }])

      await expect(ensureTokensTables()).resolves.toBeUndefined()
    })

    it('should not throw when tables do not exist', async () => {
      mockDbSelect.mockRejectedValue(new Error('no such table'))

      await expect(ensureTokensTables()).resolves.toBeUndefined()
    })
  })
})
