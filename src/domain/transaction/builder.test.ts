import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted ensures the mock fn is available when vi.mock factory runs (hoisted)
const { mockTauriInvoke } = vi.hoisted(() => ({
  mockTauriInvoke: vi.fn(),
}))

vi.mock('../../utils/tauri', () => ({
  tauriInvoke: mockTauriInvoke,
  isTauri: () => true,
}))

import {
  buildP2PKHTx,
  buildMultiKeyP2PKHTx,
  buildConsolidationTx,
  buildMultiOutputP2PKHTx,
  calculateChangeAndFee,
  p2pkhLockingScriptHex
} from './builder'
import type { UTXO, ExtendedUTXO } from '../types'
import { DEFAULT_FEE_RATE } from './fees'

// Known test addresses (Base58Check-encoded, mainnet P2PKH)
// These are well-known addresses used in Bitcoin protocol documentation.
const TEST_ADDRESS_1 = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' // Satoshi's genesis address
const TEST_ADDRESS_2 = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'

// Deterministic mock results for Tauri invocations
function mockBuiltTxResult(overrides: Partial<{
  rawTx: string
  txid: string
  fee: number
  change: number
  changeAddress: string
  spentOutpoints: Array<{ txid: string; vout: number }>
}> = {}) {
  return {
    rawTx: 'deadbeef'.repeat(32),
    txid: 'a'.repeat(64),
    fee: 23,
    change: 4977,
    changeAddress: TEST_ADDRESS_1,
    spentOutpoints: [{ txid: 'a'.repeat(64), vout: 0 }],
    ...overrides,
  }
}

function mockConsolidationResult(overrides: Partial<{
  rawTx: string
  txid: string
  fee: number
  outputSats: number
  address: string
  spentOutpoints: Array<{ txid: string; vout: number }>
}> = {}) {
  return {
    rawTx: 'cafebabe'.repeat(32),
    txid: 'b'.repeat(64),
    fee: 17,
    outputSats: 783,
    address: TEST_ADDRESS_1,
    spentOutpoints: [
      { txid: 'c'.repeat(64), vout: 0 },
      { txid: 'd'.repeat(64), vout: 0 },
    ],
    ...overrides,
  }
}

function makeUtxo(satoshis: number, index: number = 0): UTXO {
  const txid = 'a'.repeat(63) + index.toString(16)
  return {
    txid,
    vout: 0,
    satoshis,
    script: '76a914' + '00'.repeat(20) + '88ac'
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
    script: '76a914' + '00'.repeat(20) + '88ac',
    wif,
    address
  }
}

