/**
 * Transaction building and broadcasting
 * Handles sendBSV, sendBSVMultiKey, and broadcastTransaction
 *
 * Pure TX construction is delegated to domain/transaction/builder.
 * This module handles orchestration: validation, UTXO locking, broadcasting, and DB recording.
 */

import { PrivateKey, Transaction } from '@bsv/sdk'
import type { UTXO, ExtendedUTXO } from './types'
import { getFeeRate } from './fees'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { selectCoins, selectCoinsMultiKey } from '../../domain/transaction/coinSelection'
import {
  buildP2PKHTx,
  buildMultiKeyP2PKHTx,
  buildConsolidationTx,
  p2pkhLockingScriptHex
} from '../../domain/transaction/builder'
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getSpendableUtxosFromDatabase,
  BASKETS
} from '../sync'
import { getDerivedAddresses, withTransaction, addUTXO } from '../database'
import { walletLogger } from '../logger'
import { resetInactivityTimer } from '../autoLock'
import { acquireSyncLock } from '../cancellation'
import { broadcastTransaction as infraBroadcast } from '../../infrastructure/api/broadcastService'

/**
 * Broadcast a signed transaction - try multiple endpoints for non-standard scripts.
 * Accepts either a Transaction object or a raw hex string.
 * Delegates to the infrastructure broadcastService for the actual cascade.
 */
export async function broadcastTransaction(txOrHex: Transaction | string): Promise<string> {
  const txhex = typeof txOrHex === 'string' ? txOrHex : txOrHex.toHex()
  const localTxid = typeof txOrHex === 'string' ? undefined : txOrHex.id('hex')
  return infraBroadcast(txhex, localTxid)
}

/**
 * Validate a send request — shared by sendBSV and sendBSVMultiKey
 */
function validateSendRequest(toAddress: string, satoshis: number): void {
  if (!Number.isFinite(satoshis) || satoshis <= 0) {
    throw new Error('Invalid amount')
  }
  if (!isValidBSVAddress(toAddress)) {
    throw new Error('Invalid BSV address')
  }
}

/**
 * Shared broadcast flow: mark pending → broadcast → rollback on failure.
 * Accepts either a Transaction object or a raw hex string.
 */
