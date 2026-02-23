/**
 * Time lock operations (OP_PUSH_TX technique)
 * Based on jdh7190's bsv-lock: https://github.com/jdh7190/bsv-lock
 * Uses sCrypt-compiled script that validates preimage on-chain
 *
 * Pure timelock script logic (building, parsing, hex conversion) lives in
 * the domain layer: src/domain/locks/timelockScript.ts
 * This module re-exports those functions for backwards compatibility and
 * adds I/O-dependent operations (broadcast, database, API calls).
 */

import {
  PrivateKey,
  PublicKey,
  P2PKH,
  Transaction,
  Script,
  LockingScript,
  UnlockingScript,
  TransactionSignature,
  Hash
} from '@bsv/sdk'
import type { UTXO, LockedUTXO } from './types'
import { getWifForOperation } from './types'
import { calculateLockFee, feeFromBytes } from './fees'
import { broadcastTransaction, executeBroadcast } from './transactions'
import { getWocClient } from '../../infrastructure/api/wocClient'
import { btcToSatoshis } from '../../utils/satoshiConversion'
import { getTransactionHistory } from './balance'
import {
  recordSentTransaction,
  confirmUtxosSpent
} from '../sync'
import { markLockUnlockedByTxid, getDatabase, addUTXO, addLock, withTransaction } from '../database'
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

  // Mark pending → broadcast → rollback on failure (shared pattern)
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

  let wif: string
  try {
    wif = await getWifForOperation('wallet', 'unlockBSV')
  } catch (keyErr) {
    const msg = typeof keyErr === 'string' ? keyErr : (keyErr instanceof Error ? keyErr.message : String(keyErr))
    walletLogger.error('Failed to retrieve WIF for unlock — wallet may be locked', { error: msg })
    return err(new AppError(
      msg || 'Wallet is locked — please unlock your wallet first',
      ErrorCodes.INVALID_PARAMS
    ))
  }
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Validate lockingScript is valid hex before using it for fee calculation
  if (!lockedUtxo.lockingScript || !/^[0-9a-fA-F]*$/.test(lockedUtxo.lockingScript) || lockedUtxo.lockingScript.length % 2 !== 0) {
    return err(new AppError(
      'Invalid locking script: not valid hex',
      ErrorCodes.INVALID_PARAMS,
      { scriptLength: lockedUtxo.lockingScript?.length }
    ))
  }

  // Calculate fee for unlock transaction
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2 // hex to bytes
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    return err(new InsufficientFundsError(fee, lockedUtxo.satoshis))
  }

  // Parse the locking script
  const lockingScript = LockingScript.fromHex(lockedUtxo.lockingScript)

  // SIGHASH_ALL | SIGHASH_FORKID for BSV
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const inputSequence = 0xfffffffe // < 0xffffffff to enable nLockTime

  // Build transaction
  const tx = new Transaction()
  tx.version = 1
  tx.lockTime = lockedUtxo.unlockBlock

  // Create custom unlock template that builds the preimage solution
  const customUnlockTemplate = {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      walletLogger.debug('Building OP_PUSH_TX unlock', { inputIndex, nLockTime: tx.lockTime })

      // Build the BIP-143 preimage - this is what the sCrypt script validates
      const preimage = TransactionSignature.format({
        sourceTXID: lockedUtxo.txid,
        sourceOutputIndex: lockedUtxo.vout,
        sourceSatoshis: lockedUtxo.satoshis,
        transactionVersion: tx.version,
        otherInputs: [],
        inputIndex: inputIndex,
        outputs: tx.outputs,
        inputSequence: inputSequence,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: sigHashType
      })

      const preimageBytes = preimage as number[]
      walletLogger.debug('Preimage generated', { length: preimageBytes.length })

      // Sign the preimage hash
      const singleHash = Hash.sha256(preimage) as number[]
      const signature = privateKey.sign(singleHash)

      // Get DER-encoded signature with sighash type
      const sigDER = signature.toDER() as number[]
      const sigWithHashType: number[] = [...sigDER, sigHashType]

      // Get compressed public key
      const pubKeyBytes = publicKey.encode(true) as number[]

      walletLogger.debug('Unlock script components', { sigLen: sigWithHashType.length, pubKeyLen: pubKeyBytes.length })

      // Build unlocking script: <signature> <publicKey> <preimage>
      const unlockScript = new Script()
      unlockScript.writeBin(sigWithHashType)
      unlockScript.writeBin(pubKeyBytes)
      unlockScript.writeBin(preimageBytes)

      const scriptBytes = unlockScript.toBinary() as number[]
      walletLogger.debug('Unlocking script built', { length: scriptBytes.length })

      return UnlockingScript.fromBinary(scriptBytes)
    },
    estimateLength: async (): Promise<number> => 300
  }

  // Add input with our custom unlock template
  tx.addInput({
    sourceTXID: lockedUtxo.txid,
    sourceOutputIndex: lockedUtxo.vout,
    sequence: inputSequence,
    unlockingScriptTemplate: customUnlockTemplate
  })

  // Add output back to our address
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: outputSats
  })

  // Sign the transaction (calls our custom template)
  await tx.sign()

  walletLogger.debug('Unlock transaction ready', { nLockTime: tx.lockTime })
  walletLogger.debug('Attempting to broadcast unlock transaction')

  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed — but the tx may already be in the mempool or confirmed.
    // Check if the lock UTXO is already spent (handles "txn-already-known" residual, retries, race conditions)
    walletLogger.warn('Unlock broadcast failed, checking if UTXO is already spent', { error: String(broadcastError) })
    const woc = getWocClient()
    const spentResult = await woc.isOutputSpentSafe(lockedUtxo.txid, lockedUtxo.vout)

    if (spentResult.ok && spentResult.value !== null) {
      // Lock UTXO IS spent — verify the spending tx is ours before marking
      const expectedTxid = tx.id('hex')
      const spendingTxid = spentResult.value
      if (expectedTxid !== spendingTxid) {
        // S-24: Spending txid doesn't match our unlock tx — someone else spent it
        walletLogger.warn('Lock UTXO spent by unexpected transaction', {
          lockTxid: lockedUtxo.txid,
          vout: lockedUtxo.vout,
          expectedTxid,
          spendingTxid
        })
      }
      // Mark as unlocked regardless — the UTXO is provably spent
      walletLogger.info('Lock UTXO already spent — marking as unlocked', {
        lockTxid: lockedUtxo.txid,
        vout: lockedUtxo.vout,
        spendingTxid,
        matchesOurTx: expectedTxid === spendingTxid
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
        tx.toHex(),
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
 */
export async function generateUnlockTxHex(
  lockedUtxo: LockedUTXO
): Promise<Result<{ txHex: string; txid: string; outputSats: number }, AppError>> {
  const wif = await getWifForOperation('wallet', 'generateUnlockTxHex')
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Validate lockingScript is valid hex
  if (!lockedUtxo.lockingScript || !/^[0-9a-fA-F]*$/.test(lockedUtxo.lockingScript) || lockedUtxo.lockingScript.length % 2 !== 0) {
    return err(new AppError(
      'Invalid locking script: not valid hex',
      ErrorCodes.INVALID_PARAMS,
      { scriptLength: lockedUtxo.lockingScript?.length }
    ))
  }

  // Calculate fee for unlock transaction
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    return err(new AppError(
      `Insufficient funds to cover unlock fee (need ${fee} sats)`,
      ErrorCodes.INSUFFICIENT_FUNDS,
      { fee, available: lockedUtxo.satoshis }
    ))
  }

  // Parse the locking script
  const lockingScript = LockingScript.fromHex(lockedUtxo.lockingScript)

  // SIGHASH_ALL | SIGHASH_FORKID for BSV
  const sigHashType = TransactionSignature.SIGHASH_ALL | TransactionSignature.SIGHASH_FORKID
  const inputSequence = 0xfffffffe

  // Build transaction
  const tx = new Transaction()
  tx.version = 1
  tx.lockTime = lockedUtxo.unlockBlock

  // Create unlock template with preimage
  const customUnlockTemplate = {
    sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
      // Build the BIP-143 preimage
      const preimage = TransactionSignature.format({
        sourceTXID: lockedUtxo.txid,
        sourceOutputIndex: lockedUtxo.vout,
        sourceSatoshis: lockedUtxo.satoshis,
        transactionVersion: tx.version,
        otherInputs: [],
        inputIndex: inputIndex,
        outputs: tx.outputs,
        inputSequence: inputSequence,
        subscript: lockingScript,
        lockTime: tx.lockTime,
        scope: sigHashType
      })

      const preimageBytes = preimage as number[]

      // Sign the preimage hash
      const singleHash = Hash.sha256(preimage) as number[]
      const signature = privateKey.sign(singleHash)

      const sigDER = signature.toDER() as number[]
      const sigWithHashType: number[] = [...sigDER, sigHashType]
      const pubKeyBytes = publicKey.encode(true) as number[]

      // Build unlocking script: <signature> <publicKey> <preimage>
      const unlockScript = new Script()
      unlockScript.writeBin(sigWithHashType)
      unlockScript.writeBin(pubKeyBytes)
      unlockScript.writeBin(preimageBytes)

      const scriptBytes = unlockScript.toBinary() as number[]
      return UnlockingScript.fromBinary(scriptBytes)
    },
    estimateLength: async (): Promise<number> => 300
  }

  tx.addInput({
    sourceTXID: lockedUtxo.txid,
    sourceOutputIndex: lockedUtxo.vout,
    sequence: inputSequence,
    unlockingScriptTemplate: customUnlockTemplate
  })

  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis: outputSats
  })

  await tx.sign()

  return ok({
    txHex: tx.toHex(),
    txid: tx.id('hex'),
    outputSats
  })
}

