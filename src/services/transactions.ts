/**
 * Transaction Service for Simply Sats
 *
 * Handles building, signing, and broadcasting BSV transactions.
 * Includes support for multi-key spending from derived addresses.
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import type { UTXO, ExtendedUTXO } from './wallet'
import {
  getSpendableUtxosFromDatabase,
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  BASKETS
} from './sync'
import { TIMEOUTS } from './config'
import { BroadcastError, AppError, ErrorCodes } from './errors'
import { walletLogger } from './logger'
import { acquireSyncLock } from './cancellation'
import { getDerivedAddresses, withTransaction } from './database'

// Default fee rate: 0.1 sat/byte (100 sat/KB) - reliable confirmation
const DEFAULT_FEE_RATE = 0.1

// Standard P2PKH sizes
const P2PKH_INPUT_SIZE = 148  // outpoint 36 + scriptlen 1 + scriptsig ~107 + sequence 4
const P2PKH_OUTPUT_SIZE = 34  // value 8 + scriptlen 1 + script 25
const TX_OVERHEAD = 10        // version 4 + locktime 4 + input count ~1 + output count ~1

/**
 * Get the current fee rate from settings or use default.
 * Clamped to valid range to prevent transaction malfunction.
 */
export function getFeeRate(): number {
  const MIN_RATE = 0.01
  const MAX_RATE = 1.0
  const stored = localStorage.getItem('simply_sats_fee_rate')
  if (stored) {
    const rate = parseFloat(stored)
    if (!isNaN(rate) && rate > 0) {
      return Math.max(MIN_RATE, Math.min(MAX_RATE, rate))
    }
  }
  return DEFAULT_FEE_RATE
}

/**
 * Set the fee rate (in sats/byte)
 */
export function setFeeRate(rate: number): void {
  localStorage.setItem('simply_sats_fee_rate', String(rate))
}

/**
 * Get fee rate in sats/KB for display
 */
export function getFeeRatePerKB(): number {
  return Math.round(getFeeRate() * 1000)
}

/**
 * Set fee rate from sats/KB input
 */
export function setFeeRateFromKB(ratePerKB: number): void {
  setFeeRate(ratePerKB / 1000)
}

/**
 * Calculate fee from exact byte size
 */
export function feeFromBytes(bytes: number, customFeeRate?: number): number {
  const rate = customFeeRate ?? getFeeRate()
  return Math.max(1, Math.ceil(bytes * rate))
}

/**
 * Calculate transaction fee for standard P2PKH inputs/outputs
 */
export function calculateTxFee(numInputs: number, numOutputs: number, extraBytes = 0): number {
  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + (numOutputs * P2PKH_OUTPUT_SIZE) + extraBytes
  return feeFromBytes(txSize)
}

/**
 * Calculate varint size for a given length
 */
export function varintSize(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

/**
 * Calculate the exact fee for a lock transaction using actual script size
 */
export function calculateLockFee(numInputs: number, timelockScriptSize?: number): number {
  // If no script size provided, use the actual size from our timelock script
  const scriptSize = timelockScriptSize ?? 1090

  // Lock output: value (8) + varint for script length + script
  const lockOutputSize = 8 + varintSize(scriptSize) + scriptSize
  // Change output: standard P2PKH
  const changeOutputSize = P2PKH_OUTPUT_SIZE

  const txSize = TX_OVERHEAD + (numInputs * P2PKH_INPUT_SIZE) + lockOutputSize + changeOutputSize
  return feeFromBytes(txSize)
}

/**
 * Calculate max sendable amount given UTXOs
 */
export function calculateMaxSend(utxos: UTXO[]): { maxSats: number; fee: number; numInputs: number } {
  if (utxos.length === 0) {
    return { maxSats: 0, fee: 0, numInputs: 0 }
  }

  const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0)
  const numInputs = utxos.length

  // When sending max, we have 1 output (no change)
  const fee = calculateTxFee(numInputs, 1)
  const maxSats = Math.max(0, totalSats - fee)

  return { maxSats, fee, numInputs }
}