async function executeBroadcast(
  txOrHex: Transaction | string,
  pendingTxid: string,
  spentOutpoints: { txid: string; vout: number }[]
): Promise<string> {
  // CRITICAL: Mark UTXOs as pending BEFORE broadcast to prevent race conditions
  try {
    await markUtxosPendingSpend(spentOutpoints, pendingTxid)
    walletLogger.debug('Marked UTXOs as pending spend', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  try {
    return await broadcastTransaction(txOrHex)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(spentOutpoints)
      walletLogger.debug('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }
}

/**
 * Shared post-broadcast flow: record tx → confirm spent → track change UTXO
 */
async function recordTransactionResult(
  rawTx: string,
  numOutputs: number,
  txid: string,
  _pendingTxid: string,
  description: string,
  labels: string[],
  amount: number,
  change: number,
  changeAddress: string,
  spentOutpoints: { txid: string; vout: number }[],
  accountId?: number
): Promise<void> {
  // CRITICAL: recordSentTransaction + confirmUtxosSpent + change UTXO must be atomic
  try {
    await withTransaction(async () => {
      await recordSentTransaction(txid, rawTx, description, labels, amount, accountId)
      await confirmUtxosSpent(spentOutpoints, txid)
      // Track change UTXO atomically so balance stays correct until next sync
      // Use final txid (from broadcaster), NOT pendingTxid — broadcaster may return different txid
      if (change > 0) {
        try {
          await addUTXO({
            txid,
            vout: numOutputs - 1,
            satoshis: change,
            lockingScript: p2pkhLockingScriptHex(changeAddress),
            address: changeAddress,
            basket: 'default',
            spendable: true,
            createdAt: Date.now()
          }, accountId)
          walletLogger.debug('Change UTXO tracked', { txid, change })
        } catch (error) {
          const msg = String(error)
          if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
            // Duplicate key is expected if UTXO was already synced — non-fatal
            walletLogger.debug('Change UTXO already exists (duplicate key)', { txid, change })
          } else {
            // Unexpected DB error — re-throw so the outer withTransaction() can handle it
            throw error
          }
        }
      }
    })
    walletLogger.info('Transaction tracked locally', { txid, change })
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to confirm transaction locally', error, { txid })
    throw new Error(`Transaction broadcast succeeded (txid: ${txid}) but failed to record locally. The transaction is on-chain but your wallet may show incorrect balance until next sync.`)
  }
}

/**
 * Build and sign a simple P2PKH transaction, then broadcast and record it
 */
export async function sendBSV(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[],
  accountId?: number
): Promise<string> {
  validateSendRequest(toAddress, satoshis)

  // Acquire sync lock to prevent concurrent sync from modifying UTXOs during send
  const releaseLock = await acquireSyncLock()
  try {
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoins(utxos, satoshis)
    if (!sufficient) {
      throw new Error('Insufficient funds')
    }

    const feeRate = getFeeRate()
    const built = await buildP2PKHTx({ wif, toAddress, satoshis, selectedUtxos: inputsToUse, totalInput, feeRate })
    const { rawTx, txid: pendingTxid, fee, change, changeAddress, numOutputs, spentOutpoints } = built

    resetInactivityTimer()
    const txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    await recordTransactionResult(rawTx, numOutputs, txid, pendingTxid, `Sent ${satoshis} sats to ${toAddress}`, ['send'], -(satoshis + fee), change, changeAddress, spentOutpoints, accountId)
    resetInactivityTimer()
    return txid
  } finally {
    releaseLock()
  }
}

/**
 * Get all spendable UTXOs from both default and derived baskets
 * Returns UTXOs with their associated WIFs for signing
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
    // Find the derived address entry that matches this UTXO's locking script
    const derivedAddr = derivedAddresses.find(d => {
      return p2pkhLockingScriptHex(d.address) === u.lockingScript
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

  // Sort by satoshis (smallest first for efficient coin selection)
  return result.sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Send BSV using UTXOs from multiple addresses/keys, then broadcast and record
 * Supports spending from both default wallet and derived addresses
 */
export async function sendBSVMultiKey(
  changeWif: string,
  toAddress: string,
  satoshis: number,
  utxos: ExtendedUTXO[],
  accountId?: number
): Promise<string> {
  validateSendRequest(toAddress, satoshis)

  // Acquire sync lock to prevent concurrent sync from modifying UTXOs during send
  const releaseLock = await acquireSyncLock()
  try {
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoinsMultiKey(utxos, satoshis)
    if (!sufficient) {
      throw new Error('Insufficient funds')
    }

    const feeRate = getFeeRate()
    const built = await buildMultiKeyP2PKHTx({ changeWif, toAddress, satoshis, selectedUtxos: inputsToUse, totalInput, feeRate })
    const { rawTx, txid: pendingTxid, fee, change, changeAddress, numOutputs, spentOutpoints } = built

    resetInactivityTimer()
    const txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    await recordTransactionResult(rawTx, numOutputs, txid, pendingTxid, `Sent ${satoshis} sats to ${toAddress}`, ['send'], -(satoshis + fee), change, changeAddress, spentOutpoints, accountId)
    resetInactivityTimer()
    return txid
  } finally {
    releaseLock()
  }
}

/**
 * Consolidate multiple UTXOs into a single UTXO, then broadcast and record
 * Combines all selected UTXOs minus fees into one output back to the wallet address
 */
export async function consolidateUtxos(
  wif: string,
  utxoIds: Array<{ txid: string; vout: number; satoshis: number; script: string }>
): Promise<{ txid: string; outputSats: number; fee: number }> {
  // Acquire sync lock to prevent concurrent sync from modifying UTXOs during consolidation
  const releaseLock = await acquireSyncLock()
  try {
  const feeRate = getFeeRate()
  const built = await buildConsolidationTx({ wif, utxos: utxoIds, feeRate })
  const { rawTx, txid: pendingTxid, fee, outputSats, address, spentOutpoints } = built
  const totalInput = utxoIds.reduce((sum, u) => sum + u.satoshis, 0)

  resetInactivityTimer()
  const txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)

  // Record — consolidation uses vout 0 (single output), not last output
  try {
    await withTransaction(async () => {
      await recordSentTransaction(txid, rawTx, `Consolidated ${utxoIds.length} UTXOs (${totalInput} sats → ${outputSats} sats)`, ['consolidate'])
      await confirmUtxosSpent(spentOutpoints, txid)
      // Track consolidated UTXO atomically — use final txid from broadcaster
      try {
        await addUTXO({ txid, vout: 0, satoshis: outputSats, lockingScript: p2pkhLockingScriptHex(address), address, basket: 'default', spendable: true, createdAt: Date.now() })
        walletLogger.debug('Consolidated UTXO tracked', { txid, outputSats })
      } catch (error) {
        const msg = String(error)
        if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
          walletLogger.debug('Consolidated UTXO already exists (duplicate key)', { txid, outputSats })
        } else {
          throw error
        }
      }
    })
    walletLogger.info('Consolidation confirmed locally', { txid, inputCount: utxoIds.length, outputSats })
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to record consolidation locally', error, { txid })
    throw new Error(`Consolidation broadcast succeeded (txid: ${txid}) but failed to record locally. The transaction is on-chain but your wallet may show incorrect balance until next sync.`)
  }

  return { txid, outputSats, fee }
  } finally {
    releaseLock()
  }
}
