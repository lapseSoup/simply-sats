/**
 * Pure fee calculation functions
 * No side effects, no external dependencies, easily testable
 */

import type { UTXO, FeeEstimate, MaxSendResult } from '../types'

// Standard P2PKH sizes (bytes)
export const P2PKH_INPUT_SIZE = 148  // outpoint 36 + scriptlen 1 + scriptsig ~107 + sequence 4
export const P2PKH_OUTPUT_SIZE = 34  // value 8 + scriptlen 1 + script 25
export const TX_OVERHEAD = 10        // version 4 + locktime 4 + input count ~1 + output count ~1

// Default fee rate: 0.05 sat/byte (50 sat/KB) - BSV miners typically accept very low fees
export const DEFAULT_FEE_RATE = 0.05

// Minimum fee rate (sat/byte)
export const MIN_FEE_RATE = 0.01

// Maximum fee rate (sat/byte)
export const MAX_FEE_RATE = 1.0

/**
 * Calculate varint size for a given length
 * Used for variable-length integer encoding in Bitcoin protocol
 */
export function varintSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

/**
 * Calculate fee from exact byte size
 * Pure function - fee rate must be passed in
 */
export function feeFromBytes(bytes: number, feeRate: number): number {
  return Math.max(1, Math.ceil(bytes * feeRate))
}

/**
 * Calculate transaction fee for standard P2PKH inputs/outputs
 * Pure function - all parameters explicit
 */
export function calculateTxFee(
  numInputs: number,
  numOutputs: number,
  feeRate: number,
  extraBytes: number = 0
): number {
  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + (numOutputs * P2PKH_OUTPUT_SIZE) + extraBytes
  return feeFromBytes(txSize, feeRate)
}

/**
 * Calculate the exact fee for a lock transaction using actual script size
 * Pure function - all parameters explicit
 */
export function calculateLockFee(
  numInputs: number,
  feeRate: number,
  timelockScriptSize: number = 1090
): number {
  // Lock output: value (8) + varint for script length + script
  const lockOutputSize = 8 + varintSize(timelockScriptSize) + timelockScriptSize
  // Change output: standard P2PKH
  const changeOutputSize = P2PKH_OUTPUT_SIZE

  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + lockOutputSize + changeOutputSize
  return feeFromBytes(txSize, feeRate)
}

/**
 * Calculate max sendable amount given UTXOs
 * Pure function - all parameters explicit
 */
export function calculateMaxSend(utxos: UTXO[], feeRate: number): MaxSendResult {
  if (utxos.length === 0) {
    return { maxSats: 0, fee: 0, numInputs: 0 }
  }

  const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  const numInputs = utxos.length

  // When sending max, we have 1 output (no change)
  const fee = calculateTxFee(numInputs, 1, feeRate)
  const maxSats = Math.max(0, totalSats - fee)

  return { maxSats, fee, numInputs }
}

/**
 * Calculate exact fee by selecting UTXOs for a given amount
 * Pure function - returns calculation result without side effects
 */
export function calculateExactFee(
  satoshis: number,
  utxos: UTXO[],
  feeRate: number
): FeeEstimate {
  if (utxos.length === 0 || satoshis <= 0) {
    return { fee: 0, inputCount: 0, outputCount: 0, totalInput: 0, canSend: false }
  }

  // Select UTXOs (greedy approach)
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    return { fee: 0, inputCount: inputsToUse.length, outputCount: 0, totalInput, canSend: false }
  }

  // Calculate if we'll have change
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100

  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs, feeRate)

  const change = totalInput - satoshis - fee
  const canSend = change >= 0

  return { fee, inputCount: numInputs, outputCount: numOutputs, totalInput, canSend }
}

/**
 * Clamp fee rate to valid range
 */
export function clampFeeRate(rate: number): number {
  return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
}
