import { describe, it, expect } from 'vitest'
import {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue,
  needsChangeOutput
} from './coinSelection'
import type { UTXO, ExtendedUTXO } from '../types'

describe('Coin Selection', () => {
  describe('sortUtxosByValue', () => {
    it('should sort UTXOs by satoshis ascending', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' },
        { txid: 'c', vout: 0, satoshis: 2000, script: '' }
      ]

      const sorted = sortUtxosByValue(utxos)

      expect(sorted[0].satoshis).toBe(500)
      expect(sorted[1].satoshis).toBe(1000)
      expect(sorted[2].satoshis).toBe(2000)
    })

    it('should not mutate original array', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' }
      ]

      const sorted = sortUtxosByValue(utxos)

      expect(utxos[0].satoshis).toBe(1000) // Original unchanged
      expect(sorted[0].satoshis).toBe(500)
    })

    it('should handle empty array', () => {
      const result = sortUtxosByValue([])
      expect(result).toEqual([])
    })

    it('should handle single UTXO', () => {
      const utxos: UTXO[] = [{ txid: 'a', vout: 0, satoshis: 1000, script: '' }]
      const sorted = sortUtxosByValue(utxos)
      expect(sorted).toHaveLength(1)
      expect(sorted[0].satoshis).toBe(1000)
    })

    it('should handle UTXOs with equal values', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 1000, script: '' },
        { txid: 'c', vout: 0, satoshis: 500, script: '' }
      ]

      const sorted = sortUtxosByValue(utxos)

      expect(sorted[0].satoshis).toBe(500)
      expect(sorted[1].satoshis).toBe(1000)
      expect(sorted[2].satoshis).toBe(1000)
    })
  })

  describe('selectCoins', () => {
    it('should return empty array if no UTXOs', () => {
      const result = selectCoins([], 1000)
      expect(result.selected).toEqual([])
      expect(result.total).toBe(0)
      expect(result.sufficient).toBe(false)
    })

    it('should select minimum UTXOs to cover amount', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 500, script: '' },
        { txid: 'b', vout: 0, satoshis: 600, script: '' },
        { txid: 'c', vout: 0, satoshis: 700, script: '' }
      ]

      const result = selectCoins(utxos, 1000)

      expect(result.sufficient).toBe(true)
      expect(result.total).toBeGreaterThanOrEqual(1000)
    })

    it('should add buffer for fees', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 1000, script: '' },
        { txid: 'b', vout: 0, satoshis: 500, script: '' }
      ]

      // Asking for 1000, but with 100 buffer, needs more
      const result = selectCoins(utxos, 1000, 100)

      expect(result.total).toBeGreaterThanOrEqual(1100)
    })

    it('should return insufficient if not enough funds', () => {
      const utxos: UTXO[] = [{ txid: 'a', vout: 0, satoshis: 100, script: '' }]

      const result = selectCoins(utxos, 1000)

      expect(result.sufficient).toBe(false)
      expect(result.total).toBe(100)
    })

    it('should select coins in sorted order (smallest first)', () => {
      const utxos: UTXO[] = [
        { txid: 'large', vout: 0, satoshis: 10000, script: '' },
        { txid: 'small', vout: 0, satoshis: 100, script: '' },
        { txid: 'medium', vout: 0, satoshis: 500, script: '' }
      ]

      const result = selectCoins(utxos, 500)

      // Should select smallest first: 100 + 500 = 600 (with buffer needs 600)
      expect(result.selected[0].txid).toBe('small')
      expect(result.selected[1].txid).toBe('medium')
    })

    it('should work with zero buffer', () => {
      const utxos: UTXO[] = [{ txid: 'a', vout: 0, satoshis: 1000, script: '' }]

      const result = selectCoins(utxos, 1000, 0)

      expect(result.sufficient).toBe(true)
      expect(result.total).toBe(1000)
    })

    it('should select all UTXOs if needed', () => {
      const utxos: UTXO[] = [
        { txid: 'a', vout: 0, satoshis: 100, script: '' },
        { txid: 'b', vout: 0, satoshis: 200, script: '' },
        { txid: 'c', vout: 0, satoshis: 300, script: '' }
      ]

      const result = selectCoins(utxos, 500, 0)

      expect(result.selected).toHaveLength(3)
      expect(result.total).toBe(600)
      expect(result.sufficient).toBe(true)
    })
  })

  describe('selectCoinsMultiKey', () => {
    it('should work with ExtendedUTXOs', () => {
      const utxos: ExtendedUTXO[] = [
        {
          txid: 'a',
          vout: 0,
          satoshis: 500,
          script: '',
          wif: 'wif1',
          address: 'addr1'
        },
        {
          txid: 'b',
          vout: 0,
          satoshis: 600,
          script: '',
          wif: 'wif2',
          address: 'addr2'
        }
      ]

      const result = selectCoinsMultiKey(utxos, 1000)

      expect(result.sufficient).toBe(true)
      expect(result.selected[0].wif).toBeDefined()
      expect(result.selected[0].address).toBeDefined()
    })

    it('should return empty array if no UTXOs', () => {
      const result = selectCoinsMultiKey([], 1000)
      expect(result.selected).toEqual([])
      expect(result.total).toBe(0)
      expect(result.sufficient).toBe(false)
    })

    it('should preserve ExtendedUTXO properties in selection', () => {
      const utxos: ExtendedUTXO[] = [
        {
          txid: 'tx1',
          vout: 0,
          satoshis: 1000,
          script: 'script1',
          wif: 'L1wif',
          address: '1addr'
        }
      ]

      const result = selectCoinsMultiKey(utxos, 500, 0)

      expect(result.selected[0]).toEqual({
        txid: 'tx1',
        vout: 0,
        satoshis: 1000,
        script: 'script1',
        wif: 'L1wif',
        address: '1addr'
      })
    })

    it('should sort ExtendedUTXOs by value', () => {
      const utxos: ExtendedUTXO[] = [
        {
          txid: 'large',
          vout: 0,
          satoshis: 5000,
          script: '',
          wif: 'wif1',
          address: 'addr1'
        },
        {
          txid: 'small',
          vout: 0,
          satoshis: 100,
          script: '',
          wif: 'wif2',
          address: 'addr2'
        }
      ]

      const result = selectCoinsMultiKey(utxos, 100, 0)

      expect(result.selected[0].txid).toBe('small')
    })
  })

  describe('needsChangeOutput', () => {
    it('should return true when change exceeds dust threshold', () => {
      // Total: 1000, Send: 500, Fee: 100 => Change: 400
      const result = needsChangeOutput(1000, 500, 100)
      expect(result).toBe(true)
    })

    it('should return false when change is zero', () => {
      // Total: 1000, Send: 900, Fee: 100 => Change: 0
      const result = needsChangeOutput(1000, 900, 100)
      expect(result).toBe(false)
    })

    it('should return false when change is below dust threshold', () => {
      // Total: 1000, Send: 900, Fee: 99 => Change: 1
      // With dust threshold of 10, should be false
      const result = needsChangeOutput(1000, 900, 99, 10)
      expect(result).toBe(false)
    })

    it('should return true when change equals dust threshold', () => {
      // Total: 1000, Send: 800, Fee: 195 => Change: 5
      // With dust threshold of 5, should be true
      const result = needsChangeOutput(1000, 800, 195, 5)
      expect(result).toBe(true)
    })

    it('should use default dust threshold of 1 sat', () => {
      // Total: 1000, Send: 900, Fee: 99 => Change: 1
      // With default dust threshold of 1, should be true
      const result = needsChangeOutput(1000, 900, 99)
      expect(result).toBe(true)
    })

    it('should return false when change is negative', () => {
      // Total: 100, Send: 500, Fee: 100 => Change: -500
      const result = needsChangeOutput(100, 500, 100)
      expect(result).toBe(false)
    })

    it('should handle exact amount with no change', () => {
      // Total: 1000, Send: 1000, Fee: 0 => Change: 0
      const result = needsChangeOutput(1000, 1000, 0)
      expect(result).toBe(false)
    })

    it('should handle large amounts correctly', () => {
      // Total: 100000000 (1 BSV), Send: 50000000, Fee: 500 => Change: 49999500
      const result = needsChangeOutput(100000000, 50000000, 500)
      expect(result).toBe(true)
    })
  })
})