/**
 * Calculate exact fee by selecting UTXOs for a given amount
 */
export function calculateExactFee(
  satoshis: number,
  utxos: UTXO[]
): { fee: number; inputCount: number; outputCount: number; totalInput: number; canSend: boolean } {
  if (utxos.length === 0 || satoshis <= 0) {
    return { fee: 0, inputCount: 0, outputCount: 0, totalInput: 0, canSend: false }
  }

  // Select UTXOs
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
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee
  const canSend = change >= 0

  return { fee, inputCount: numInputs, outputCount: numOutputs, totalInput, canSend }
}

/**
 * Broadcast a signed transaction - try multiple endpoints for non-standard scripts
 */
export async function broadcastTransaction(tx: Transaction): Promise<string> {
  const txhex = tx.toHex()
  walletLogger.info('Broadcasting transaction', { txhexPreview: txhex.substring(0, 100) })

  const errors: string[] = []

  // Try WhatsOnChain first
  try {
    walletLogger.debug('Trying WhatsOnChain...')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.broadcast)

    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      walletLogger.info('WhatsOnChain broadcast successful')
      return tx.id('hex')
    }

    const errorText = await response.text()
    walletLogger.warn('WoC broadcast failed', { error: errorText })
    errors.push(`WoC: ${errorText}`)
  } catch (error) {
    walletLogger.warn('WoC error', undefined, error instanceof Error ? error : undefined)
    errors.push(`WoC: ${error}`)
  }

  // Try GorillaPool ARC
  try {
    walletLogger.debug('Trying GorillaPool ARC...')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.broadcast)

    const arcResponse = await fetch('https://arc.gorillapool.io/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: JSON.stringify({
        rawTx: txhex,
        skipScriptFlags: ['DISCOURAGE_UPGRADABLE_NOPS']
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    const arcResult = await arcResponse.json()

    if (arcResult.txid && (arcResult.txStatus === 'SEEN_ON_NETWORK' || arcResult.txStatus === 'ACCEPTED')) {
      walletLogger.info('ARC broadcast successful', { txid: arcResult.txid })
      return arcResult.txid
    } else if (arcResult.txid && !arcResult.detail) {
      walletLogger.info('ARC broadcast possibly successful', { txid: arcResult.txid })
      return arcResult.txid
    } else {
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      walletLogger.warn('ARC rejected transaction', { error: errorMsg })
      errors.push(`ARC: ${errorMsg}`)
    }
  } catch (error) {
    walletLogger.warn('GorillaPool ARC error', undefined, error instanceof Error ? error : undefined)
    errors.push(`ARC: ${error}`)
  }

  throw new BroadcastError(`Failed to broadcast: ${errors.join(' | ')}`)
}

/**
 * @deprecated Use src/services/wallet/transactions.ts sendBSV instead (has atomic DB + sync lock)
 */
export async function sendBSV(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[],
  accountId?: number
): Promise<string> {
  const releaseLock = await acquireSyncLock()
  try {
    return await _sendBSVInner(wif, toAddress, satoshis, utxos, accountId)
  } finally {
    releaseLock()
  }
}

