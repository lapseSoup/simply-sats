/**
 * Pure Transaction Builder
 *
 * This module provides pure functions for constructing and signing
 * P2PKH Bitcoin SV transactions. Transaction building and signing are
 * delegated to the Rust backend via Tauri commands — private keys never
 * enter the JavaScript heap.
 *
 * @module domain/transaction/builder
 */

import type { UTXO, ExtendedUTXO } from '../types'
import { calculateTxFee } from './fees'
import { isTauri, tauriInvoke } from '../../utils/tauri'
import { base58Decode } from '../shared/base58'

// ============================================
// Types
// ============================================

/**
 * Parameters for building a single-key P2PKH transaction.
 */
export interface BuildP2PKHTxParams {
  /** Private key in WIF format */
  wif: string
  /** Recipient BSV address */
  toAddress: string
  /** Amount to send in satoshis */
  satoshis: number
  /** Selected UTXOs to spend (already coin-selected) */
  selectedUtxos: UTXO[]
  /** Total satoshis from all selected UTXOs */
  totalInput: number
  /** Fee rate in satoshis per byte */
  feeRate: number
}

/**
 * Parameters for building a multi-key P2PKH transaction.
 */
export interface BuildMultiKeyP2PKHTxParams {
  /** WIF for the change output address */
  changeWif: string
  /** Recipient BSV address */
  toAddress: string
  /** Amount to send in satoshis */
  satoshis: number
  /** Selected UTXOs with associated WIFs (already coin-selected) */
  selectedUtxos: ExtendedUTXO[]
  /** Total satoshis from all selected UTXOs */
  totalInput: number
  /** Fee rate in satoshis per byte */
  feeRate: number
}

/**
 * Parameters for building a consolidation transaction.
 */
export interface BuildConsolidationTxParams {
  /** Private key in WIF format */
  wif: string
  /** UTXOs to consolidate */
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>
  /** Fee rate in satoshis per byte */
  feeRate: number
}

/**
 * Result of building a transaction.
 *
 * Transaction building is always delegated to Rust (Tauri), so `tx` is always null.
 * The signed transaction is available as `rawTx` (hex-encoded).
 */
export interface BuiltTransaction {
  /** Always null — transaction is built in Rust, not JS */
  tx: null
  /** Hex-encoded raw signed transaction */
  rawTx: string
  /** Transaction ID (hex) */
  txid: string
  /** Fee paid in satoshis */
  fee: number
  /** Change amount in satoshis (0 if no change output) */
  change: number
  /** The sender/change address */
  changeAddress: string
  /** Number of outputs in the transaction */
  numOutputs: number
  /** References to spent UTXOs */
  spentOutpoints: Array<{ txid: string; vout: number }>
}

/**
 * Result of building a consolidation transaction.
 *
 * Transaction building is always delegated to Rust (Tauri), so `tx` is always null.
 */
export interface BuiltConsolidationTransaction {
  /** Always null — transaction is built in Rust, not JS */
  tx: null
  /** Hex-encoded raw signed transaction */
  rawTx: string
  /** Transaction ID (hex) */
  txid: string
  /** Fee paid in satoshis */
  fee: number
  /** Output amount in satoshis */
  outputSats: number
  /** The consolidation address */
  address: string
  /** References to spent UTXOs */
  spentOutpoints: Array<{ txid: string; vout: number }>
}

// ============================================
// Change Output Heuristic
// ============================================

/**
 * Determine the number of outputs and change amount for a transaction.
 *
 * Uses a heuristic: if the preliminary change (totalInput - satoshis)
 * is greater than 100 sats, a change output is added. This ensures
 * there is enough room for the fee plus a non-dust change output.
 *
 * @param totalInput - Total satoshis from all inputs
 * @param satoshis - Amount being sent
 * @param numInputs - Number of transaction inputs
 * @param feeRate - Fee rate in satoshis per byte
 * @returns Object with fee, change, and numOutputs
 */
