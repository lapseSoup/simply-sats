/**
 * Lock Unlocking — lock unlocking and spending
 *
 * Handles unlocking time-locked UTXOs using the OP_PUSH_TX technique,
 * generating unlock transaction hex, and block height queries.
 *
 * Transaction building is delegated to the Rust backend via Tauri commands.
 * Private keys never enter the JavaScript heap.
 */

import type { LockedUTXO, PublicWalletKeys } from './types'
import { feeFromBytes } from './fees'
import { broadcastTransaction } from './transactions'
import { getWocClient } from '../../infrastructure/api/wocClient'
import {
  recordSentTransaction
} from '../sync'
import { markLockUnlockedByTxid, getDatabase, withTransaction } from '../database'
import { walletLogger } from '../logger'
import { AppError, ErrorCodes, InsufficientFundsError } from '../errors'
import type { Result } from '../../domain/types'
import { ok, err } from '../../domain/types'
import { isTauri, tauriInvoke } from '../../utils/tauri'

/**
 * Build a signed unlock transaction for a locked UTXO using OP_PUSH_TX.
 *
 * Validates the locking script, calculates fees, derives keys via Tauri,
 * and delegates the entire transaction construction and signing to Rust.
 *
 * Returns the raw transaction hex, txid, and output satoshis.
 */
async function buildUnlockTransaction(
  lockedUtxo: LockedUTXO
): Promise<Result<{ rawTx: string; txid: string; outputSats: number }, AppError>> {
  if (!isTauri()) {
    throw new Error('Unlock transaction building requires Tauri runtime')
  }

  // Validate lockingScript is valid hex before using it for fee calculation
  if (!lockedUtxo.lockingScript || !/^[0-9a-fA-F]*$/.test(lockedUtxo.lockingScript) || lockedUtxo.lockingScript.length % 2 !== 0) {
    return err(new AppError(
      'Invalid locking script: not valid hex',
      ErrorCodes.INVALID_PARAMS,
      { scriptLength: lockedUtxo.lockingScript?.length }
    ))
  }

  let keyInfo: PublicWalletKeys
  try {
    const keys = await tauriInvoke<PublicWalletKeys | null>('get_public_keys')
    if (!keys) {
      return err(new AppError(
        'Wallet is locked — no public keys available',
        ErrorCodes.INVALID_STATE
      ))
    }
    keyInfo = keys
  } catch (keyErr) {
    const msg = typeof keyErr === 'string' ? keyErr : (keyErr instanceof Error ? keyErr.message : String(keyErr))
    walletLogger.error('Failed to retrieve public keys for unlock — wallet may be locked', { error: msg })
    return err(new AppError(
      msg || 'Wallet is locked — please unlock your wallet first',
      ErrorCodes.INVALID_STATE
    ))
  }

  const toAddress = keyInfo.walletAddress

  // Calculate fee for unlock transaction
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2 // hex to bytes
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    return err(new InsufficientFundsError(fee, lockedUtxo.satoshis))
  }

  // Build and sign the unlock transaction entirely in Rust.
  // The Rust command handles: OP_PUSH_TX preimage computation, custom
  // unlocking script (<sig> <pubkey> <preimage>), signing, and serialization.
  const buildResult = await tauriInvoke<{
    rawTx: string
    txid: string
  }>('build_unlock_tx_from_store', {
    lockedTxid: lockedUtxo.txid,
    lockedVout: lockedUtxo.vout,
    lockedSatoshis: lockedUtxo.satoshis,
    lockingScriptHex: lockedUtxo.lockingScript,
    unlockBlock: lockedUtxo.unlockBlock,
    toAddress,
    outputSatoshis: outputSats
  })

  return ok({ rawTx: buildResult.rawTx, txid: buildResult.txid, outputSats })
}

/**
 * Unlock a locked UTXO using OP_PUSH_TX technique
 *
 * The solution script is: <signature> <publicKey> <preimage>
 * The preimage is the BIP-143 sighash preimage that the script validates on-chain
 */
