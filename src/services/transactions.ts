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
import { AppError, ErrorCodes } from './errors'
import { walletLogger } from './logger'
import { acquireSyncLock } from './cancellation'
import { getDerivedAddresses, withTransaction } from './database'
import { calculateTxFee } from './wallet/fees'
import { broadcastTransaction as infraBroadcast } from '../infrastructure/api/broadcastService'

/**
 * Broadcast a signed transaction - delegates to infrastructure broadcastService.
 */
export async function broadcastTransaction(tx: Transaction): Promise<string> {
  return infraBroadcast(tx.toHex(), tx.id('hex'))
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
