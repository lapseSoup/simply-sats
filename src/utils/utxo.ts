/**
 * UTXO Utility Functions
 *
 * Common utilities for working with UTXOs across the codebase.
 *
 * @module utils/utxo
 */

import type { UTXO, ExtendedUTXO } from '../services/wallet'

/**
 * Create a unique key for a UTXO
 * Format: txid:vout
 */
export function getUtxoKey(utxo: { txid: string; vout: number }): string {
  return `${utxo.txid}:${utxo.vout}`
}

/**
 * Parse a UTXO key back to txid and vout
 */
export function parseUtxoKey(key: string): { txid: string; vout: number } | null {
  const [txid, voutStr] = key.split(':')
  if (!txid || !voutStr) return null

  const vout = parseInt(voutStr, 10)
  if (isNaN(vout)) return null

  return { txid, vout }
}

/**
 * Deduplicate UTXOs by txid:vout
 * Later entries override earlier ones (last-write-wins)
 */
export function deduplicateUtxos<T extends { txid: string; vout: number }>(utxos: T[]): T[] {
  const seen = new Map<string, T>()

  for (const utxo of utxos) {
    const key = getUtxoKey(utxo)
    seen.set(key, utxo)
  }

  return Array.from(seen.values())
}

/**
 * Deduplicate UTXOs, preferring first occurrence (first-write-wins)
 */
export function deduplicateUtxosFirst<T extends { txid: string; vout: number }>(utxos: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const utxo of utxos) {
    const key = getUtxoKey(utxo)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(utxo)
    }
  }

  return result
}

/**
 * Filter out UTXOs that are in a given set
 */
export function excludeUtxos<T extends { txid: string; vout: number }>(
  utxos: T[],
  excludeSet: Set<string>
): T[] {
  return utxos.filter(utxo => !excludeSet.has(getUtxoKey(utxo)))
}

/**
 * Calculate total satoshis from a list of UTXOs
 */
export function sumUtxoSatoshis(utxos: { satoshis: number }[]): number {
  return utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0)
}

/**
 * Sort UTXOs by satoshis (descending - largest first)
 * Useful for coin selection algorithms
 */
export function sortUtxosByValueDesc<T extends { satoshis: number }>(utxos: T[]): T[] {
  return [...utxos].sort((a, b) => b.satoshis - a.satoshis)
}

/**
 * Sort UTXOs by satoshis (ascending - smallest first)
 */
export function sortUtxosByValueAsc<T extends { satoshis: number }>(utxos: T[]): T[] {
  return [...utxos].sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Select UTXOs to meet a target amount using a simple greedy algorithm
 * Returns selected UTXOs and remaining amount (0 if target met, negative if overage)
 */
export function selectUtxosGreedy<T extends { satoshis: number }>(
  utxos: T[],
  targetAmount: number
): { selected: T[]; total: number; remaining: number } {
  const sorted = sortUtxosByValueDesc(utxos)
  const selected: T[] = []
  let total = 0

  for (const utxo of sorted) {
    if (total >= targetAmount) break
    selected.push(utxo)
    total += utxo.satoshis
  }

  return {
    selected,
    total,
    remaining: targetAmount - total
  }
}

/**
 * Convert a basic UTXO to an ExtendedUTXO by adding WIF and address
 */
export function toExtendedUtxo(
  utxo: UTXO,
  wif: string,
  address: string
): ExtendedUTXO {
  return {
    ...utxo,
    wif,
    address
  }
}

/**
 * Check if a UTXO is a dust output (below dust threshold)
 * BSV dust threshold is typically 1 satoshi, but for practical purposes
 * we consider anything below 546 sats as dust
 */
export function isDustUtxo(utxo: { satoshis: number }, threshold = 546): boolean {
  return utxo.satoshis < threshold
}

/**
 * Filter out dust UTXOs
 */
export function filterDustUtxos<T extends { satoshis: number }>(
  utxos: T[],
  threshold = 546
): T[] {
  return utxos.filter(utxo => !isDustUtxo(utxo, threshold))
}