export async function unlockBSV(
  lockedUtxo: LockedUTXO,
  currentBlockHeight: number,
  accountId?: number
): Promise<Result<string, AppError>> {
  // Check block height for user feedback
  if (currentBlockHeight < lockedUtxo.unlockBlock) {
    return err(new AppError(
      `Cannot unlock yet. Current block: ${currentBlockHeight}, Unlock block: ${lockedUtxo.unlockBlock}`,
      ErrorCodes.LOCK_NOT_SPENDABLE,
      { currentBlockHeight, unlockBlock: lockedUtxo.unlockBlock, blocksRemaining: lockedUtxo.unlockBlock - currentBlockHeight }
    ))
  }

  // Check if this UTXO is already being spent in another transaction
  const db = getDatabase()
  const utxoCheck = await db.select<{ spending_status: string | null }[]>(
    'SELECT spending_status FROM utxos WHERE txid = $1 AND vout = $2',
    [lockedUtxo.txid, lockedUtxo.vout]
  )
  if (utxoCheck.length > 0 && utxoCheck[0]!.spending_status === 'pending') {
    return err(new AppError(
      'This lock is already being processed in another transaction',
      ErrorCodes.LOCK_NOT_SPENDABLE,
      { txid: lockedUtxo.txid, vout: lockedUtxo.vout }
    ))
  }

  // Build the signed unlock transaction (delegated to Rust)
  const buildResult = await buildUnlockTransaction(lockedUtxo)
  if (!buildResult.ok) {
    return err(buildResult.error)
  }
  const { rawTx, txid: pendingTxid, outputSats } = buildResult.value

  walletLogger.debug('Unlock transaction ready', { nLockTime: lockedUtxo.unlockBlock })
  walletLogger.debug('Attempting to broadcast unlock transaction')

  let txid: string
  try {
    txid = await broadcastTransaction(rawTx)
  } catch (broadcastError) {
    // Broadcast failed — but the tx may already be in the mempool or confirmed.
    // Check if the lock UTXO is already spent (handles "txn-already-known" residual, retries, race conditions)
    walletLogger.warn('Unlock broadcast failed, checking if UTXO is already spent', { error: String(broadcastError) })
    const woc = getWocClient()
    const spentResult = await woc.isOutputSpentSafe(lockedUtxo.txid, lockedUtxo.vout)

    if (spentResult.ok && spentResult.value !== null) {
      // Lock UTXO IS spent — verify the spending tx is ours before marking
      const spendingTxid = spentResult.value
      if (pendingTxid !== spendingTxid) {
        // S-24: Spending txid doesn't match our unlock tx — someone else spent it
        walletLogger.warn('Lock UTXO spent by unexpected transaction', {
          lockTxid: lockedUtxo.txid,
          vout: lockedUtxo.vout,
          expectedTxid: pendingTxid,
          spendingTxid
        })
      }
      // Mark as unlocked regardless — the UTXO is provably spent
      walletLogger.info('Lock UTXO already spent — marking as unlocked', {
        lockTxid: lockedUtxo.txid,
        vout: lockedUtxo.vout,
        spendingTxid,
        matchesOurTx: pendingTxid === spendingTxid
      })
      try {
        await markLockUnlockedByTxid(lockedUtxo.txid, lockedUtxo.vout, accountId)
      } catch (_markErr) {
        walletLogger.warn('Failed to mark lock as unlocked after spent-check', { error: String(_markErr) })
      }
      return ok(spendingTxid) // Return the spending txid
    }

    // UTXO is genuinely unspent and broadcast failed — real failure
    return err(AppError.fromUnknown(broadcastError, ErrorCodes.BROADCAST_FAILED))
  }

  // Happy path: broadcast succeeded — record and mark atomically
  // Pattern matches lockBSV post-broadcast recording
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        rawTx,
        `Unlocked ${lockedUtxo.satoshis} sats`,
        ['unlock'],
        outputSats,
        accountId
      )
      await markLockUnlockedByTxid(lockedUtxo.txid, lockedUtxo.vout, accountId)
      walletLogger.info('Marked lock as unlocked', { txid: lockedUtxo.txid, vout: lockedUtxo.vout })
    })
  } catch (error) {
    walletLogger.error(
      `Unlock broadcast succeeded (txid: ${txid}) but failed to record locally. The unlock is on-chain but may not appear in your history.`,
      { error: String(error), lockTxid: lockedUtxo.txid }
    )
  }

  return ok(txid)
}

/**
 * Get current block height from WhatsOnChain
 */
export async function getCurrentBlockHeight(): Promise<number> {
  const result = await getWocClient().getBlockHeightSafe()
  if (!result.ok) {
    walletLogger.error('Error fetching block height', result.error)
    throw new Error(result.error.message)
  }
  return result.value
}

/**
 * Generate the raw unlock transaction hex without broadcasting.
 * Uses OP_PUSH_TX technique with preimage in the solution.
 * Transaction building is delegated to Rust via Tauri commands.
 */
export async function generateUnlockTxHex(
  lockedUtxo: LockedUTXO
): Promise<Result<{ txHex: string; txid: string; outputSats: number }, AppError>> {
  const buildResult = await buildUnlockTransaction(lockedUtxo)
  if (!buildResult.ok) {
    return err(buildResult.error)
  }
  const { rawTx, txid, outputSats } = buildResult.value

  return ok({
    txHex: rawTx,
    txid,
    outputSats
  })
}
