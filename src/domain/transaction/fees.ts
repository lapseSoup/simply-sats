/**
 * Pure Fee Calculation Functions
 *
 * This module provides pure functions for calculating transaction fees
 * in Bitcoin SV. All functions are deterministic with no side effects.
 *
 * Fee calculation is based on transaction size (in bytes) multiplied
 * by the fee rate (satoshis per byte). BSV typically has very low fees.
 *
 * @module domain/transaction/fees
 */

import type { UTXO, FeeEstimate, MaxSendResult } from '../types'

/**
 * Standard P2PKH input size in bytes.
 * Breakdown: outpoint (36) + scriptlen (1) + scriptsig (~107) + sequence (4)
 */
export const P2PKH_INPUT_SIZE = 148

/**
 * Standard P2PKH output size in bytes.
 * Breakdown: value (8) + scriptlen (1) + script (25)
 */
export const P2PKH_OUTPUT_SIZE = 34

/**
 * Transaction overhead in bytes.
 * Breakdown: version (4) + locktime (4) + input count (~1) + output count (~1)
 */
export const TX_OVERHEAD = 10

/**
 * Default fee rate in satoshis per byte.
 * 100 sat/KB (0.1 sat/byte) provides reliable confirmation
 */
export const DEFAULT_FEE_RATE = 0.1

/**
 * Minimum allowed fee rate in satoshis per byte.
 */
export const MIN_FEE_RATE = 0.01

/**
 * Maximum allowed fee rate in satoshis per byte.
 */
export const MAX_FEE_RATE = 1.0

/**
 * Calculate the varint size for a given value.
 *
 * Variable-length integers (varints) are used in the Bitcoin protocol
 * to encode lengths and counts. This function returns the number of
 * bytes needed to encode a given value as a varint.
 *
 * @param n - The value to encode
 * @returns The number of bytes needed (1, 3, 5, or 9)
 *
 * @example
 * ```typescript
 * varintSize(100)     // 1 (values < 253 use 1 byte)
 * varintSize(1000)    // 3 (values 253-65535 use 3 bytes)
 * varintSize(100000)  // 5 (values > 65535 use 5 bytes)
 * ```
 */
export function varintSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

/**
 * Calculate the fee for a given transaction size.
 *
 * @param bytes - Transaction size in bytes
 * @param feeRate - Fee rate in satoshis per byte
 * @returns Fee in satoshis (minimum 1 sat)
 *
 * @example
 * ```typescript
 * feeFromBytes(250, 0.05)  // 13 (250 * 0.05 = 12.5, rounded up)
 * feeFromBytes(100, 0.5)   // 50
 * ```
 */
export function feeFromBytes(bytes: number, feeRate: number): number {
  return Math.max(1, Math.ceil(bytes * feeRate))
}

/**
 * Calculate the transaction fee for standard P2PKH inputs and outputs.
 *
 * This is the most commonly used fee calculation for simple BSV transactions.
 * The fee is based on the estimated transaction size.
 *
 * @param numInputs - Number of transaction inputs
 * @param numOutputs - Number of transaction outputs
 * @param feeRate - Fee rate in satoshis per byte
 * @param extraBytes - Additional bytes (e.g., for OP_RETURN data)
 * @returns Fee in satoshis
 *
 * @example
 * ```typescript
 * // 2 inputs, 2 outputs (send + change)
 * calculateTxFee(2, 2, 0.05)  // ~18 sats
 *
 * // 1 input, 1 output (max send, no change)
 * calculateTxFee(1, 1, 0.05)  // ~10 sats
 * ```
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
 * Calculate the fee for a time-lock transaction.
 *
 * Lock transactions have larger output scripts due to the CLTV
 * (CheckLockTimeVerify) locking script. This function accounts
 * for the larger script size.
 *
 * @param numInputs - Number of transaction inputs
 * @param feeRate - Fee rate in satoshis per byte
 * @param timelockScriptSize - Size of the timelock script (default: 1090 bytes)
 * @returns Fee in satoshis
 *
 * @example
 * ```typescript
 * // Lock transaction with 1 input
 * calculateLockFee(1, 0.05)  // ~60 sats
 * ```
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
 * Calculate the maximum sendable amount given available UTXOs.
 *
 * When sending the maximum amount, there is no change output
 * (everything goes to the recipient minus the fee).
 *
 * @param utxos - Array of available UTXOs
 * @param feeRate - Fee rate in satoshis per byte
 * @returns Object containing maxSats, fee, and numInputs
 *
 * @example
 * ```typescript
 * const utxos = [{ satoshis: 10000, ... }, { satoshis: 5000, ... }]
 * const result = calculateMaxSend(utxos, 0.05)
 * // result.maxSats = 14990 (15000 - 10 sat fee)
 * // result.fee = 10
 * // result.numInputs = 2
 * ```
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
 * Calculate the exact fee for sending a specific amount.
 *
 * This function performs coin selection (greedy approach) to determine
 * which UTXOs to use, then calculates the precise fee based on the
 * resulting transaction size.
 *
 * @param satoshis - Amount to send in satoshis
 * @param utxos - Array of available UTXOs
 * @param feeRate - Fee rate in satoshis per byte
 * @returns FeeEstimate with fee, input/output counts, and canSend flag
 *
 * @example
 * ```typescript
 * const utxos = [{ satoshis: 10000, ... }]
 * const result = calculateExactFee(5000, utxos, 0.05)
 * // result.fee = 18 (for 2 outputs: send + change)
 * // result.canSend = true
 * // result.inputCount = 1
 * // result.outputCount = 2
 * ```
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

  // Determine if change output exists by matching the builder's logic:
  // compute fee assuming 2 outputs, check if change is positive
  const numInputs = inputsToUse.length
  const feeWith2Outputs = calculateTxFee(numInputs, 2, feeRate)
  const changeWith2Outputs = totalInput - satoshis - feeWith2Outputs
  const willHaveChange = changeWith2Outputs > 0

  const numOutputs = willHaveChange ? 2 : 1
  const fee = willHaveChange ? feeWith2Outputs : calculateTxFee(numInputs, 1, feeRate)

  const change = totalInput - satoshis - fee
  const canSend = change >= 0

  return { fee, inputCount: numInputs, outputCount: numOutputs, totalInput, canSend }
}

/**
 * Clamp a fee rate to the valid range [MIN_FEE_RATE, MAX_FEE_RATE].
 *
 * @param rate - Fee rate to clamp
 * @returns Clamped fee rate
 *
 * @example
 * ```typescript
 * clampFeeRate(0.001)  // 0.01 (MIN_FEE_RATE)
 * clampFeeRate(2.0)    // 1.0 (MAX_FEE_RATE)
 * clampFeeRate(0.5)    // 0.5 (unchanged)
 * ```
 */
export function clampFeeRate(rate: number): number {
  return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
}
