/**
 * Transaction building and broadcasting
 * Handles sendBSV, sendBSVMultiKey, and broadcastTransaction
 *
 * Pure TX construction is delegated to domain/transaction/builder.
 * This module handles orchestration: validation, UTXO locking, broadcasting, and DB recording.
 */

import { PrivateKey, PublicKey, Transaction } from '@bsv/sdk'
import type { UTXO, ExtendedUTXO } from './types'
import { getFeeRate } from './fees'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { selectCoins, selectCoinsMultiKey } from '../../domain/transaction/coinSelection'
import {
  buildP2PKHTx,
  buildMultiKeyP2PKHTx,
  buildConsolidationTx,
  buildMultiOutputP2PKHTx,
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
import { deriveChildPrivateKey } from '../keyDerivation'
import { walletLogger } from '../logger'
import { resetInactivityTimer } from '../autoLock'
import { acquireSyncLock } from '../cancellation'
import { broadcastTransaction as infraBroadcast } from '../../infrastructure/api/broadcastService'
import {
  AppError,
  ErrorCodes,
  InsufficientFundsError,
  InvalidAddressError,
  InvalidAmountError
} from '../errors'
import type { RecipientOutput } from '../../domain/transaction/builder'
import { type Result, ok, err } from '../../domain/types'

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
/** Maximum satoshis (21M BSV) — prevents accidental astronomical sends */
const MAX_SATOSHIS = 21_000_000_00_000_000

function validateSendRequest(toAddress: string, satoshis: number): Result<void, AppError> {
  if (!Number.isFinite(satoshis) || satoshis <= 0) {
    return err(new InvalidAmountError(satoshis, 'Invalid amount'))
  }
  if (!Number.isInteger(satoshis)) {
    return err(new InvalidAmountError(satoshis, 'Amount must be a whole number of satoshis'))
  }
  if (satoshis > MAX_SATOSHIS) {
    return err(new InvalidAmountError(satoshis, 'Amount exceeds maximum BSV supply'))
  }
  if (!isValidBSVAddress(toAddress)) {
    return err(new InvalidAddressError(toAddress))
  }
  return ok(undefined)
}

/**
 * Shared broadcast flow: mark pending → broadcast → rollback on failure.
 * Accepts either a Transaction object or a raw hex string.
 */
export async function executeBroadcast(
  txOrHex: Transaction | string,
  pendingTxid: string,
  spentOutpoints: { txid: string; vout: number }[]
): Promise<string> {
  // CRITICAL: Mark UTXOs as pending BEFORE broadcast to prevent race conditions
  const pendingResult = await markUtxosPendingSpend(spentOutpoints, pendingTxid)
  if (!pendingResult.ok) {
    walletLogger.error('Failed to mark UTXOs as pending', pendingResult.error)
    throw new AppError(
      'Failed to prepare transaction - UTXOs could not be locked',
      ErrorCodes.DATABASE_ERROR,
      { pendingTxid, originalError: pendingResult.error.message }
    )
  }
  walletLogger.debug('Marked UTXOs as pending spend', { txid: pendingTxid })

  // Now broadcast the transaction
  try {
    const txHex = typeof txOrHex === 'string' ? txOrHex : txOrHex.toHex()
    const txid = await infraBroadcast(txHex, pendingTxid)
    if (!txid) {
      throw new Error('Broadcast returned empty transaction ID')
    }
    // Validate txid format: must be 64-character hex string
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
      throw new Error(`Broadcast returned invalid transaction ID: ${txid.substring(0, 100)}`)
    }
    return txid
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    const rollbackResult = await rollbackPendingSpend(spentOutpoints)
    if (!rollbackResult.ok) {
      // Both broadcast AND rollback failed — UTXOs are stuck in pending state until next sync.
      // Broadcast never succeeded, so UTXO_STUCK_IN_PENDING accurately describes the state
      // (contrast with BROADCAST_SUCCEEDED_DB_FAILED which implies the tx IS on-chain).
      walletLogger.error('CRITICAL: Failed to rollback pending status — UTXOs stuck in pending state', rollbackResult.error, {
        txid: pendingTxid,
        outpointCount: spentOutpoints.length
      })
      throw new AppError(
        'Transaction failed and wallet state could not be fully restored. Your balance may appear incorrect until the next sync.',
        ErrorCodes.UTXO_STUCK_IN_PENDING,
        {
          broadcastError: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
          rollbackError: rollbackResult.error.message,
          pendingTxid,
          outpointCount: spentOutpoints.length
        }
      )
    }
    walletLogger.debug('Rolled back pending status for UTXOs')
    throw AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED)
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
      const confirmResult = await confirmUtxosSpent(spentOutpoints, txid)
      if (!confirmResult.ok) {
        throw new AppError(
          `Failed to confirm UTXOs spent: ${confirmResult.error.message}`,
          ErrorCodes.DATABASE_ERROR,
          { txid, originalError: confirmResult.error.message }
        )
      }
      // Track change UTXO atomically so balance stays correct until next sync
      // Use final txid (from broadcaster), NOT pendingTxid — broadcaster may return different txid
      if (change > 0) {
        const addChangeResult = await addUTXO({
          txid,
          vout: numOutputs - 1,
          satoshis: change,
          lockingScript: p2pkhLockingScriptHex(changeAddress),
          address: changeAddress,
          basket: 'default',
          spendable: true,
          createdAt: Date.now()
        }, accountId)
        if (!addChangeResult.ok) {
          const msg = addChangeResult.error.message
          if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
            // Duplicate key is expected if UTXO was already synced — non-fatal
            walletLogger.debug('Change UTXO already exists (duplicate key)', { txid, change })
          } else {
            // Unexpected DB error — re-throw so the outer withTransaction() can handle it
            throw addChangeResult.error
          }
        } else {
          walletLogger.debug('Change UTXO tracked', { txid, change })
        }
      }
    })
    walletLogger.info('Transaction tracked locally', { txid, change })
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to confirm transaction locally', error, { txid })
    throw new AppError(
      `Transaction broadcast succeeded (txid: ${txid}) but failed to record locally. The transaction is on-chain but your wallet may show incorrect balance until next sync.`,
      ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED,
      { txid, originalError: error instanceof Error ? error.message : String(error) }
    )
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
): Promise<Result<{ txid: string }, AppError>> {
  const validation = validateSendRequest(toAddress, satoshis)
  if (!validation.ok) return validation

  // accountId is required to acquire the correct per-account sync lock.
  // Defaulting to account 1 when accountId is undefined would silently lock
  // the wrong account during a send, allowing a concurrent sync to corrupt state.
  if (accountId === undefined) {
    return err(new AppError('accountId is required to send BSV', ErrorCodes.INVALID_STATE, { toAddress, satoshis }))
  }

  // Reset inactivity timer BEFORE any async I/O so auto-lock cannot fire during broadcast.
  // If auto-lock clears the Rust key store mid-send, account switching immediately after
  // will fail even though the send succeeded.
  resetInactivityTimer()

  // Acquire sync lock to prevent concurrent sync from modifying UTXOs during send
  const releaseLock = await acquireSyncLock(accountId)
  try {
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoins(utxos, satoshis)
    if (!sufficient) {
      return err(new InsufficientFundsError(satoshis, totalInput))
    }

    const feeRate = getFeeRate()
    let built
    try {
      built = await buildP2PKHTx({ wif, toAddress, satoshis, selectedUtxos: inputsToUse, totalInput, feeRate })
    } catch (buildError) {
      return err(AppError.fromUnknown(buildError, ErrorCodes.INTERNAL_ERROR))
    }
    const { rawTx, txid: pendingTxid, fee, change, changeAddress, numOutputs, spentOutpoints } = built

    resetInactivityTimer()
    let txid: string
    try {
      txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    } catch (broadcastError) {
      return err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))
    }
    try {
      await recordTransactionResult(rawTx, numOutputs, txid, pendingTxid, `Sent ${satoshis} sats to ${toAddress}`, ['send'], -(satoshis + fee), change, changeAddress, spentOutpoints, accountId)
    } catch (recordError) {
      return err(AppError.fromUnknown(recordError, ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED))
    }
    resetInactivityTimer()
    return ok({ txid })
  } finally {
    releaseLock()
  }
}