export function calculateChangeAndFee(
  totalInput: number,
  satoshis: number,
  numInputs: number,
  feeRate: number
): { fee: number; change: number; numOutputs: number } {
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs, feeRate)
  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds: need ${satoshis + fee} sats (${satoshis} + ${fee} fee), have ${totalInput}`)
  }

  return { fee, change, numOutputs }
}

// ============================================
// Transaction Builders
// ============================================

/**
 * Build and sign a P2PKH transaction from a single private key.
 *
 * This is a pure function that constructs a signed BSV transaction.
 * It does not broadcast, record, or modify any external state.
 *
 * @param params - Transaction parameters
 * @returns The built and signed transaction with metadata
 * @throws Error if change is negative (insufficient funds for fee)
 *
 * @example
 * ```typescript
 * const result = await buildP2PKHTx({
 *   wif: 'L1...',
 *   toAddress: '1A1zP1...',
 *   satoshis: 5000,
 *   selectedUtxos: [...],
 *   totalInput: 10000,
 *   feeRate: 0.05
 * })
 * // result.rawTx is ready for broadcasting
 * // result.txid, result.fee, result.change are available
 * ```
 */
export async function buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction> {
  const { toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params

  if (!isTauri()) {
    throw new Error('Transaction building requires Tauri runtime')
  }

  const result = await tauriInvoke<{
    rawTx: string
    txid: string
    fee: number
    change: number
    changeAddress: string
    spentOutpoints: Array<{ txid: string; vout: number }>
  }>('build_p2pkh_tx_from_store', {
    toAddress,
    satoshis,
    selectedUtxos: selectedUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? ''
    })),
    totalInput,
    feeRate
  })

  return {
    tx: null,
    rawTx: result.rawTx,
    txid: result.txid,
    fee: result.fee,
    change: result.change,
    changeAddress: result.changeAddress,
    numOutputs: result.change > 0 ? 2 : 1,
    spentOutpoints: result.spentOutpoints
  }
}

/**
 * Build and sign a P2PKH transaction using UTXOs from multiple keys.
 *
 * Each input may have a different signing key, enabling spending from
 * both the default wallet and derived addresses in a single transaction.
 *
 * @param params - Transaction parameters with per-UTXO signing keys
 * @returns The built and signed transaction with metadata
 * @throws Error if change is negative (insufficient funds for fee)
 *
 * @example
 * ```typescript
 * const result = await buildMultiKeyP2PKHTx({
 *   changeWif: 'L1...',
 *   toAddress: '1A1zP1...',
 *   satoshis: 5000,
 *   selectedUtxos: [
 *     { txid: '...', vout: 0, satoshis: 3000, script: '...', wif: 'L1...', address: '1...' },
 *     { txid: '...', vout: 1, satoshis: 4000, script: '...', wif: 'L2...', address: '1...' }
 *   ],
 *   totalInput: 7000,
 *   feeRate: 0.05
 * })
 * ```
 */
export async function buildMultiKeyP2PKHTx(params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction> {
  const { toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params

  if (!isTauri()) {
    throw new Error('Transaction building requires Tauri runtime')
  }

  // Uses _from_store for the change WIF (wallet key); per-UTXO WIFs for derived
  // addresses are still passed because they come from BRC-42 derivation, not the
  // main wallet key. Future: move derived key resolution to Rust.
  const result = await tauriInvoke<{
    rawTx: string
    txid: string
    fee: number
    change: number
    changeAddress: string
    spentOutpoints: Array<{ txid: string; vout: number }>
  }>('build_multi_key_p2pkh_tx_from_store', {
    toAddress,
    satoshis,
    selectedUtxos: selectedUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script,
      wif: u.wif,
      address: u.address
    })),
    totalInput,
    feeRate
  })

  return {
    tx: null,
    rawTx: result.rawTx,
    txid: result.txid,
    fee: result.fee,
    change: result.change,
    changeAddress: result.changeAddress,
    numOutputs: result.change > 0 ? 2 : 1,
    spentOutpoints: result.spentOutpoints
  }
}

/**
 * Build and sign a consolidation transaction.
 *
 * Combines multiple UTXOs into a single output back to the same address,
 * minus the transaction fee. Useful for reducing UTXO set size and
 * cleaning up dust outputs.
 *
 * @param params - Consolidation parameters
 * @returns The built and signed transaction with metadata
 * @throws Error if fewer than 2 UTXOs provided
 * @throws Error if output amount would be zero or negative after fees
 *
 * @example
 * ```typescript
 * const result = await buildConsolidationTx({
 *   wif: 'L1...',
 *   utxos: [
 *     { txid: '...', vout: 0, satoshis: 500, script: '...' },
 *     { txid: '...', vout: 1, satoshis: 300, script: '...' }
 *   ],
 *   feeRate: 0.05
 * })
 * // result.outputSats = 800 - fee
 * ```
 */
export async function buildConsolidationTx(
  params: BuildConsolidationTxParams
): Promise<BuiltConsolidationTransaction> {
  const { utxos, feeRate } = params

  if (utxos.length < 2) {
    throw new Error('Need at least 2 UTXOs to consolidate')
  }

  if (!isTauri()) {
    throw new Error('Transaction building requires Tauri runtime')
  }

  const result = await tauriInvoke<{
    rawTx: string
    txid: string
    fee: number
    outputSats: number
    address: string
    spentOutpoints: Array<{ txid: string; vout: number }>
  }>('build_consolidation_tx_from_store', {
    utxos: utxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script
    })),
    feeRate
  })

  return {
    tx: null,
    rawTx: result.rawTx,
    txid: result.txid,
    fee: result.fee,
    outputSats: result.outputSats,
    address: result.address,
    spentOutpoints: result.spentOutpoints
  }
}


export interface RecipientOutput {
  address: string
  satoshis: number
}

export interface BuildMultiOutputP2PKHTxParams {
  wif: string
  outputs: RecipientOutput[]
  selectedUtxos: UTXO[]
  totalInput: number
  feeRate: number
}

export interface BuiltMultiOutputTransaction extends BuiltTransaction {
  totalSent: number
}

/**
 * Build and sign a P2PKH transaction with multiple recipient outputs.
 *
 * Sends to multiple recipients in a single transaction, with change back to
 * the sender. This is the multi-recipient analogue of buildP2PKHTx.
 *
 * @param params - Transaction parameters including multiple outputs
 * @returns The built and signed transaction with metadata
 * @throws Error if outputs array is empty
 * @throws Error if insufficient funds to cover all outputs plus fee
 *
 * @example
 * ```typescript
 * const result = await buildMultiOutputP2PKHTx({
 *   wif: 'L1...',
 *   outputs: [
 *     { address: '1A1zP1...', satoshis: 3000 },
 *     { address: '1B2yQ2...', satoshis: 2000 },
 *   ],
 *   selectedUtxos: [...],
 *   totalInput: 10000,
 *   feeRate: 0.05
 * })
 * // result.totalSent === 5000
 * // result.numOutputs === 3 (2 recipients + change)
 * ```
 */
export async function buildMultiOutputP2PKHTx(
  params: BuildMultiOutputP2PKHTxParams
): Promise<BuiltMultiOutputTransaction> {
  const { outputs, selectedUtxos, totalInput, feeRate } = params

  if (outputs.length === 0) {
    throw new Error('Must have at least one output')
  }

  if (!isTauri()) {
    throw new Error('Multi-output transaction building requires Tauri runtime')
  }

  const totalSent = outputs.reduce((sum, o) => sum + o.satoshis, 0)

  // Calculate fee: n inputs, (numRecipients + 1 change) outputs
  const numOutputsWithChange = outputs.length + 1
  const fee = calculateTxFee(selectedUtxos.length, numOutputsWithChange, feeRate)
  const change = totalInput - totalSent - fee

  if (change < 0) {
    throw new Error(
      `Insufficient funds: need ${totalSent + fee} sats (${totalSent} + ${fee} fee), have ${totalInput}`
    )
  }

  // TODO: Create a dedicated Rust command `build_multi_output_p2pkh_tx_from_store`
  // For now, build using the single-output Tauri command per-output is not feasible
  // (multi-output must be a single atomic transaction). This path will be enabled
  // once the Rust backend command is implemented.
  const result = await tauriInvoke<{
    rawTx: string
    txid: string
    fee: number
    change: number
    changeAddress: string
    spentOutpoints: Array<{ txid: string; vout: number }>
  }>('build_multi_output_p2pkh_tx_from_store', {
    outputs: outputs.map(o => ({
      address: o.address,
      satoshis: o.satoshis
    })),
    selectedUtxos: selectedUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? ''
    })),
    totalInput,
    feeRate
  })

  return {
    tx: null,
    rawTx: result.rawTx,
    txid: result.txid,
    fee: result.fee,
    change: result.change,
    changeAddress: result.changeAddress,
    numOutputs: result.change > 0 ? outputs.length + 1 : outputs.length,
    spentOutpoints: result.spentOutpoints,
    totalSent,
  }
}


/**
 * Convert a byte array to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create a P2PKH locking script hex for an address.
 *
 * Constructs the standard P2PKH script:
 *   OP_DUP OP_HASH160 <20-byte-pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
 *
 * The pubkey hash is extracted from the Base58Check-encoded address
 * (bytes 1..21, skipping the version byte and checksum).
 *
 * This is a pure function with no SDK dependencies.
 *
 * @param address - BSV address (Base58Check encoded)
 * @returns Locking script as hex string (50 hex chars / 25 bytes)
 */
export function p2pkhLockingScriptHex(address: string): string {
  const decoded = base58Decode(address, false)
  // S-110: Reject malformed addresses — Base58Check must decode to exactly 25 bytes
  // [version(1)] [pubkeyHash(20)] [checksum(4)] = 25 bytes
  if (decoded.length < 25) {
    throw new Error(`Invalid address: decoded length ${decoded.length} < 25 bytes`)
  }
  // Normal case: extract 20-byte hash after version byte
  const pubkeyHash = decoded.slice(1, 21)
  // OP_DUP(76) OP_HASH160(a9) OP_PUSH20(14) <hash> OP_EQUALVERIFY(88) OP_CHECKSIG(ac)
  return '76a914' + bytesToHex(pubkeyHash) + '88ac'
}
