/**
 * Lock Creation — lock creation and OP_PUSH_TX construction
 *
 * Handles creating time-locked UTXOs using the OP_PUSH_TX technique.
 * Based on jdh7190's bsv-lock implementation.
 *
 * Transaction building is delegated to the Rust backend via Tauri commands.
 * Private keys never enter the JavaScript heap.
 */

import type { UTXO, LockedUTXO } from './types'
import { getWifForOperation } from './types'
import { calculateLockFee } from './fees'
import { executeBroadcast } from './transactions'
import {
  recordSentTransaction,
  confirmUtxosSpent
} from '../sync'
import { addUTXO, addLock, withTransaction } from '../database'
import { walletLogger } from '../logger'
import { AppError, ErrorCodes, InsufficientFundsError } from '../errors'
import type { Result } from '../../domain/types'
import { ok, err } from '../../domain/types'
import {
  createWrootzOpReturn as createWrootzOpReturnHex,
  convertToLockingScript
} from '../brc100/script'
import type { ScriptLike } from '../brc100/script'
import { isTauri, tauriInvoke } from '../../utils/tauri'
import { p2pkhLockingScriptHex } from '../../domain/transaction/builder'

// Re-export pure domain functions for backwards compatibility
import {
  createTimelockScript,
  parseTimelockScript as domainParseTimelockScript,
  hex2Int,
  getTimelockScriptSize
} from '../../domain/locks'
export type { ParsedTimelockScript } from '../../domain/locks'
export { hex2Int, getTimelockScriptSize }

// Wrap domain parseTimelockScript for the service layer
export function parseTimelockScript(scriptHex: string): { unlockBlock: number; publicKeyHash: string } | null {
  return domainParseTimelockScript(scriptHex)
}

/**
 * Create a Wrootz protocol OP_RETURN script as a ScriptLike.
 * Delegates to brc100/script for the hex encoding, then converts.
 */
function createWrootzOpReturn(action: string, data: string): ScriptLike {
  return convertToLockingScript(createWrootzOpReturnHex(action, data))
}

/**
 * Lock BSV until a specific block height using OP_PUSH_TX technique
 * Based on jdh7190's bsv-lock implementation
 *
 * Transaction building is delegated to Rust via Tauri commands.
 * This function requires the Tauri desktop runtime.
 *
 * @param ordinalOrigin - Optional ordinal origin to link this lock to (for Wrootz)
 */