/**
 * Get all spendable UTXOs from both default and derived baskets
 * Returns UTXOs with their associated WIFs for signing
 *
 * @param walletWif - WIF of the main wallet key (for default basket UTXOs)
 * @param accountId - Account ID to scope derived address lookup
 * @param identityWif - WIF of the identity key, used to re-derive child keys
 *   for derived-address UTXOs (S-19: WIFs are no longer stored in the DB).
 *   When omitted, falls back to legacy stored WIF for backward compatibility.
 */
export async function getAllSpendableUTXOs(walletWif: string, accountId?: number, identityWif?: string): Promise<ExtendedUTXO[]> {
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

  // Get UTXOs from derived basket with their WIFs — scoped to current account
  const derivedUtxos = await getSpendableUtxosFromDatabase(BASKETS.DERIVED)
  const derivedAddresses = await getDerivedAddresses(accountId)

  // Build a map of derived address → WIF using re-derivation (S-19)
  const derivedWifMap = new Map<string, string>()
  for (const d of derivedAddresses) {
    if (identityWif && d.senderPubkey && d.invoiceNumber) {
      // Re-derive the child private key from (identityKey + senderPubkey + invoiceNumber)
      // so we never rely on the WIF stored in the database
      try {
        const childKey = deriveChildPrivateKey(
          PrivateKey.fromWif(identityWif),
          PublicKey.fromString(d.senderPubkey),
          d.invoiceNumber
        )
        derivedWifMap.set(d.address, childKey.toWif())
      } catch (e) {
        walletLogger.warn('getAllSpendableUTXOs: failed to re-derive child key', {
          address: d.address,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    } else if (d.privateKeyWif) {
      // Legacy: support old records that still have WIF stored
      derivedWifMap.set(d.address, d.privateKeyWif)
    }
  }

  for (const u of derivedUtxos) {
    // Find the derived address entry that matches this UTXO's locking script
    const derivedAddr = derivedAddresses.find(d => {
      return p2pkhLockingScriptHex(d.address) === u.lockingScript
    })

    if (derivedAddr) {
      const wif = derivedWifMap.get(derivedAddr.address)
      if (!wif) {
        // Cannot determine WIF — skip this UTXO rather than error with a bad key
        walletLogger.warn('getAllSpendableUTXOs: no WIF available for derived address, skipping UTXO', {
          address: derivedAddr.address,
          txid: u.txid,
          vout: u.vout
        })
        continue
      }
      result.push({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript,
        wif,
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
): Promise<Result<{ txid: string }, AppError>> {
  const validation = validateSendRequest(toAddress, satoshis)
  if (!validation.ok) return validation

  // accountId is required to acquire the correct per-account sync lock.
  // See sendBSV for rationale.
  if (accountId === undefined) {
    return err(new AppError('accountId is required to send BSV (multi-key)', ErrorCodes.INVALID_STATE, { toAddress, satoshis }))
  }

  // Reset inactivity timer BEFORE any async I/O so auto-lock cannot fire during broadcast.
  resetInactivityTimer()

  // Acquire per-account sync lock to prevent concurrent sync from modifying UTXO state.
  // This prevents the race condition where performSync() could revert pending-spend flags
  // set by executeBroadcast() before the broadcast completes (BUG-4).
  const releaseLock = await acquireSyncLock(accountId)
  try {
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoinsMultiKey(utxos, satoshis)
    if (!sufficient) {
      return err(new InsufficientFundsError(satoshis, totalInput))
    }

    const feeRate = getFeeRate()
    let built
    try {
      built = await buildMultiKeyP2PKHTx({ changeWif, toAddress, satoshis, selectedUtxos: inputsToUse, totalInput, feeRate })
    } catch (buildError) {
      return err(AppError.fromUnknown(buildError, ErrorCodes.INTERNAL_ERROR))
    }
    const { rawTx, txid: pendingTxid, fee, change, changeAddress, numOutputs, spentOutpoints } = built

    resetInactivityTimer()
    let txid: string
    try {
      txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    } catch (broadcastError) {
      return err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))
    }
    try {
      await recordTransactionResult(rawTx, numOutputs, txid, pendingTxid, `Sent ${satoshis} sats to ${toAddress}`, ['send'], -(satoshis + fee), change, changeAddress, spentOutpoints, accountId)
    } catch (recordError) {
      return err(AppError.fromUnknown(recordError, ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED))
    }
    resetInactivityTimer()
    return ok({ txid })
  } finally {
    releaseLock()
  }
}

/**
 * Consolidate multiple UTXOs into a single UTXO, then broadcast and record.
 * Combines all selected UTXOs minus fees into one output back to the wallet address.
 *
 * In Tauri (desktop), the transaction is built and signed entirely in Rust
 * via the key store — no WIF is needed from the JS side (S-21 migration).
 * In browser dev mode, the builder falls back to JS signing with a dummy WIF
 * which will fail — consolidation is only supported in the desktop app.
 */
export async function consolidateUtxos(
  utxoIds: Array<{ txid: string; vout: number; satoshis: number; script: string }>,
  accountId?: number
): Promise<Result<{ txid: string; outputSats: number; fee: number }, AppError>> {
  // accountId is required to acquire the correct per-account sync lock.
  // See sendBSV for rationale.
  if (accountId === undefined) {
    return err(new AppError('accountId is required to consolidate UTXOs', ErrorCodes.INVALID_STATE, {}))
  }

  // Acquire sync lock to prevent concurrent sync from modifying UTXOs during consolidation
  const releaseLock = await acquireSyncLock(accountId)
  try {
    const feeRate = getFeeRate()
    // WIF is unused in Tauri mode — the Rust key store provides the signing key.
    // Pass empty string for the JS fallback (browser dev only — consolidation
    // requires the desktop app for security).
    const built = await buildConsolidationTx({ wif: '', utxos: utxoIds, feeRate })
    const { rawTx, txid: pendingTxid, fee, outputSats, address, spentOutpoints } = built
    const totalInput = utxoIds.reduce((sum, u) => sum + u.satoshis, 0)

    resetInactivityTimer()
    let txid: string
    try {
      txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    } catch (broadcastError) {
      return err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))
    }

    // Record — consolidation uses vout 0 (single output), not last output
    try {
      await withTransaction(async () => {
        await recordSentTransaction(txid, rawTx, `Consolidated ${utxoIds.length} UTXOs (${totalInput} sats → ${outputSats} sats)`, ['consolidate'])
        const consolidateConfirmResult = await confirmUtxosSpent(spentOutpoints, txid)
        if (!consolidateConfirmResult.ok) {
          throw new AppError(
            `Failed to confirm UTXOs spent during consolidation: ${consolidateConfirmResult.error.message}`,
            ErrorCodes.DATABASE_ERROR,
            { txid, originalError: consolidateConfirmResult.error.message }
          )
        }
        // Track consolidated UTXO atomically — use final txid from broadcaster
        const addConsolidateResult = await addUTXO({ txid, vout: 0, satoshis: outputSats, lockingScript: p2pkhLockingScriptHex(address), address, basket: 'default', spendable: true, createdAt: Date.now() })
        if (!addConsolidateResult.ok) {
          const msg = addConsolidateResult.error.message
          if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
            walletLogger.debug('Consolidated UTXO already exists (duplicate key)', { txid, outputSats })
          } else {
            throw addConsolidateResult.error
          }
        } else {
          walletLogger.debug('Consolidated UTXO tracked', { txid, outputSats })
        }
      })
      walletLogger.info('Consolidation confirmed locally', { txid, inputCount: utxoIds.length, outputSats })
    } catch (error) {
      walletLogger.error('CRITICAL: Failed to record consolidation locally', error, { txid })
      return err(new AppError(
        `Consolidation broadcast succeeded (txid: ${txid}) but failed to record locally. The transaction is on-chain but your wallet may show incorrect balance until next sync.`,
        ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED,
        { txid, originalError: error instanceof Error ? error.message : String(error) }
      ))
    }

    return ok({ txid, outputSats, fee })
  } finally {
    releaseLock()
  }
}

/**
 * Send BSV to multiple recipients in a single transaction.
 *
 * Uses selectCoinsMultiKey for coin selection, buildMultiOutputP2PKHTx for
 * transaction construction, then broadcasts and records the result.
 *
 * @param changeWif - WIF for the change output address
 * @param outputs - Array of recipient addresses and satoshi amounts
 * @param utxos - Available spendable UTXOs (with per-UTXO signing keys)
 * @param accountId - Account ID for sync lock and DB recording
 * @returns Result with txid on success, AppError on failure
 */
export async function sendBSVMultiOutput(
  changeWif: string,
  outputs: RecipientOutput[],
  utxos: ExtendedUTXO[],
  accountId?: number
): Promise<Result<{ txid: string }, AppError>> {
  if (outputs.length === 0) {
    return err(new AppError('Must specify at least one recipient output', ErrorCodes.INVALID_STATE, { outputs }))
  }

  for (const output of outputs) {
    const validation = validateSendRequest(output.address, output.satoshis)
    if (!validation.ok) return validation
  }

  const totalSent = outputs.reduce((sum, o) => sum + o.satoshis, 0)

  if (accountId === undefined) {
    return err(new AppError('accountId is required to send BSV (multi-output)', ErrorCodes.INVALID_STATE, { outputs }))
  }

  // Reset inactivity timer BEFORE any async I/O so auto-lock cannot fire during broadcast.
  resetInactivityTimer()

  const releaseLock = await acquireSyncLock(accountId)
  try {
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoinsMultiKey(utxos, totalSent)
    if (!sufficient) {
      return err(new InsufficientFundsError(totalSent, totalInput))
    }

    const feeRate = getFeeRate()
    let built
    try {
      built = await buildMultiOutputP2PKHTx({ wif: changeWif, outputs, selectedUtxos: inputsToUse, totalInput, feeRate })
    } catch (buildError) {
      return err(AppError.fromUnknown(buildError, ErrorCodes.INTERNAL_ERROR))
    }
    const { rawTx, txid: pendingTxid, fee, change, changeAddress, numOutputs, spentOutpoints } = built

    resetInactivityTimer()
    let txid: string
    try {
      txid = await executeBroadcast(rawTx, pendingTxid, spentOutpoints)
    } catch (broadcastError) {
      return err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))
    }
    try {
      const description = `Sent ${totalSent} sats to ${outputs.length} recipients`
      await recordTransactionResult(rawTx, numOutputs, txid, pendingTxid, description, ['send'], -(totalSent + fee), change, changeAddress, spentOutpoints, accountId)
    } catch (recordError) {
      return err(AppError.fromUnknown(recordError, ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED))
    }
    resetInactivityTimer()
    return ok({ txid })
  } finally {
    releaseLock()
  }
}
