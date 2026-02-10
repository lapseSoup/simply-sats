import { describe, it, expect } from 'vitest'
import { PrivateKey, P2PKH } from '@bsv/sdk'
import {
  buildP2PKHTx,
  buildMultiKeyP2PKHTx,
  buildConsolidationTx,
  calculateChangeAndFee,
  p2pkhLockingScriptHex
} from './builder'
import type { UTXO, ExtendedUTXO } from '../types'
import { DEFAULT_FEE_RATE } from './fees'

// Deterministic test keys
const TEST_WIF = 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D'
const TEST_WIF_2 = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'

const testPrivKey = PrivateKey.fromWif(TEST_WIF)
const testAddress = testPrivKey.toPublicKey().toAddress()

const testPrivKey2 = PrivateKey.fromWif(TEST_WIF_2)
const testAddress2 = testPrivKey2.toPublicKey().toAddress()

// Recipient address (different key)
const RECIPIENT_ADDRESS = testAddress2

function makeUtxo(satoshis: number, index: number = 0): UTXO {
  // Use a plausible-looking txid (64 hex chars)
  const txid = 'a'.repeat(63) + index.toString(16)
  return {
    txid,
    vout: 0,
    satoshis,
    script: new P2PKH().lock(testAddress).toHex()
  }
}

function makeExtendedUtxo(
  satoshis: number,
  wif: string,
  address: string,
  index: number = 0
): ExtendedUTXO {
  const txid = 'b'.repeat(63) + index.toString(16)
  return {
    txid,
    vout: 0,
    satoshis,
    script: new P2PKH().lock(address).toHex(),
    wif,
    address
  }
}

