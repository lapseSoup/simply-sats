/**
 * BRC-100 Lock Management
 *
 * Functions for managing time-locked outputs:
 * getting locks, saving/removing from database, and creating lock transactions.
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import { broadcastTransaction as infraBroadcast } from '../../infrastructure/api/broadcastService'
import { brc100Logger } from '../logger'
import type { WalletKeys, UTXO } from '../wallet'
import { getUTXOs, calculateTxFee, getWifForOperation } from '../wallet'
import {
  addUTXO,
  addLock,
  getLocks as getLocksFromDB,
  markLockUnlocked,
  addTransaction
} from '../database'
import { BASKETS, getCurrentBlockHeight } from '../sync'
import type { LockedOutput } from './types'
import { getBlockHeight } from './utils'
import { formatLockedOutput } from './outputs'
import {
  createCLTVLockingScript,
  createWrootzOpReturn,
  createScriptFromHex
} from './script'

// Lock management - now uses database
export async function getLocks(): Promise<LockedOutput[]> {
  try {
    const currentHeight = await getCurrentBlockHeight()
    const dbLocks = await getLocksFromDB(currentHeight)

    return dbLocks.map(lock => formatLockedOutput(lock, currentHeight))
  } catch (error) {
    brc100Logger.error('Failed to get locks from database', error)
    return []
  }
}

export async function saveLockToDatabase(
  utxoId: number,
  unlockBlock: number,
  ordinalOrigin?: string
): Promise<void> {
  await addLock({
    utxoId,
    unlockBlock,
    ordinalOrigin,
    createdAt: Date.now()
  })
}

export async function removeLockFromDatabase(lockId: number): Promise<void> {
  await markLockUnlocked(lockId)
}

// Create a time-locked transaction
export async function createLockTransaction(
  keys: WalletKeys,
  satoshis: number,
  blocks: number,
  ordinalOrigin?: string
): Promise<{ txid: string; unlockBlock: number }> {
  const walletWif = await getWifForOperation('wallet', 'createLockTransaction', keys)
  const privateKey = PrivateKey.fromWif(walletWif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Get UTXOs
  const utxos = await getUTXOs(fromAddress)
  if (utxos.length === 0) {
    throw new Error('No UTXOs available')
  }

  // Get current block height
  const currentHeight = await getBlockHeight()
  const unlockBlock = currentHeight + blocks

  // Create CLTV locking script
  const lockingScript = createCLTVLockingScript(keys.identityPubKey, unlockBlock)

  const tx = new Transaction()

  // Collect inputs
  const inputsToUse: UTXO[] = []
  let totalInput = 0
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    if (totalInput >= satoshis + 200) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate outputs (lock output + optional OP_RETURN + change)
  const numOutputs = ordinalOrigin ? 3 : 2 // lock + opreturn + change, or just lock + change
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
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

  // Add lock output
  tx.addOutput({
    lockingScript: createScriptFromHex(lockingScript),
    satoshis
  })

  // Add OP_RETURN for ordinal reference if provided
  if (ordinalOrigin) {
    const opReturnScript = createWrootzOpReturn('lock', ordinalOrigin)
    tx.addOutput({
      lockingScript: createScriptFromHex(opReturnScript),
      satoshis: 0
    })
  }

  // Add change output if there is any change
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(fromAddress),
      satoshis: change
    })
  }

  await tx.sign()

  // Derive txid before broadcast so we can save to DB first
  const txid = tx.id('hex')

  // Save UTXO and lock to database BEFORE broadcast so the record is never missing
  const utxoId = await addUTXO({
    txid,
    vout: 0,
    satoshis,
    lockingScript,
    basket: BASKETS.LOCKS,
    spendable: false,
    createdAt: Date.now(),
    tags: ['lock', 'wrootz']
  })

  await saveLockToDatabase(utxoId, unlockBlock, ordinalOrigin)

  // Also record the transaction
  const addTxResult = await addTransaction({
    txid,
    rawTx: tx.toHex(),
    description: `Lock ${satoshis} sats until block ${unlockBlock}`,
    createdAt: Date.now(),
    status: 'pending',
    labels: ['lock', 'wrootz']
  })
  if (!addTxResult.ok) {
    brc100Logger.warn('Failed to record lock transaction in database', { txid, error: addTxResult.error.message })
  }

  brc100Logger.info('Lock saved to database', { txid, utxoId, unlockBlock })

  // Broadcast via infrastructure service (cascade: WoC -> ARC -> mAPI)
  await infraBroadcast(tx.toHex(), txid)

  return { txid, unlockBlock }
}
