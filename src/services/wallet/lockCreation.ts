/**
 * Lock Creation — lock creation and OP_PUSH_TX construction
 *
 * Handles creating time-locked UTXOs using the OP_PUSH_TX technique.
 * Based on jdh7190's bsv-lock implementation.
 */

import {
  PrivateKey,
  P2PKH,
  Transaction,
  LockingScript
} from '@bsv/sdk'
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
 * Create a Wrootz protocol OP_RETURN script
 * Format: OP_RETURN OP_FALSE "wrootz" <action> <data>
 */
function createWrootzOpReturn(action: string, data: string): LockingScript {
  // Helper to push data bytes
  const pushData = (bytes: number[]): number[] => {
    const len = bytes.length
    if (len < 0x4c) {
      return [len, ...bytes]
    } else if (len <= 0xff) {
      return [0x4c, len, ...bytes]
    } else if (len <= 0xffff) {
      return [0x4d, len & 0xff, (len >> 8) & 0xff, ...bytes]
    } else {
      return [0x4e, len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff, ...bytes]
    }
  }

  const toBytes = (str: string): number[] => Array.from(new TextEncoder().encode(str))

  const scriptBytes: number[] = [
    0x00, // OP_FALSE
    0x6a, // OP_RETURN
    ...pushData(toBytes('wrootz')),
    ...pushData(toBytes(action)),
    ...pushData(toBytes(data))
  ]

  return LockingScript.fromBinary(scriptBytes)
}

/**
 * Lock BSV until a specific block height using OP_PUSH_TX technique
 * Based on jdh7190's bsv-lock implementation
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

  const wif = await getWifForOperation('wallet', 'lockBSV')
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Get public key hash as hex string for the timelock script
  const publicKeyHashBytes = publicKey.toHash() as number[]
  const publicKeyHashHex = publicKeyHashBytes.map(b => b.toString(16).padStart(2, '0')).join('')

  // Create the OP_PUSH_TX timelock locking script
  const timelockScript = createTimelockScript(publicKeyHashHex, unlockBlock)

  // Generate locking script for the source address (for signing inputs)
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

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

  // Add locked output (output 0)
  const lockScriptBin = timelockScript.toBinary()
  const lockScriptBytes: number[] = []
  for (let i = 0; i < lockScriptBin.length; i++) {
    lockScriptBytes.push(lockScriptBin[i]!)
  }
  tx.addOutput({
    lockingScript: LockingScript.fromBinary(lockScriptBytes),
    satoshis
  })

  // Add OP_RETURN with ordinal reference if provided (output 1)
  if (ordinalOrigin) {
    const opReturnScript = createWrootzOpReturn('lock', ordinalOrigin)
    tx.addOutput({
      lockingScript: opReturnScript,
      satoshis: 0
    })
  }

  // Add change output if there is any change
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

  // Mark pending -> broadcast -> rollback on failure (shared pattern)
  let txid: string
  try {
    txid = await executeBroadcast(tx, pendingTxid, utxosToSpend)
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
    publicKeyHex: publicKey.toString(),
    createdAt: Date.now(),
    lockBlock
  }

  // CRITICAL: All post-broadcast DB writes must be atomic to prevent state divergence
  // (matches the withTransaction() pattern in transactions.ts:recordTransactionResult)
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Locked ${satoshis} sats until block ${unlockBlock}`,
        ['lock'],
        -(satoshis + fee),  // Negative: locked amount + mining fee
        accountId
      )
      await confirmUtxosSpent(utxosToSpend, txid)

      // Track change UTXO so balance stays correct until next sync
      if (change > 0) {
        try {
          await addUTXO({
            txid,
            vout: tx.outputs.length - 1, // Change is always last output
            satoshis: change,
            lockingScript: new P2PKH().lock(fromAddress).toHex(),
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
    })
  }

  return ok({ txid, lockedUtxo })
}
