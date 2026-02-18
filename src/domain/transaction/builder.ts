/**
 * Pure Transaction Builder
 *
 * This module provides pure functions for constructing and signing
 * P2PKH Bitcoin SV transactions. All functions are deterministic
 * with no side effects — no API calls, no database access, no logging.
 *
 * The builder functions take all required data as parameters and return
 * a signed Transaction object ready for broadcasting.
 *
 * @module domain/transaction/builder
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import type { UTXO, ExtendedUTXO } from '../types'
import { calculateTxFee } from './fees'

// ---------------------------------------------------------------------------
// Tauri detection (same pattern as keyDerivation.ts / crypto.ts)
// ---------------------------------------------------------------------------

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const TAURI_COMMAND_TIMEOUT_MS = 30_000

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  const result = invoke<T>(cmd, args)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Tauri command '${cmd}' timed out after ${TAURI_COMMAND_TIMEOUT_MS}ms`)), TAURI_COMMAND_TIMEOUT_MS)
  )
  return Promise.race([result, timeout])
}

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
 * When built via Rust (Tauri), `tx` is null and `rawTx` contains the signed hex.
 * When built via JS fallback, `tx` is the Transaction object and `rawTx` is also set.
 */
export interface BuiltTransaction {
  /** The signed Transaction object (null when built in Rust) */
  tx: Transaction | null
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
 * When built via Rust (Tauri), `tx` is null and `rawTx` contains the signed hex.
 */
export interface BuiltConsolidationTransaction {
  /** The signed Transaction object (null when built in Rust) */
  tx: Transaction | null
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
 * // result.tx is ready for broadcasting
 * // result.txid, result.fee, result.change are available
 * ```
 */
export async function buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction> {
  const { wif, toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params

  // Delegate to Rust when running inside Tauri — use key store (WIF never leaves Rust)
  if (isTauri()) {
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

  // JS fallback (browser dev mode)
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const { fee, change } = calculateChangeAndFee(
    totalInput, satoshis, selectedUtxos.length, feeRate
  )

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // S-10: Validate output sum matches input sum before building transaction
  const outputSum = satoshis + change + fee
  if (outputSum !== totalInput) {
    throw new Error(`Output sum validation failed: inputs=${totalInput}, outputs=${satoshis}+${change}+${fee}=${outputSum}`)
  }

  const tx = new Transaction()

  // Add inputs with unlocking scripts
  for (const utxo of selectedUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        sourceLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add recipient output
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if there is any change
  // Note: BSV has no dust limit — all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  return {
    tx,
    rawTx: tx.toHex(),
    txid: tx.id('hex'),
    fee,
    change,
    changeAddress: fromAddress,
    numOutputs: tx.outputs.length,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout }))
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
  const { changeWif, toAddress, satoshis, selectedUtxos, totalInput, feeRate } = params

  // Delegate to Rust when running inside Tauri
  // Uses _from_store for the change WIF (wallet key); per-UTXO WIFs for derived
  // addresses are still passed because they come from BRC-42 derivation, not the
  // main wallet key. Future: move derived key resolution to Rust.
  if (isTauri()) {
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

  // JS fallback (browser dev mode)
  const changePrivKey = PrivateKey.fromWif(changeWif)
  const changeAddress = changePrivKey.toPublicKey().toAddress()

  const { fee, change } = calculateChangeAndFee(
    totalInput, satoshis, selectedUtxos.length, feeRate
  )

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // S-10: Validate output sum matches input sum before building transaction
  const multiOutputSum = satoshis + change + fee
  if (multiOutputSum !== totalInput) {
    throw new Error(`Output sum validation failed: inputs=${totalInput}, outputs=${satoshis}+${change}+${fee}=${multiOutputSum}`)
  }

  const tx = new Transaction()

  // Add inputs — each with its own key
  for (const utxo of selectedUtxos) {
    const inputPrivKey = PrivateKey.fromWif(utxo.wif)
    const inputLockingScript = new P2PKH().lock(utxo.address)

    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        inputPrivKey,
        'all',
        false,
        utxo.satoshis,
        inputLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add recipient output
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if there is any change
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(changeAddress),
      satoshis: change
    })
  }

  await tx.sign()

  return {
    tx,
    rawTx: tx.toHex(),
    txid: tx.id('hex'),
    fee,
    change,
    changeAddress,
    numOutputs: tx.outputs.length,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout }))
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
  const { wif, utxos, feeRate } = params

  if (utxos.length < 2) {
    throw new Error('Need at least 2 UTXOs to consolidate')
  }

  // Delegate to Rust when running inside Tauri — use key store (WIF never leaves Rust)
  if (isTauri()) {
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

  // JS fallback (browser dev mode)
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const address = publicKey.toAddress()
  const lockingScript = new P2PKH().lock(address)

  // Calculate total input
  let totalInput = 0
  for (const utxo of utxos) {
    totalInput += utxo.satoshis
  }

  // Calculate fee (n inputs, 1 output)
  const fee = calculateTxFee(utxos.length, 1, feeRate)
  const outputSats = totalInput - fee

  if (outputSats <= 0) {
    throw new Error(`Cannot consolidate: total ${totalInput} sats minus ${fee} fee leaves no output`)
  }

  const tx = new Transaction()

  // Add all inputs
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        lockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Single output back to our address
  tx.addOutput({
    lockingScript: new P2PKH().lock(address),
    satoshis: outputSats
  })

  await tx.sign()

  return {
    tx,
    rawTx: tx.toHex(),
    txid: tx.id('hex'),
    fee,
    outputSats,
    address,
    spentOutpoints: utxos.map(u => ({ txid: u.txid, vout: u.vout }))
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
  const { wif, outputs, selectedUtxos, totalInput, feeRate } = params

  if (outputs.length === 0) {
    throw new Error('Must have at least one output')
  }

  const totalSent = outputs.reduce((sum, o) => sum + o.satoshis, 0)

  // Delegate to Rust when running inside Tauri — use key store (WIF never leaves Rust)
  if (isTauri()) {
    const result = await tauriInvoke<{
      rawTx: string
      txid: string
      fee: number
      change: number
      changeAddress: string
      spentOutpoints: Array<{ txid: string; vout: number }>
    }>('build_multi_output_p2pkh_tx_from_store', {
      outputs,
      selectedUtxos: selectedUtxos.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? '',
      })),
      totalInput,
      feeRate,
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

  // JS fallback (browser dev mode / tests)
  const privateKey = PrivateKey.fromWif(wif)
  const fromAddress = privateKey.toPublicKey().toAddress()
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  // Calculate fee: n inputs, (numRecipients + 1 change) outputs
  const numOutputsWithChange = outputs.length + 1
  const fee = calculateTxFee(selectedUtxos.length, numOutputsWithChange, feeRate)
  const change = totalInput - totalSent - fee

  if (change < 0) {
    throw new Error(
      `Insufficient funds: need ${totalSent + fee} sats (${totalSent} + ${fee} fee), have ${totalInput}`
    )
  }

  const tx = new Transaction()

  for (const utxo of selectedUtxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey, 'all', false, utxo.satoshis, sourceLockingScript
      ),
      sequence: 0xffffffff,
    })
  }

  for (const output of outputs) {
    tx.addOutput({ lockingScript: new P2PKH().lock(output.address), satoshis: output.satoshis })
  }

  if (change > 0) {
    tx.addOutput({ lockingScript: new P2PKH().lock(fromAddress), satoshis: change })
  }

  await tx.sign()

  return {
    tx,
    rawTx: tx.toHex(),
    txid: tx.id('hex'),
    fee,
    change,
    changeAddress: fromAddress,
    numOutputs: tx.outputs.length,
    spentOutpoints: selectedUtxos.map(u => ({ txid: u.txid, vout: u.vout })),
    totalSent,
  }
}

/**
 * Create a P2PKH locking script hex for an address.
 *
 * Useful for tracking change UTXOs after transaction broadcast.
 *
 * @param address - BSV address
 * @returns Locking script as hex string
 */
export function p2pkhLockingScriptHex(address: string): string {
  return new P2PKH().lock(address).toHex()
}