/**
 * Check if a UTXO is still unspent
 */
async function isUtxoUnspent(txid: string, vout: number): Promise<boolean> {
  const woc = getWocClient()

  try {
    // Primary check: the direct spent endpoint (faster and more reliable)
    const spentResult = await woc.isOutputSpentSafe(txid, vout)

    if (spentResult.ok) {
      if (spentResult.value !== null) {
        walletLogger.debug('UTXO has been spent', { txid, vout, spendingTxid: spentResult.value })
        return false
      }
      // null means unspent
      return true
    }

    // API error — fall back to full tx lookup
    walletLogger.debug('Spent check failed, trying tx details', { txid, vout, error: spentResult.error.message })
    if (spentResult.error.status === 429) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Fallback: Check the full transaction
    const txResult = await woc.getTransactionDetailsSafe(txid)
    if (!txResult.ok) {
      walletLogger.warn('Could not verify UTXO spend status, assuming unspent', { txid, vout, error: txResult.error.message })
      return true // Assume unspent on error — better to show a stale lock than lose one
    }

    const output = txResult.value.vout?.[vout]
    if (output && 'spent' in output && output.spent) {
      return false
    }

    return true
  } catch (error) {
    walletLogger.error('Error checking UTXO', error, { txid, vout })
    return true // Assume unspent on error — better to show a stale lock than lose one
  }
}

