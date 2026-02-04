import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WocClient
} from './wocClient'
import {
  createWocClient,
  getWocClient,
  DEFAULT_WOC_CONFIG
} from './wocClient'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('WocClient', () => {
  let client: WocClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = createWocClient()
  })

  describe('DEFAULT_WOC_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_WOC_CONFIG.baseUrl).toBe('https://api.whatsonchain.com/v1/bsv/main')
      expect(DEFAULT_WOC_CONFIG.timeout).toBe(30000)
    })
  })

  describe('getBlockHeight', () => {
    it('should fetch current block height', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 850000 })
      })

      const height = await client.getBlockHeight()

      expect(height).toBe(850000)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/chain/info'),
        expect.any(Object)
      )
    })

    it('should return 0 on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const height = await client.getBlockHeight()

      expect(height).toBe(0)
    })

    it('should return 0 on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const height = await client.getBlockHeight()

      expect(height).toBe(0)
    })

    it('should return 0 if blocks is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      })

      const height = await client.getBlockHeight()

      expect(height).toBe(0)
    })
  })

  describe('getBalance', () => {
    it('should fetch address balance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ confirmed: 10000, unconfirmed: 500 })
      })

      const balance = await client.getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(balance).toBe(10500)
    })

    it('should return 0 on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const balance = await client.getBalance('invalid')

      expect(balance).toBe(0)
    })

    it('should return 0 on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const balance = await client.getBalance('invalid')

      expect(balance).toBe(0)
    })

    it('should return 0 if balance fields are not numbers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ confirmed: 'invalid', unconfirmed: null })
      })

      const balance = await client.getBalance('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(balance).toBe(0)
    })
  })

  describe('getUtxos', () => {
    it('should fetch UTXOs for address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { tx_hash: 'abc123', tx_pos: 0, value: 10000 }
        ])
      })

      const utxos = await client.getUtxos('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(utxos).toHaveLength(1)
      expect(utxos[0].txid).toBe('abc123')
      expect(utxos[0].vout).toBe(0)
      expect(utxos[0].satoshis).toBe(10000)
      expect(utxos[0].script).toBeTruthy() // Should have a locking script
    })

    it('should return empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const utxos = await client.getUtxos('invalid')

      expect(utxos).toEqual([])
    })

    it('should return empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      })

      const utxos = await client.getUtxos('invalid')

      expect(utxos).toEqual([])
    })

    it('should return empty array if response is not an array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'not found' })
      })

      const utxos = await client.getUtxos('invalid')

      expect(utxos).toEqual([])
    })
  })

  describe('getTransactionHistory', () => {
    it('should fetch transaction history for address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { tx_hash: 'abc123', height: 850000 },
          { tx_hash: 'def456', height: 849999 }
        ])
      })

      const history = await client.getTransactionHistory('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')

      expect(history).toHaveLength(2)
      expect(history[0].tx_hash).toBe('abc123')
      expect(history[0].height).toBe(850000)
    })

    it('should return empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const history = await client.getTransactionHistory('invalid')

      expect(history).toEqual([])
    })

    it('should return empty array on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      })

      const history = await client.getTransactionHistory('invalid')

      expect(history).toEqual([])
    })

    it('should return empty array if response is not an array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ error: 'not found' })
      })

      const history = await client.getTransactionHistory('invalid')

      expect(history).toEqual([])
    })
  })

  describe('getTransactionDetails', () => {
    it('should fetch transaction details', async () => {
      const txDetails = {
        txid: 'abc123',
        version: 1,
        vin: [],
        vout: []
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(txDetails)
      })

      const details = await client.getTransactionDetails('abc123')

      expect(details).toEqual(txDetails)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tx/abc123'),
        expect.any(Object)
      )
    })

    it('should return null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const details = await client.getTransactionDetails('abc123')

      expect(details).toBeNull()
    })

    it('should return null on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404
      })

      const details = await client.getTransactionDetails('notfound')

      expect(details).toBeNull()
    })
  })

  describe('broadcastTransaction', () => {
    it('should broadcast transaction and return txid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('"abc123def456"')
      })

      const txid = await client.broadcastTransaction('0100000001...')

      expect(txid).toBe('abc123def456')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/tx/raw'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txhex: '0100000001...' })
        })
      )
    })

    it('should handle txid without quotes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('abc123def456')
      })

      const txid = await client.broadcastTransaction('0100000001...')

      expect(txid).toBe('abc123def456')
    })

    it('should throw error on broadcast failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Invalid transaction')
      })

      await expect(client.broadcastTransaction('invalid')).rejects.toThrow('Broadcast failed: Invalid transaction')
    })

    it('should throw error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.broadcastTransaction('0100000001...')).rejects.toThrow('Network error')
    })
  })

  describe('custom config', () => {
    it('should use custom base URL', async () => {
      const customClient = createWocClient({
        baseUrl: 'https://custom.api.com'
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 1 })
      })

      await customClient.getBlockHeight()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom.api.com'),
        expect.any(Object)
      )
    })

    it('should merge with default config', async () => {
      const customClient = createWocClient({
        baseUrl: 'https://custom.api.com'
        // timeout should still be 30000 from default
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 1 })
      })

      await customClient.getBlockHeight()

      // Verify the client was created (timeout would be tested by AbortController)
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('getWocClient', () => {
    it('should return a singleton client', () => {
      // Reset module state for this test
      const client1 = getWocClient()
      const client2 = getWocClient()

      // They should be the same instance
      expect(client1).toBe(client2)
    })
  })

  describe('timeout behavior', () => {
    it('should handle aborted request gracefully', async () => {
      // Mock a request that throws AbortError (simulating timeout)
      mockFetch.mockImplementationOnce(() => {
        const error = new Error('This operation was aborted')
        error.name = 'AbortError'
        return Promise.reject(error)
      })

      const height = await client.getBlockHeight()

      // Should return 0 due to abort/timeout
      expect(height).toBe(0)
    })

    it('should pass signal to fetch for timeout control', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ blocks: 850000 })
      })

      await client.getBlockHeight()

      // Verify that an AbortSignal was passed to fetch
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })
  })
})
