/**
 * Test factories for creating properly-typed mock objects.
 * Eliminates `as any` casts in tests by providing sensible defaults.
 */

import type { DBUtxo, UTXO, ExtendedUTXO } from '../domain/types'

let utxoCounter = 0

/** Create a mock DBUtxo with sensible defaults. Override any field via the partial. */
export function createMockDBUtxo(overrides: Partial<DBUtxo> = {}): DBUtxo {
  utxoCounter++
  return {
    txid: `tx${utxoCounter}`,
    vout: 0,
    satoshis: 1000,
    lockingScript: `script_${utxoCounter}`,
    basket: 'default',
    spendable: true,
    createdAt: Date.now(),
    ...overrides
  }
}

/** Create a mock UTXO (minimal domain type) */
export function createMockUTXO(overrides: Partial<UTXO> = {}): UTXO {
  utxoCounter++
  return {
    txid: `tx${utxoCounter}`,
    vout: 0,
    satoshis: 1000,
    script: `script_${utxoCounter}`,
    ...overrides
  }
}

/** Create a mock ExtendedUTXO */
export function createMockExtendedUTXO(overrides: Partial<ExtendedUTXO> = {}): ExtendedUTXO {
  utxoCounter++
  return {
    txid: `tx${utxoCounter}`,
    vout: 0,
    satoshis: 1000,
    script: `script_${utxoCounter}`,
    wif: `L${utxoCounter}testWif`,
    address: `1Address${utxoCounter}`,
    ...overrides
  }
}

/** Reset the counter between test suites if needed */
export function resetUtxoCounter(): void {
  utxoCounter = 0
}