/**
 * Check if a lock has been marked as unlocked in the database
 */
async function isLockMarkedUnlocked(
  txid: string,
  vout: number,
  knownUnlockedLocks?: Set<string>
): Promise<boolean> {
  const lockKey = `${txid}:${vout}`
  if (knownUnlockedLocks?.has(lockKey)) {
    walletLogger.debug('Lock found in known-unlocked set', { lockKey })
    return true
  }

  try {
    const database = getDatabase()
    const result = await database.select<{ unlocked_at: number | null }[]>(
      `SELECT l.unlocked_at FROM locks l
       INNER JOIN utxos u ON l.utxo_id = u.id
       WHERE u.txid = $1 AND u.vout = $2`,
      [txid, vout]
    )
    const isUnlocked = result.length > 0 && result[0]!.unlocked_at !== null
    if (isUnlocked) {
      walletLogger.debug('Lock marked as unlocked in database', { lockKey })
    }
    return isUnlocked
  } catch (err) {
    walletLogger.warn('Error checking lock status', { lockKey, error: String(err) })
    return false
  }
}

/**
 * Scan transaction history to detect locked UTXOs
 * This is used during wallet restoration to reconstruct the locks list
 * @param knownUnlockedLocks - Set of "txid:vout" strings for locks that were just unlocked
 */