beforeEach(() => {
  mockTauriInvoke.mockReset()
})

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

    it('should throw when insufficient funds for fee', () => {
      // totalInput barely covers satoshis, no room for fee
      expect(() => calculateChangeAndFee(1000, 1000, 1, DEFAULT_FEE_RATE)).toThrow('Insufficient funds')
    })

    it('should calculate correct fee based on inputs and outputs', () => {
      const result = calculateChangeAndFee(100000, 50000, 2, DEFAULT_FEE_RATE)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.change).toBe(100000 - 50000 - result.fee)
    })
  })

  describe('p2pkhLockingScriptHex', () => {
    it('should return a hex string for a valid address', () => {
      const hex = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      expect(hex).toBeTruthy()
      expect(typeof hex).toBe('string')
      // P2PKH script should be 50 hex chars (25 bytes)
      expect(hex.length).toBe(50)
    })

    it('should start with OP_DUP OP_HASH160 OP_PUSH20 and end with OP_EQUALVERIFY OP_CHECKSIG', () => {
      const hex = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      expect(hex.startsWith('76a914')).toBe(true)
      expect(hex.endsWith('88ac')).toBe(true)
    })

    it('should produce different scripts for different addresses', () => {
      const hex1 = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      const hex2 = p2pkhLockingScriptHex(TEST_ADDRESS_2)
      expect(hex1).not.toBe(hex2)
    })

    it('should produce the known script for Satoshi genesis address', () => {
      // 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa decodes to pubkey hash:
      // 62e907b15cbf27d5425399ebf6f0fb50ebb88f18
      const hex = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      expect(hex).toBe('76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac')
    })

    it('should be deterministic', () => {
      const hex1 = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      const hex2 = p2pkhLockingScriptHex(TEST_ADDRESS_1)
      expect(hex1).toBe(hex2)
    })
  })

  describe('buildP2PKHTx', () => {
    it('should build a valid signed transaction via Tauri', async () => {
      const utxos = [makeUtxo(10000)]
      const mockResult = mockBuiltTxResult({
        fee: 23,
        change: 4977,
        changeAddress: TEST_ADDRESS_1,
        spentOutpoints: [{ txid: utxos[0]!.txid, vout: 0 }],
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeNull()
      expect(result.rawTx).toBe(mockResult.rawTx)
      expect(result.txid).toBe(mockResult.txid)
      expect(result.fee).toBe(23)
      expect(result.change).toBe(4977)
      expect(result.changeAddress).toBe(TEST_ADDRESS_1)
      expect(result.spentOutpoints).toHaveLength(1)
      expect(result.spentOutpoints[0]!.txid).toBe(utxos[0]!.txid)
    })

    it('should invoke build_p2pkh_tx_from_store with correct args', async () => {
      const utxos = [makeUtxo(10000)]
      mockTauriInvoke.mockResolvedValueOnce(mockBuiltTxResult())

      await buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'build_p2pkh_tx_from_store',
        expect.objectContaining({
          toAddress: TEST_ADDRESS_2,
          satoshis: 5000,
          totalInput: 10000,
          feeRate: DEFAULT_FEE_RATE,
        })
      )
    })

    it('should report numOutputs=2 when change > 0', async () => {
      mockTauriInvoke.mockResolvedValueOnce(mockBuiltTxResult({ change: 4977 }))

      const result = await buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 5000,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.numOutputs).toBe(2)
      expect(result.change).toBeGreaterThan(0)
    })

    it('should report numOutputs=1 when change is 0', async () => {
      mockTauriInvoke.mockResolvedValueOnce(mockBuiltTxResult({ change: 0 }))

      const result = await buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 9980,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.numOutputs).toBe(1)
      expect(result.change).toBe(0)
    })

    it('should propagate errors from Tauri', async () => {
      mockTauriInvoke.mockRejectedValueOnce(new Error('Insufficient funds: need 10023 + 23 fee, have 10000'))

      await expect(buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 10000,
        selectedUtxos: [makeUtxo(10000)],
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Insufficient funds')
    })

    it('should handle multiple inputs', async () => {
      const utxos = [makeUtxo(3000, 0), makeUtxo(4000, 1), makeUtxo(5000, 2)]
      const mockResult = mockBuiltTxResult({
        fee: 35,
        change: 3965,
        spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: 0 })),
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildP2PKHTx({
        wif: 'L1HKVVLHXiUhecWnwFYF6L3shkf1E12HUmuZTESvBXUdx3yqVP1D',
        toAddress: TEST_ADDRESS_2,
        satoshis: 8000,
        selectedUtxos: utxos,
        totalInput: 12000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.spentOutpoints).toHaveLength(3)
      expect(result.fee).toBe(35)
    })
  })

  describe('buildMultiKeyP2PKHTx', () => {
    it('should build a valid multi-key transaction via Tauri', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(5000, 'L1WIF', TEST_ADDRESS_1, 0),
        makeExtendedUtxo(6000, 'L2WIF', TEST_ADDRESS_2, 1)
      ]
      const mockResult = mockBuiltTxResult({
        fee: 30,
        change: 2970,
        changeAddress: TEST_ADDRESS_1,
        spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: 0 })),
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildMultiKeyP2PKHTx({
        changeWif: 'L1WIF',
        toAddress: TEST_ADDRESS_2,
        satoshis: 8000,
        selectedUtxos: utxos,
        totalInput: 11000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeNull()
      expect(result.rawTx).toBeTruthy()
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(result.changeAddress).toBe(TEST_ADDRESS_1)
      expect(result.spentOutpoints).toHaveLength(2)
    })

    it('should invoke build_multi_key_p2pkh_tx_from_store', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(10000, 'L2WIF', TEST_ADDRESS_2, 0)
      ]
      mockTauriInvoke.mockResolvedValueOnce(mockBuiltTxResult())

      await buildMultiKeyP2PKHTx({
        changeWif: 'L1WIF',
        toAddress: TEST_ADDRESS_2,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10000,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(mockTauriInvoke).toHaveBeenCalledWith(
        'build_multi_key_p2pkh_tx_from_store',
        expect.objectContaining({
          toAddress: TEST_ADDRESS_2,
          satoshis: 5000,
          totalInput: 10000,
        })
      )
    })

    it('should propagate errors from Tauri', async () => {
      const utxos: ExtendedUTXO[] = [
        makeExtendedUtxo(5000, 'L1WIF', TEST_ADDRESS_1, 0)
      ]
      mockTauriInvoke.mockRejectedValueOnce(new Error('Insufficient funds'))

      await expect(buildMultiKeyP2PKHTx({
        changeWif: 'L1WIF',
        toAddress: TEST_ADDRESS_2,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 5000,
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Insufficient funds')
    })
  })

  describe('buildConsolidationTx', () => {
    it('should build a valid consolidation transaction via Tauri', async () => {
      const utxos = [
        { txid: 'a'.repeat(64), vout: 0, satoshis: 500, script: '' },
        { txid: 'b'.repeat(64), vout: 0, satoshis: 300, script: '' }
      ]
      const mockResult = mockConsolidationResult({
        fee: 17,
        outputSats: 783,
        address: TEST_ADDRESS_1,
        spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: u.vout })),
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildConsolidationTx({
        wif: 'L1WIF',
        utxos,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.tx).toBeNull()
      expect(result.rawTx).toBeTruthy()
      expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(result.fee).toBe(17)
      expect(result.outputSats).toBe(783)
      expect(result.address).toBe(TEST_ADDRESS_1)
      expect(result.spentOutpoints).toHaveLength(2)
    })

    it('should throw when fewer than 2 UTXOs', async () => {
      await expect(buildConsolidationTx({
        wif: 'L1WIF',
        utxos: [{ txid: 'a'.repeat(64), vout: 0, satoshis: 500, script: '' }],
        feeRate: DEFAULT_FEE_RATE
      })).rejects.toThrow('Need at least 2 UTXOs to consolidate')
    })

    it('should propagate errors from Tauri', async () => {
      mockTauriInvoke.mockRejectedValueOnce(new Error('Cannot consolidate: total 2 sats minus 17 fee leaves no output'))

      const utxos = [
        { txid: 'a'.repeat(64), vout: 0, satoshis: 1, script: '' },
        { txid: 'b'.repeat(64), vout: 0, satoshis: 1, script: '' }
      ]

      await expect(buildConsolidationTx({
        wif: 'L1WIF',
        utxos,
        feeRate: 1.0
      })).rejects.toThrow('Cannot consolidate')
    })

    it('should consolidate many UTXOs', async () => {
      const utxos = Array.from({ length: 10 }, (_, i) => ({
        txid: 'c'.repeat(63) + i.toString(16),
        vout: 0,
        satoshis: 1000,
        script: ''
      }))
      const mockResult = mockConsolidationResult({
        fee: 75,
        outputSats: 9925,
        spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: u.vout })),
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildConsolidationTx({
        wif: 'L1WIF',
        utxos,
        feeRate: DEFAULT_FEE_RATE
      })

      expect(result.outputSats).toBe(9925)
      expect(result.spentOutpoints).toHaveLength(10)
    })
  })

  describe('buildMultiOutputP2PKHTx', () => {
    it('builds a tx with two recipient outputs and change', async () => {
      const mockUtxo = { txid: 'a'.repeat(64), vout: 0, satoshis: 10000, script: '' }
      const mockResult = mockBuiltTxResult({
        fee: 15,
        change: 3985,
        changeAddress: TEST_ADDRESS_1,
        spentOutpoints: [{ txid: mockUtxo.txid, vout: 0 }],
      })
      mockTauriInvoke.mockResolvedValueOnce(mockResult)

      const result = await buildMultiOutputP2PKHTx({
        wif: 'L1WIF',
        outputs: [
          { address: TEST_ADDRESS_2, satoshis: 3000 },
          { address: TEST_ADDRESS_2, satoshis: 3000 },
        ],
        selectedUtxos: [mockUtxo],
        totalInput: 10000,
        feeRate: 0.05,
      })

      expect(result.txid).toHaveLength(64)
      expect(result.numOutputs).toBe(3) // 2 recipients + change (change > 0)
      expect(result.fee).toBeGreaterThan(0)
      expect(result.totalSent).toBe(6000)
    })

    it('throws if outputs array is empty', async () => {
      const mockUtxo = { txid: 'c'.repeat(64), vout: 0, satoshis: 5000, script: '' }
      await expect(buildMultiOutputP2PKHTx({
        wif: 'L1WIF',
        outputs: [],
        selectedUtxos: [mockUtxo],
        totalInput: 5000,
        feeRate: 0.05,
      })).rejects.toThrow('at least one output')
    })

    it('throws if insufficient funds', async () => {
      const mockUtxo = { txid: 'd'.repeat(64), vout: 0, satoshis: 100, script: '' }
      await expect(buildMultiOutputP2PKHTx({
        wif: 'L1WIF',
        outputs: [{ address: TEST_ADDRESS_2, satoshis: 5000 }],
        selectedUtxos: [mockUtxo],
        totalInput: 100,
        feeRate: 0.05,
      })).rejects.toThrow('Insufficient funds')
    })
  })
})