describe('Transaction Builder', () => {
  describe('calculateChangeAndFee', () => {
    it('should return 2 outputs when preliminary change > 100', () => {
      const result = calculateChangeAndFee(10000, 5000, 1, DEFAULT_FEE_RATE)
      expect(result.numOutputs).toBe(2)
      expect(result.change).toBeGreaterThan(0)
      expect(result.fee).toBeGreaterThan(0)
    })

    it('should return 1 output when preliminary change <= 100', () => {
      // totalInput - satoshis = 50 (below 100 threshold)
      const result = calculateChangeAndFee(5050, 5000, 1, DEFAULT_FEE_RATE)
      expect(result.numOutputs).toBe(1)
    })

    it('should return negative change when insufficient funds for fee', () => {
      // totalInput barely covers satoshis, no room for fee
      const result = calculateChangeAndFee(1000, 1000, 1, DEFAULT_FEE_RATE)
      expect(result.change).toBeLessThan(0)
    })

    it('should calculate correct fee based on inputs and outputs', () => {
      const result = calculateChangeAndFee(100000, 50000, 2, DEFAULT_FEE_RATE)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.change).toBe(100000 - 50000 - result.fee)
    })
  })

  describe('p2pkhLockingScriptHex', () => {
    it('should return a hex string for a valid address', () => {
      const hex = p2pkhLockingScriptHex(testAddress)
      expect(hex).toBeTruthy()
      expect(typeof hex).toBe('string')
      // P2PKH script should be 50 hex chars (25 bytes)
      expect(hex.length).toBe(50)
    })

    it('should match P2PKH().lock().toHex()', () => {
      const expected = new P2PKH().lock(testAddress).toHex()
      const actual = p2pkhLockingScriptHex(testAddress)
      expect(actual).toBe(expected)
    })

    it('should produce different scripts for different addresses', () => {
      const hex1 = p2pkhLockingScriptHex(testAddress)
      const hex2 = p2pkhLockingScriptHex(testAddress2)
      expect(hex1).not.toBe(hex2)
    })
  })

  describe('buildP2PKHTx', () => {
    it('should build a valid signed transaction', async () => {
      const utxos = [makeUtxo(10000)]
      const result = await buildP2PKHTx({
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeDefined()
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.change).toBe(10000 - 5000 - result.fee)
      expect(result.changeAddress).toBe(testAddress)
      expect(result.spentOutpoints).toHaveLength(1)
      expect(result.spentOutpoints[0]!.txid).toBe(utxos[0]!.txid)
    })

    it('should produce a transaction with correct number of outputs', async () => {
      // With change
      const result = await buildP2PKHTx({
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 5000,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      // Should have 2 outputs: recipient + change
      expect(result.tx.outputs.length).toBe(2)
      expect(result.change).toBeGreaterThan(0)
    })

    it('should handle no-change scenario when sending near-max amount', async () => {
      // For no change output: totalInput - satoshis must be <= 100 (heuristic),
      // AND totalInput - satoshis - fee_for_1_output must be <= 0
      // Fee for 1 input, 1 output at 0.1 sat/byte = ceil((10+148+34)*0.1) = 20
      const { fee } = calculateChangeAndFee(10000, 9980, 1, DEFAULT_FEE_RATE)
      // satoshis = totalInput - fee => change = 0
      const exactSatoshis = 10000 - fee

      const result = await buildP2PKHTx({
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: exactSatoshis,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      // With exact max-send amount, change is 0 and only 1 output
      expect(result.change).toBe(0)
      expect(result.tx.outputs.length).toBe(1)
    })

    it('should throw on insufficient funds for fee', async () => {
      await expect(buildP2PKHTx({
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 10000,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Insufficient funds')
    })

    it('should handle multiple inputs', async () => {
      const utxos = [makeUtxo(3000, 0), makeUtxo(4000, 1), makeUtxo(5000, 2)]
      const totalInput = 12000

      const result = await buildP2PKHTx({
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 8000,
        selectedUtxos: utxos,
        totalInput,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx.inputs.length).toBe(3)
      expect(result.spentOutpoints).toHaveLength(3)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.change).toBe(totalInput - 8000 - result.fee)
    })

    it('should produce a deterministic txid', async () => {
      const utxos = [makeUtxo(10000)]
      const params = {
        wif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      }

      const result1 = await buildP2PKHTx(params)
      const result2 = await buildP2PKHTx(params)

      expect(result1.txid).toBe(result2.txid)
    })
  })

  describe('buildMultiKeyP2PKHTx', () => {
    it('should build a valid multi-key transaction', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(5000, TEST_WIF, testAddress, 0),
        makeExtendedUtxo(6000, TEST_WIF_2, testAddress2, 1)
      ]

      const result = await buildMultiKeyP2PKHTx({
        changeWif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 8000,
        selectedUtxos: utxos,
        totalInput: 11000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeDefined()
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(result.tx.inputs.length).toBe(2)
      expect(result.changeAddress).toBe(testAddress)
      expect(result.spentOutpoints).toHaveLength(2)
    })

    it('should throw on insufficient funds for fee', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(5000, TEST_WIF, testAddress, 0)
      ]

      await expect(buildMultiKeyP2PKHTx({
        changeWif: TEST_WIF,
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 5000,
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Insufficient funds')
    })

    it('should use change WIF address for change output', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(10000, TEST_WIF_2, testAddress2, 0)
      ]

      const result = await buildMultiKeyP2PKHTx({
        changeWif: TEST_WIF,  // Change goes to TEST_WIF's address
        toAddress: RECIPIENT_ADDRESS,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      // Change address should be derived from changeWif, not from the input's WIF
      expect(result.changeAddress).toBe(testAddress)
    })
  })

  describe('buildConsolidationTx', () => {
    it('should build a valid consolidation transaction', async () => {
      const utxos = [
        { txid: 'a'.repeat(64), vout: 0, satoshis: 500, script: '' },
        { txid: 'b'.repeat(64), vout: 0, satoshis: 300, script: '' }
      ]

      const result = await buildConsolidationTx({
        wif: TEST_WIF,
        utxos,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeDefined()
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(result.tx.inputs.length).toBe(2)
      expect(result.tx.outputs.length).toBe(1)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.outputSats).toBe(800 - result.fee)
      expect(result.address).toBe(testAddress)
      expect(result.spentOutpoints).toHaveLength(2)
    })

    it('should throw when fewer than 2 UTXOs', async () => {
      await expect(buildConsolidationTx({
        wif: TEST_WIF,
        utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 500, script: '' }],
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Need at least 2 UTXOs to consolidate')
    })

    it('should throw when fee exceeds total input', async () => {
      // Very small UTXOs that can't cover the fee
      const utxos = [
        { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
        { txid: 'b'.repeat(64), vout: 0, satoshis: 1, script: '' }
      ]

      await expect(buildConsolidationTx({
        wif: TEST_WIF,
        utxos,
        feeRate: 1.0  // High fee rate to ensure fee exceeds input
      })).rejects.toThrow('Cannot consolidate')
    })

    it('should consolidate many UTXOs', async () => {
      const utxos = Array.from({ length: 10 }, (_, i) => ({
        txid: 'c'.repeat(63) + i.toString(16),
        vout: 0,
        satoshis: 1000,
        script: ''
      }))

      const result = await buildConsolidationTx({
        wif: TEST_WIF,
        utxos,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx.inputs.length).toBe(10)
      expect(result.tx.outputs.length).toBe(1)
      expect(result.outputSats).toBe(10000 - result.fee)
      expect(result.spentOutpoints).toHaveLength(10)
    })
  })
})
