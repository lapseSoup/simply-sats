/**
 * Pure Coin Selection Algorithms
 *
 * This module provides pure functions for selecting UTXOs (Unspent Transaction Outputs)
 * for transaction construction. All functions are deterministic with no side effects.
 *
 * The primary algorithm used is "smallest first" greedy selection, which minimizes
 * the number of inputs while ensuring sufficient funds.
 *
 * @module domain/transaction/coinSelection
 */

import type { UTXO, ExtendedUTXO } from '../types'

/**
 * Result of a coin selection operation.
 *
 * @template T - The UTXO type (UTXO or ExtendedUTXO)
 */
export interface CoinSelectionResult<T extends UTXO = UTXO> {
  /** Array of selected UTXOs */
  selected: T[]
  /** Total satoshis from all selected UTXOs */
  total: number
  /** Whether the selection provides sufficient funds for the target amount */
  sufficient: boolean
}

/**
 * Sort UTXOs by value (smallest first for efficient coin selection).
 *
 * This is a pure function that returns a new sorted array without
 * modifying the original. Sorting smallest-first allows the greedy
 * algorithm to use more small UTXOs, consolidating dust.
 *
 * @template T - The UTXO type (UTXO or ExtendedUTXO)
 * @param utxos - Array of UTXOs to sort
 * @returns New array sorted by satoshis (ascending)
 *
 * @example
 * ```typescript
 * const utxos = [{ satoshis: 1000, ... }, { satoshis: 500, ... }]
 * const sorted = sortUtxosByValue(utxos)
 * // sorted[0].satoshis === 500
 * // sorted[1].satoshis === 1000
 * ```
 */
export function sortUtxosByValue<T extends UTXO>(utxos: T[]): T[] {
  return [...utxos].sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Select coins using a greedy "smallest first" algorithm.
 *
 * This function implements coin selection for transaction construction.
 * It uses a greedy approach, selecting the smallest UTXOs first until
 * the target amount (plus buffer) is reached.
 *
 * Benefits of smallest-first selection:
 * - Consolidates small UTXOs (dust cleanup)
 * - Minimizes change output size
 * - More predictable transaction sizes
 *
 * @template T - The UTXO type (UTXO or ExtendedUTXO)
 * @param utxos - Available UTXOs to select from
 * @param targetAmount - Amount needed in satoshis
 * @param buffer - Extra amount for fees (default: 100 satoshis)
 * @returns CoinSelectionResult with selected UTXOs and totals
 *
 * @example
 * ```typescript
 * const utxos = [
 *   { txid: 'abc...', vout: 0, satoshis: 1000, script: '...' },
 *   { txid: 'def...', vout: 1, satoshis: 5000, script: '...' }
 * ]
 *
 * const result = selectCoins(utxos, 3000)
 * // result.selected = both UTXOs (1000 + 5000 = 6000)
 * // result.total = 6000
 * // result.sufficient = true
 * ```
 */
export function selectCoins<T extends UTXO>(
  utxos: T[],
  targetAmount: number,
  buffer: number = 100
): CoinSelectionResult<T> {
  if (utxos.length === 0) {
    return { selected: [], total: 0, sufficient: false }
  }

  const sorted = sortUtxosByValue(utxos)
  const selected: T[] = []
  let total = 0
  const target = targetAmount + buffer

  for (const utxo of sorted) {
    selected.push(utxo)
    total += utxo.satoshis

    if (total >= target) {
      break
    }
  }

  return {
    selected,
    total,
    sufficient: total >= targetAmount
  }
}

/**
 * Select coins from ExtendedUTXOs with multi-key support.
 *
 * This is a convenience wrapper around `selectCoins` for use with
 * ExtendedUTXOs, which include the WIF (private key) and address
 * needed for signing transactions with multiple key sources.
 *
 * @param utxos - Available ExtendedUTXOs to select from
 * @param targetAmount - Amount needed in satoshis
 * @param buffer - Extra amount for fees (default: 100 satoshis)
 * @returns CoinSelectionResult with selected ExtendedUTXOs
 *
 * @example
 * ```typescript
 * const utxos: ExtendedUTXO[] = [
 *   { txid: 'abc...', vout: 0, satoshis: 1000, script: '...', wif: 'L1...', address: '1...' }
 * ]
 *
 * const result = selectCoinsMultiKey(utxos, 500)
 * // result.selected[0].wif is available for signing
 * ```
 */
export function selectCoinsMultiKey(
  utxos: ExtendedUTXO[],
  targetAmount: number,
  buffer: number = 100
): CoinSelectionResult<ExtendedUTXO> {
  return selectCoins(utxos, targetAmount, buffer)
}

/**
 * Determine if a change output is needed for a transaction.
 *
 * When the total input exceeds the send amount plus fee, the excess
 * becomes "change" that should be returned to the sender. However,
 * if the change is below the dust threshold, it's not worth creating
 * a change output (the excess would be given to miners as additional fee).
 *
 * BSV has no protocol-enforced dust limit, but 1 satoshi is used as
 * a practical minimum.
 *
 * @param totalInput - Total satoshis from all transaction inputs
 * @param sendAmount - Amount being sent to recipient in satoshis
 * @param fee - Transaction fee in satoshis
 * @param dustThreshold - Minimum for change output (default: 1 satoshi)
 * @returns True if change output should be created
 *
 * @example
 * ```typescript
 * // 10000 input, sending 5000, 10 fee = 4990 change
 * needsChangeOutput(10000, 5000, 10)  // true
 *
 * // 5010 input, sending 5000, 10 fee = 0 change
 * needsChangeOutput(5010, 5000, 10)   // false
 * ```
 */
export function needsChangeOutput(
  totalInput: number,
  sendAmount: number,
  fee: number,
  dustThreshold: number = 1 // BSV has no dust limit, but we use 1 sat minimum
): boolean {
  const change = totalInput - sendAmount - fee
  return change >= dustThreshold
}
