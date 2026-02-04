/**
 * Pure coin selection algorithms
 * No side effects, no database access
 */

import type { UTXO, ExtendedUTXO } from '../types'

export interface CoinSelectionResult<T extends UTXO = UTXO> {
  selected: T[]
  total: number
  sufficient: boolean
}

/**
 * Sort UTXOs by value (smallest first for efficient coin selection)
 * Pure function - returns new array
 */
export function sortUtxosByValue<T extends UTXO>(utxos: T[]): T[] {
  return [...utxos].sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Select coins using greedy algorithm (smallest first)
 * Pure function - no side effects
 *
 * Works with both UTXO and ExtendedUTXO types via generics.
 *
 * @param utxos - Available UTXOs to select from
 * @param targetAmount - Amount needed in satoshis
 * @param buffer - Extra amount to ensure sufficient for fees (default 100)
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
 * Select coins from ExtendedUTXOs (multi-key support)
 * Convenience alias for selectCoins with ExtendedUTXO type
 * Pure function - no side effects
 */
export function selectCoinsMultiKey(
  utxos: ExtendedUTXO[],
  targetAmount: number,
  buffer: number = 100
): CoinSelectionResult<ExtendedUTXO> {
  return selectCoins(utxos, targetAmount, buffer)
}

/**
 * Calculate if change output is needed
 * Pure function
 *
 * @param totalInput - Total satoshis from all inputs
 * @param sendAmount - Amount being sent in satoshis
 * @param fee - Transaction fee in satoshis
 * @param dustThreshold - Minimum amount for change output (default 1 sat for BSV)
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
