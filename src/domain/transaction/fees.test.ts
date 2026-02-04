import { describe, it, expect } from 'vitest'
import {
  calculateTxFee,
  calculateLockFee,
  feeFromBytes,
  calculateMaxSend,
  calculateExactFee,
  varintSize,
  clampFeeRate,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD,
  DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE
} from './fees'
import type { UTXO } from '../types'

describe('Fee Calculation', () => {
  describe('varintSize', () => {
    it('should return 1 for values < 0xfd', () => {
      expect(varintSize(0)).toBe(1)
      expect(varintSize(100)).toBe(1)
      expect(varintSize(252)).toBe(1)
    })

    it('should return 3 for values <= 0xffff', () => {
      expect(varintSize(253)).toBe(3)
      expect(varintSize(0xffff)).toBe(3)
    })

    it('should return 5 for values <= 0xffffffff', () => {
      expect(varintSize(0x10000)).toBe(5)
      expect(varintSize(0xffffffff)).toBe(5)
    })

    it('should return 9 for larger values', () => {
      expect(varintSize(0x100000000)).toBe(9)
    })
  })

  describe('feeFromBytes', () => {
    it('should calculate fee from bytes using default rate', () => {
      const fee = feeFromBytes(200, DEFAULT_FEE_RATE)
      expect(fee).toBe(Math.max(1, Math.ceil(200 * DEFAULT_FEE_RATE)))
    })

    it('should use custom fee rate when provided', () => {
      const fee = feeFromBytes(200, 0.1)
      expect(fee).toBe(20)
    })

    it('should return minimum of 1 sat', () => {
      const fee = feeFromBytes(1, 0.001)
      expect(fee).toBe(1)
    })
  })

  describe('calculateTxFee', () => {
    it('should calculate fee for 1 input 1 output', () => {
      const fee = calculateTxFee(1, 1, DEFAULT_FEE_RATE)
      const expectedSize = TX_OVERHEAD + P2PKH_INPUT_SIZE + P2PKH_OUTPUT_SIZE
      expect(fee).toBe(Math.max(1, Math.ceil(expectedSize * DEFAULT_FEE_RATE)))
    })

    it('should calculate fee for 2 inputs 2 outputs', () => {
      const fee = calculateTxFee(2, 2, DEFAULT_FEE_RATE)
      const expectedSize = TX_OVERHEAD + (2 * P2PKH_INPUT_SIZE) + (2 * P2PKH_OUTPUT_SIZE)
      expect(fee).toBe(Math.max(1, Math.ceil(expectedSize * DEFAULT_FEE_RATE)))
    })

    it('should include extra bytes in calculation', () => {
      const feeWithoutExtra = calculateTxFee(1, 1, DEFAULT_FEE_RATE)
      const feeWithExtra = calculateTxFee(1, 1, DEFAULT_FEE_RATE, 100)
      expect(feeWithExtra).toBeGreaterThan(feeWithoutExtra)
    })
  })

  describe('calculateLockFee', () => {
    it('should calculate fee for lock transaction with default script size', () => {
      const fee = calculateLockFee(1, DEFAULT_FEE_RATE)
      expect(fee).toBeGreaterThan(0)
    })

    it('should use provided script size', () => {
      const fee = calculateLockFee(1, DEFAULT_FEE_RATE, 500)
      expect(fee).toBeGreaterThan(0)
    })
  })

  describe('calculateMaxSend', () => {
    it('should return 0 for empty UTXOs', () => {
      const result = calculateMaxSend([], DEFAULT_FEE_RATE)
      expect(result.maxSats).toBe(0)
      expect(result.fee).toBe(0)
      expect(result.numInputs).toBe(0)
    })

    it('should calculate max sendable amount', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 10000, script: '' }
      ]
      const result = calculateMaxSend(utxos, DEFAULT_FEE_RATE)
      expect(result.maxSats).toBeLessThan(10000)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.numInputs).toBe(1)
      expect(result.maxSats + result.fee).toBe(10000)
    })
  })

  describe('calculateExactFee', () => {
    it('should return canSend=false for empty UTXOs', () => {
      const result = calculateExactFee(1000, [], DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(false)
    })

    it('should return canSend=false for insufficient funds', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 100, script: '' }
      ]
      const result = calculateExactFee(10000, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(false)
    })

    it('should calculate fee with change output', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 10000, script: '' }
      ]
      const result = calculateExactFee(5000, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(true)
      expect(result.outputCount).toBe(2) // recipient + change
    })

    it('should calculate fee without change for small remainder', () => {
      const utxos: UTXO[] = [
        { txid: 'abc', vout: 0, satoshis: 1000, script: '' }
      ]
      const result = calculateExactFee(900, utxos, DEFAULT_FEE_RATE)
      expect(result.canSend).toBe(true)
    })
  })

  describe('clampFeeRate', () => {
    it('should return MIN_FEE_RATE for values below minimum', () => {
      expect(clampFeeRate(0.001)).toBe(MIN_FEE_RATE)
    })

    it('should return MAX_FEE_RATE for values above maximum', () => {
      expect(clampFeeRate(5.0)).toBe(MAX_FEE_RATE)
    })

    it('should return the same value for rates within range', () => {
      expect(clampFeeRate(0.5)).toBe(0.5)
    })
  })
})
