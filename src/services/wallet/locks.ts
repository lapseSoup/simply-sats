/**
 * Time lock operations (OP_PUSH_TX technique)
 * Based on jdh7190's bsv-lock: https://github.com/jdh7190/bsv-lock
 * Uses sCrypt-compiled script that validates preimage on-chain
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
import { calculateLockFee, feeFromBytes } from './fees'
import { broadcastTransaction } from './transactions'
import { getTransactionHistory, getTransactionDetails } from './balance'
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend
} from '../sync'
import { markLockUnlockedByTxid, getDatabase, addUTXO, addLock } from '../database'
import { walletLogger } from '../logger'

// sCrypt-compiled timelock script components from bsv-lock
// This script uses OP_PUSH_TX to validate the transaction preimage on-chain,
// checking that nLockTime >= the specified block height
const LOCKUP_PREFIX = `97dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026 02ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382 1008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c 0 0`
const LOCKUP_SUFFIX = `OP_NOP 0 OP_PICK 0065cd1d OP_LESSTHAN OP_VERIFY 0 OP_PICK OP_4 OP_ROLL OP_DROP OP_3 OP_ROLL OP_3 OP_ROLL OP_3 OP_ROLL OP_1 OP_PICK OP_3 OP_ROLL OP_DROP OP_2 OP_ROLL OP_2 OP_ROLL OP_DROP OP_DROP OP_NOP OP_5 OP_PICK 41 OP_NOP OP_1 OP_PICK OP_7 OP_PICK OP_7 OP_PICK 0ac407f0e4bd44bfc207355a778b046225a7068fc59ee7eda43ad905aadbffc800 6c266b30e6a1319c66dc401e5bd6b432ba49688eecd118297041da8074ce0810 OP_9 OP_PICK OP_6 OP_PICK OP_NOP OP_6 OP_PICK OP_HASH256 0 OP_PICK OP_NOP 0 OP_PICK OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_7 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_6 OP_PICK OP_NOP OP_3 OP_PICK OP_6 OP_PICK OP_4 OP_PICK OP_7 OP_PICK OP_MUL OP_ADD OP_MUL 414136d08c5ed2bf3ba048afe6dcaebafeffffffffffffffffffffffffffffff00 OP_1 OP_PICK OP_1 OP_PICK OP_NOP OP_1 OP_PICK OP_1 OP_PICK OP_MOD 0 OP_PICK 0 OP_LESSTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_ADD OP_ELSE 0 OP_PICK OP_ENDIF OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_1 OP_PICK OP_1 OP_PICK OP_2 OP_DIV OP_GREATERTHAN OP_IF 0 OP_PICK OP_2 OP_PICK OP_SUB OP_2 OP_ROLL OP_DROP OP_1 OP_ROLL OP_ENDIF OP_3 OP_PICK OP_SIZE OP_NIP OP_2 OP_PICK OP_SIZE OP_NIP OP_3 OP_PICK 20 OP_NUM2BIN OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_1 OP_SPLIT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT OP_SWAP OP_CAT 20 OP_2 OP_PICK OP_SUB OP_SPLIT OP_NIP OP_4 OP_3 OP_PICK OP_ADD OP_2 OP_PICK OP_ADD 30 OP_1 OP_PICK OP_CAT OP_2 OP_CAT OP_4 OP_PICK OP_CAT OP_8 OP_PICK OP_CAT OP_2 OP_CAT OP_3 OP_PICK OP_CAT OP_2 OP_PICK OP_CAT OP_7 OP_PICK OP_CAT 0 OP_PICK OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP 0 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP 0065cd1d OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK 28 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK 2c OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP ffffffff00 OP_LESSTHAN OP_VERIFY OP_5 OP_PICK OP_NOP 0 OP_PICK OP_NOP 0 OP_PICK OP_SIZE OP_NIP OP_1 OP_PICK OP_1 OP_PICK OP_4 OP_SUB OP_SPLIT OP_DROP OP_1 OP_PICK OP_8 OP_SUB OP_SPLIT OP_NIP OP_1 OP_ROLL OP_DROP OP_1 OP_ROLL OP_DROP OP_NOP OP_NOP 0 OP_PICK 00 OP_CAT OP_BIN2NUM OP_1 OP_ROLL OP_DROP OP_NOP OP_1 OP_ROLL OP_DROP OP_NOP OP_2 OP_PICK OP_GREATERTHANOREQUAL OP_VERIFY OP_6 OP_PICK OP_HASH160 OP_1 OP_PICK OP_EQUAL OP_VERIFY OP_7 OP_PICK OP_7 OP_PICK OP_CHECKSIG OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP OP_NIP`

// Timelock script signature - the first 32-byte constant from LOCKUP_PREFIX
const TIMELOCK_SCRIPT_SIGNATURE = '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff026'

// Helper: convert integer to little-endian hex
function int2Hex(n: number): string {
  if (n === 0) return '00'
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  // Reverse bytes for little-endian
  const bytes = hex.match(/.{2}/g) || []
  return bytes.reverse().join('')
}

// Helper: convert little-endian hex to integer
function _hex2Int(hex: string): number {
  const bytes = hex.match(/.{2}/g) || []
  const reversed = bytes.reverse().join('')
  return parseInt(reversed, 16)
}
export { _hex2Int as hex2Int }

/**
 * Create the OP_PUSH_TX timelock locking script
 * This script validates the transaction preimage on-chain and checks nLockTime
 */
