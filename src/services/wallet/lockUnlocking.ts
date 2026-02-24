/**
 * Lock Unlocking — lock unlocking and spending
 *
 * Handles unlocking time-locked UTXOs using the OP_PUSH_TX technique,
 * generating unlock transaction hex, and block height queries.
 */

import {
  PrivateKey,
  P2PKH,
  Transaction,
  Script,
  LockingScript,
  UnlockingScript,
  TransactionSignature,
  Hash
} from '@bsv/sdk'
import type { LockedUTXO } from './types'
import { getWifForOperation } from './types'
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