async function _sendBSVInner(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[],
  accountId?: number
): Promise<string> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Generate locking script for the source address
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

  // Collect inputs
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    throw new AppError('Insufficient funds', ErrorCodes.INSUFFICIENT_FUNDS, { required: satoshis, available: totalInput })
  }

  // Calculate fee
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new AppError(`Insufficient funds (need ${fee} sats for fee)`, ErrorCodes.INSUFFICIENT_FUNDS)
  }

  // Add inputs
  for (const utxo of inputsToUse) {
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
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Get the UTXOs we're about to spend
  const utxosToSpend = inputsToUse.map(u => ({ txid: u.txid, vout: u.vout }))

  // Compute txid before broadcast for pending marking
  const pendingTxid = tx.id('hex')

  // CRITICAL: Mark UTXOs as pending BEFORE broadcast to prevent race conditions
  try {
    await markUtxosPendingSpend(utxosToSpend, pendingTxid)
    walletLogger.info('Marked UTXOs as pending spend', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
      walletLogger.info('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  // Track transaction locally — atomic to prevent partial state
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Sent ${satoshis} sats to ${toAddress}`,
        ['send'],
        -(satoshis + fee),  // Negative = money out, includes fee
        accountId
      )
      await confirmUtxosSpent(utxosToSpend, txid)
    })
  } catch (error) {
    walletLogger.warn('Failed to track transaction locally', undefined, error instanceof Error ? error : undefined)
  }

  return txid
}

/**
 * Get all spendable UTXOs from both default and derived baskets
 */
export async function getAllSpendableUTXOs(walletWif: string): Promise<ExtendedUTXO[]> {
  const result: ExtendedUTXO[] = []

  // Get UTXOs from default basket
  const defaultUtxos = await getSpendableUtxosFromDatabase(BASKETS.DEFAULT)
  const walletPrivKey = PrivateKey.fromWif(walletWif)
  const walletAddress = walletPrivKey.toPublicKey().toAddress()

  for (const u of defaultUtxos) {
    result.push({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript,
      wif: walletWif,
      address: walletAddress
    })
  }

  // Get UTXOs from derived basket with their WIFs
  const derivedUtxos = await getSpendableUtxosFromDatabase(BASKETS.DERIVED)
  const derivedAddresses = await getDerivedAddresses()

  for (const u of derivedUtxos) {
    const derivedAddr = derivedAddresses.find(d => {
      const derivedLockingScript = new P2PKH().lock(d.address).toHex()
      return derivedLockingScript === u.lockingScript
    })

    if (derivedAddr) {
      result.push({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript,
        wif: derivedAddr.privateKeyWif,
        address: derivedAddr.address
      })
    }
  }

  return result.sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * @deprecated Use src/services/wallet/transactions.ts sendBSVMultiKey instead (has atomic DB + sync lock)
 */
export async function sendBSVMultiKey(
  changeWif: string,
  toAddress: string,
  satoshis: number,
  utxos: ExtendedUTXO[],
  accountId?: number
): Promise<string> {
  const releaseLock = await acquireSyncLock()
  try {
    return await _sendBSVMultiKeyInner(changeWif, toAddress, satoshis, utxos, accountId)
  } finally {
    releaseLock()
  }
}

async function _sendBSVMultiKeyInner(
  changeWif: string,
  toAddress: string,
  satoshis: number,
  utxos: ExtendedUTXO[],
  accountId?: number
): Promise<string> {
  const changePrivKey = PrivateKey.fromWif(changeWif)
  const changeAddress = changePrivKey.toPublicKey().toAddress()

  const tx = new Transaction()

  // Collect inputs
  const inputsToUse: ExtendedUTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    throw new AppError('Insufficient funds', ErrorCodes.INSUFFICIENT_FUNDS)
  }

  // Calculate fee
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new AppError(`Insufficient funds (need ${fee} sats for fee)`, ErrorCodes.INSUFFICIENT_FUNDS)
  }

  // Add inputs with individual keys
  for (const utxo of inputsToUse) {
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
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(changeAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Get the UTXOs we're about to spend
  const utxosToSpend = inputsToUse.map(u => ({ txid: u.txid, vout: u.vout }))

  // Compute txid before broadcast for pending marking
  const pendingTxid = tx.id('hex')

  // CRITICAL: Mark UTXOs as pending BEFORE broadcast to prevent race conditions
  try {
    await markUtxosPendingSpend(utxosToSpend, pendingTxid)
    walletLogger.info('Marked UTXOs as pending spend', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
      walletLogger.info('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  // Track transaction locally — atomic to prevent partial state
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Sent ${satoshis} sats to ${toAddress}`,
        ['send'],
        -(satoshis + fee),  // Negative = money out, includes fee
        accountId
      )
      await confirmUtxosSpent(utxosToSpend, txid)
    })
  } catch (error) {
    walletLogger.warn('Failed to track transaction locally', undefined, error instanceof Error ? error : undefined)
  }

  return txid
}