export async function lockBSV(
  satoshis: number,
  unlockBlock: number,
  utxos: UTXO[],
  ordinalOrigin?: string,
  lockBlock?: number,
  accountId?: number,
  basket?: string
): Promise<Result<{ txid: string; lockedUtxo: LockedUTXO; warning?: string }, AppError>> {
  if (!Number.isFinite(satoshis) || satoshis <= 0 || !Number.isInteger(satoshis)) {
    return err(new AppError(
      `Invalid lock amount: ${satoshis} (must be a positive integer)`,
      ErrorCodes.INVALID_AMOUNT,
      { satoshis }
    ))
  }

  if (!Number.isFinite(unlockBlock) || unlockBlock <= 0 || !Number.isInteger(unlockBlock)) {
    return err(new AppError(
      `Invalid unlock block: ${unlockBlock} (must be a positive integer)`,
      ErrorCodes.INVALID_PARAMS,
      { unlockBlock }
    ))
  }

  // B-59: accountId is required for DB recording (same guard as sendBSV)
  if (accountId === undefined) {
    return err(new AppError(
      'accountId is required to lock BSV',
      ErrorCodes.INVALID_STATE,
      {}
    ))
  }

  // S-41: Soft dust-limit check — BSV has no protocol dust limit, but locking
  // very small amounts (< 135 sats) is wasteful because the unlock transaction
  // fee will likely exceed the locked amount.
  let dustWarning: string | undefined
  if (satoshis < 135) {
    dustWarning = `Locking ${satoshis} sats may be uneconomical: the unlock fee (~135+ sats) will likely exceed the locked amount.`
    walletLogger.warn(dustWarning, { satoshis })
  }

  if (!isTauri()) {
    throw new Error('Lock transaction building requires Tauri runtime')
  }

  // Derive keys via Tauri (WIF never persisted in JS state)
  const wif = await getWifForOperation('wallet', 'lockBSV')

  // Derive address and public key from WIF via Rust
  const keyInfo = await tauriInvoke<{ wif: string; address: string; pubKey: string }>('keys_from_wif', { wif })
  const fromAddress = keyInfo.address
  const publicKeyHex = keyInfo.pubKey

  // Get public key hash via Rust
  const publicKeyHashHex = await tauriInvoke<string>('pubkey_to_hash160', { pubKeyHex: publicKeyHex })

  // Create the OP_PUSH_TX timelock locking script (pure JS — no SDK dependency)
  const timelockScript = createTimelockScript(publicKeyHashHex, unlockBlock)

  // Generate locking script hex for the source address (pure JS)
  const sourceLockingScriptHex = p2pkhLockingScriptHex(fromAddress)

  // Select UTXOs
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 500) break // timelock script is larger, need more for fees
  }

  if (totalInput < satoshis) {
    return err(new InsufficientFundsError(satoshis, totalInput))
  }

  // Calculate fee using actual script size
  const numInputs = inputsToUse.length
  const timelockScriptSize = timelockScript.toBinary().length

  // Account for OP_RETURN output if ordinal origin is provided
  // OP_RETURN output: 8 (value) + 1 (scriptlen varint) + script bytes
  let opReturnExtraBytes = 0
  if (ordinalOrigin) {
    const opReturnScript = createWrootzOpReturn('lock', ordinalOrigin)
    const opReturnScriptSize = opReturnScript.toBinary().length
    opReturnExtraBytes = 8 + 1 + opReturnScriptSize // value + varint + script
  }

  const fee = calculateLockFee(numInputs, timelockScriptSize, opReturnExtraBytes)
  const change = totalInput - satoshis - fee

  if (change < 0) {
    return err(new InsufficientFundsError(satoshis + fee, totalInput))
  }

  // Build and sign the lock transaction entirely in Rust.
  // The Rust command handles: input construction, custom timelock output,
  // optional OP_RETURN output, change output, and signing.
  const buildResult = await tauriInvoke<{
    rawTx: string
    txid: string
  }>('build_lock_tx_from_store', {
    selectedUtxos: inputsToUse.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? sourceLockingScriptHex
    })),
    lockSatoshis: satoshis,
    timelockScriptHex: timelockScript.toHex(),
    changeAddress: fromAddress,
    changeSatoshis: change,
    opReturnHex: ordinalOrigin ? createWrootzOpReturnHex('lock', ordinalOrigin) : undefined
  })

  const rawTx = buildResult.rawTx
  const pendingTxid = buildResult.txid

  // Get the UTXOs we're about to spend
  const utxosToSpend = inputsToUse.map(u => ({ txid: u.txid, vout: u.vout }))

  // Mark pending -> broadcast -> rollback on failure (shared pattern)
  let txid: string
  try {
    txid = await executeBroadcast(rawTx, pendingTxid, utxosToSpend)
  } catch (broadcastError) {
    return err(new AppError(
      broadcastError instanceof Error ? broadcastError.message : 'Broadcast failed',
      ErrorCodes.BROADCAST_FAILED
    ))
  }

  const lockedUtxo: LockedUTXO = {
    txid,
    vout: 0,
    satoshis,
    lockingScript: timelockScript.toHex(),
    unlockBlock,
    publicKeyHex,
    createdAt: Date.now(),
    lockBlock
  }

  // CRITICAL: All post-broadcast DB writes must be atomic to prevent state divergence
  // (matches the withTransaction() pattern in transactions.ts:recordTransactionResult)
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        rawTx,
        `Locked ${satoshis} sats until block ${unlockBlock}`,
        ['lock'],
        -(satoshis + fee),  // Negative: locked amount + mining fee
        accountId
      )
      await confirmUtxosSpent(utxosToSpend, txid)

      // Track change UTXO so balance stays correct until next sync
      if (change > 0) {
        // Determine change output index: after lock output (0), optional OP_RETURN (1), then change
        const changeVout = ordinalOrigin ? 2 : 1
        try {
          await addUTXO({
            txid,
            vout: changeVout,
            satoshis: change,
            lockingScript: sourceLockingScriptHex,
            address: fromAddress,
            basket: 'default',
            spendable: true,
            createdAt: Date.now()
          }, accountId)
          walletLogger.debug('Lock change UTXO tracked', { txid, change })
        } catch (error) {
          const msg = String(error)
          if (msg.includes('UNIQUE') || msg.includes('duplicate')) {
            walletLogger.debug('Lock change UTXO already exists (duplicate key)', { txid, change })
          } else {
            throw error
          }
        }
      }

      // Add lock UTXO and lock record
      const addUtxoResult = await addUTXO({
        txid,
        vout: 0,
        satoshis,
        lockingScript: timelockScript.toHex(),
        basket: basket || 'locks',
        spendable: false,
        createdAt: Date.now()
      }, accountId)
      if (!addUtxoResult.ok) {
        throw new AppError(`Failed to record lock UTXO: ${addUtxoResult.error.message}`, ErrorCodes.DATABASE_ERROR)
      }
      const utxoId = addUtxoResult.value

      await addLock({
        utxoId,
        unlockBlock,
        lockBlock,
        ordinalOrigin: ordinalOrigin ?? undefined,
        createdAt: Date.now()
      }, accountId)
      walletLogger.info('Lock transaction tracked atomically', { txid, vout: 0, unlockBlock })
    })
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to record lock transaction locally', error, { txid })
    // Broadcast succeeded — return ok so the modal closes cleanly. Background sync
    // in LockModal will reconcile the local DB from the blockchain.
    return ok({
      txid,
      lockedUtxo,
      ...(dustWarning ? { warning: dustWarning } : {})
    })
  }

  return ok({ txid, lockedUtxo, ...(dustWarning ? { warning: dustWarning } : {}) })
}