function createTimelockScript(publicKeyHash: string, blockHeight: number): Script {
  const nLockTimeHex = int2Hex(blockHeight)
  const scriptASM = `${LOCKUP_PREFIX} ${publicKeyHash} ${nLockTimeHex} ${LOCKUP_SUFFIX}`
  return Script.fromASM(scriptASM)
}

/**
 * Get the exact size of a timelock script for a given public key and block height
 * This allows accurate fee calculation before creating the transaction
 */
export function getTimelockScriptSize(publicKeyHex: string, blockHeight: number): number {
  const publicKey = PublicKey.fromString(publicKeyHex)
  const publicKeyHashBytes = publicKey.toHash() as number[]
  const publicKeyHashHex = publicKeyHashBytes.map(b => b.toString(16).padStart(2, '0')).join('')
  const script = createTimelockScript(publicKeyHashHex, blockHeight)
  return script.toBinary().length
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
    0x6a, // OP_RETURN
    0x00, // OP_FALSE
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
  wif: string,
  satoshis: number,
  unlockBlock: number,
  utxos: UTXO[],
  ordinalOrigin?: string
): Promise<{ txid: string; lockedUtxo: LockedUTXO }> {
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
    throw new Error('Insufficient funds')
  }

  // Calculate fee using actual script size
  const numInputs = inputsToUse.length
  const timelockScriptSize = timelockScript.toBinary().length
  const fee = calculateLockFee(numInputs, timelockScriptSize)
  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
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
    lockScriptBytes.push(lockScriptBin[i])
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

  // CRITICAL: Mark UTXOs as pending BEFORE broadcast to prevent race conditions
  try {
    await markUtxosPendingSpend(utxosToSpend, pendingTxid)
    walletLogger.debug('Marked UTXOs as pending spend for lock', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare lock transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Lock broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
      walletLogger.debug('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  const lockedUtxo: LockedUTXO = {
    txid,
    vout: 0,
    satoshis,
    lockingScript: timelockScript.toHex(),
    unlockBlock,
    publicKeyHex: publicKey.toString(),
    createdAt: Date.now()
  }

  // Track transaction and confirm spend
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Locked ${satoshis} sats until block ${unlockBlock}`,
      ['lock'],
      -(satoshis + fee)  // Negative: locked amount + mining fee
    )
    // Confirm UTXOs as spent (updates from pending -> spent)
    await confirmUtxosSpent(utxosToSpend, txid)
  } catch (error) {
    walletLogger.warn('Failed to track lock transaction', { error: String(error) })
  }

  // Best-effort: track change UTXO so balance stays correct until next sync
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
      })
      walletLogger.debug('Lock change UTXO tracked', { txid, change })
    } catch (error) {
      walletLogger.warn('Failed to track lock change UTXO (will recover on next sync)', { error: String(error) })
    }
  }

  // Add lock to database so it can be properly tracked for unlock
  try {
    const utxoId = await addUTXO({
      txid,
      vout: 0,
      satoshis,
      lockingScript: timelockScript.toHex(),
      basket: 'locks',
      spendable: false,
      createdAt: Date.now()
    })

    await addLock({
      utxoId,
      unlockBlock,
      ordinalOrigin: ordinalOrigin ?? undefined,
      createdAt: Date.now()
    })
    walletLogger.info('Added lock to database', { txid, vout: 0, unlockBlock })
  } catch (error) {
    walletLogger.warn('Failed to add lock to database', { error: String(error) })
  }

  return { txid, lockedUtxo }
}

/**
 * Unlock a locked UTXO using OP_PUSH_TX technique
 *
 * The solution script is: <signature> <publicKey> <preimage>
 * The preimage is the BIP-143 sighash preimage that the script validates on-chain
 */
export async function unlockBSV(
  wif: string,
  lockedUtxo: LockedUTXO,
  currentBlockHeight: number
): Promise<string> {
  // Check block height for user feedback
  if (currentBlockHeight < lockedUtxo.unlockBlock) {
    throw new Error(`Cannot unlock yet. Current block: ${currentBlockHeight}, Unlock block: ${lockedUtxo.unlockBlock}`)
  }

  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Calculate fee for unlock transaction
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2 // hex to bytes
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    throw new Error(`Insufficient funds to cover unlock fee (need ${fee} sats)`)
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

  const txid = await broadcastTransaction(tx)

  // Track transaction
  try {
    await recordSentTransaction(
      txid,
      tx.toHex(),
      `Unlocked ${lockedUtxo.satoshis} sats`,
      ['unlock'],
      outputSats
    )
  } catch (error) {
    walletLogger.warn('Failed to track unlock transaction', { error: String(error) })
  }

  // Mark the lock as unlocked in the database
  try {
    await markLockUnlockedByTxid(lockedUtxo.txid, lockedUtxo.vout)
    walletLogger.info('Marked lock as unlocked', { txid: lockedUtxo.txid, vout: lockedUtxo.vout })
  } catch (error) {
    walletLogger.warn('Failed to mark lock as unlocked in database', { error: String(error) })
  }

  return txid
}

/**
 * Get current block height from WhatsOnChain
 */
export async function getCurrentBlockHeight(): Promise<number> {
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info')
    if (!response.ok) throw new Error('Failed to fetch block height')
    const data = await response.json()
    return data.blocks
  } catch (error) {
    walletLogger.error('Error fetching block height', error)
    throw error
  }
}

/**
 * Generate the raw unlock transaction hex without broadcasting.
 * Uses OP_PUSH_TX technique with preimage in the solution.
 */
export async function generateUnlockTxHex(
  wif: string,
  lockedUtxo: LockedUTXO
): Promise<{ txHex: string; txid: string; outputSats: number }> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const toAddress = publicKey.toAddress()

  // Calculate fee for unlock transaction
  const lockingScriptSize = lockedUtxo.lockingScript.length / 2
  const unlockScriptSize = 73 + 34 + 180 + lockingScriptSize
  const txSize = 4 + 1 + 36 + 3 + unlockScriptSize + 4 + 1 + 34 + 4
  const fee = feeFromBytes(txSize)
  const outputSats = lockedUtxo.satoshis - fee

  if (outputSats <= 0) {
    throw new Error(`Insufficient funds to cover unlock fee (need ${fee} sats)`)
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

  return {
    txHex: tx.toHex(),
    txid: tx.id('hex'),
    outputSats
  }
}

/**
 * Parse a timelock script to extract the unlock block height and public key hash
 * Returns null if the script is not a recognized timelock script
 */
function parseTimelockScript(scriptHex: string): { unlockBlock: number; publicKeyHash: string } | null {
  // Check if script starts with our timelock signature
  if (!scriptHex.startsWith(TIMELOCK_SCRIPT_SIGNATURE)) {
    return null
  }

  try {
    const prefixHexLen = 204

    // After prefix comes: 0x14 (1 byte) + pkh (20 bytes) = 42 hex chars
    const pkhStart = prefixHexLen
    const pkhPushByte = scriptHex.substring(pkhStart, pkhStart + 2)

    if (pkhPushByte !== '14') {
      return null
    }

    const publicKeyHash = scriptHex.substring(pkhStart + 2, pkhStart + 2 + 40)

    // After pkh comes the nLockTime push
    const nLockTimeStart = pkhStart + 42
    const nLockTimePushByte = scriptHex.substring(nLockTimeStart, nLockTimeStart + 2)
    const pushLen = parseInt(nLockTimePushByte, 16)

    if (pushLen > 4) {
      return null
    }

    const nLockTimeHex = scriptHex.substring(nLockTimeStart + 2, nLockTimeStart + 2 + pushLen * 2)

    // Convert little-endian hex to number
    const bytes = nLockTimeHex.match(/.{2}/g) || []
    const unlockBlock = parseInt(bytes.reverse().join(''), 16)

    return { unlockBlock, publicKeyHash }
  } catch (error) {
    walletLogger.error('Error parsing timelock script', error)
    return null
  }
}

/**
 * Check if a UTXO is still unspent
 */
async function isUtxoUnspent(txid: string, vout: number): Promise<boolean> {
  try {
    // Primary check: the direct spent endpoint (faster and more reliable)
    const spentResponse = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/${vout}/spent`)

    // 200 OK means we got spending info = it's spent
    if (spentResponse.ok) {
      const spentData = await spentResponse.json()
      if (spentData && spentData.txid) {
        walletLogger.debug('UTXO has been spent', { txid, vout, spendingTxid: spentData.txid })
        return false
      }
    }

    // 404 means no spending tx found = still unspent
    if (spentResponse.status === 404) {
      return true
    }

    // For rate limiting (429) or other errors, fall back to tx lookup
    if (spentResponse.status === 429) {
      walletLogger.debug('Rate limited checking UTXO, trying tx endpoint', { txid, vout })
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    // Fallback: Check the full transaction
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}`)
    if (!response.ok) {
      walletLogger.debug('Could not fetch tx', { txid, status: response.status })
      if (response.status === 429) {
        walletLogger.debug('Rate limited, conservatively treating as potentially spent')
        return false
      }
      return true
    }

    const txData = await response.json()
    const output = txData.vout?.[vout]

    if (output?.spent) {
      return false
    }

    return true
  } catch (error) {
    walletLogger.error('Error checking UTXO', error, { txid, vout })
    return false
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
    const isUnlocked = result.length > 0 && result[0].unlocked_at !== null
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

    // Check each transaction for timelock outputs
    for (const historyItem of history) {
      const txid = historyItem.tx_hash

      try {
        const txDetails = await getTransactionDetails(txid)
        if (!txDetails?.vout) continue

        // Check each output for timelock script
        for (let vout = 0; vout < txDetails.vout.length; vout++) {
          const output = txDetails.vout[vout]
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

          const satoshis = Math.round(output.value * 100000000)

          walletLogger.info('Found active lock', { txid, vout, satoshis, unlockBlock: parsed.unlockBlock })

          detectedLocks.push({
            txid,
            vout,
            satoshis,
            lockingScript: scriptHex,
            unlockBlock: parsed.unlockBlock,
            publicKeyHex,
            createdAt: txDetails.time ? txDetails.time * 1000 : Date.now()
          })
        }
      } catch (error) {
        walletLogger.warn('Error processing tx', { txid, error: String(error) })
      }
    }

    walletLogger.info('Lock detection complete', { count: detectedLocks.length })
    return detectedLocks
  } catch (error) {
    walletLogger.error('Error detecting locked UTXOs', error)
    return []
  }
}