export async function detectLockedUtxos(
  walletAddress: string,
  publicKeyHex: string,
  knownUnlockedLocks?: Set<string>
): Promise<LockedUTXO[]> {
  walletLogger.info('Scanning transaction history for locked UTXOs')
  if (knownUnlockedLocks && knownUnlockedLocks.size > 0) {
    walletLogger.debug('Excluding known-unlocked locks', { count: knownUnlockedLocks.size })
  }

  const detectedLocks: LockedUTXO[] = []
  const seen = new Set<string>()

  try {
    // Get transaction history for the wallet address
    const history = await getTransactionHistory(walletAddress)

    if (!history || history.length === 0) {
      walletLogger.debug('No transaction history found')
      return []
    }

    walletLogger.debug('Checking transactions for locks', { count: history.length })

    // Calculate expected public key hash from the provided public key
    const publicKey = PublicKey.fromString(publicKeyHex)
    const expectedPkhBytes = publicKey.toHash() as number[]
    const expectedPkh = expectedPkhBytes.map(b => b.toString(16).padStart(2, '0')).join('')

    // Batch-fetch all transaction details to avoid N+1 sequential API calls
    const txids = [...new Set(history.map(h => h.tx_hash))]
    const wocClient = getWocClient()
    const txDetailsMap = await wocClient.getTransactionDetailsBatch(txids)

    walletLogger.debug('Batch-fetched transaction details', { requested: txids.length, received: txDetailsMap.size })

    // Process fetched transactions for timelock outputs
    for (const [txid, txDetails] of txDetailsMap) {
      if (!txDetails?.vout) continue

      // Check each output for timelock script
      for (let vout = 0; vout < txDetails.vout.length; vout++) {
        const output = txDetails.vout[vout]!
        const scriptHex = output.scriptPubKey?.hex

        if (!scriptHex) continue

        const parsed = parseTimelockScript(scriptHex)
        if (!parsed) continue

        // Verify the lock belongs to this wallet
        if (parsed.publicKeyHash !== expectedPkh) {
          walletLogger.debug('Found lock but PKH does not match (different wallet)')
          continue
        }

        // Check if marked as unlocked (in-memory set or database)
        const markedUnlocked = await isLockMarkedUnlocked(txid, vout, knownUnlockedLocks)
        if (markedUnlocked) {
          continue
        }

        // Check if still unspent on chain
        const unspent = await isUtxoUnspent(txid, vout)
        if (!unspent) {
          walletLogger.debug('Lock has been spent (unlocked)', { txid, vout })
          continue
        }

        // Deduplicate: WoC may return same txid in both mempool and confirmed history
        const dedupKey = `${txid}:${vout}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)

        const satoshis = btcToSatoshis(output!.value)

        walletLogger.info('Found active lock', { txid, vout, satoshis, unlockBlock: parsed.unlockBlock })

        detectedLocks.push({
          txid,
          vout,
          satoshis,
          lockingScript: scriptHex,
          unlockBlock: parsed.unlockBlock,
          publicKeyHex,
          createdAt: txDetails.time ? txDetails.time * 1000 : Date.now(),
          confirmationBlock: txDetails.blockheight || undefined,
          // Use confirmation block as lockBlock fallback for restore (best available data)
          lockBlock: txDetails.blockheight || undefined
        })
      }
    }

    walletLogger.info('Lock detection complete', { count: detectedLocks.length })
    return detectedLocks
  } catch (error) {
    walletLogger.error('Error detecting locked UTXOs', error)
    return []
  }
}
