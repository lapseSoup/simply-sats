/**
 * BRC-100 Lock Management
 *
 * Functions for managing time-locked outputs:
 * getting locks, saving/removing from database, and creating lock transactions.
 *
 * Transaction building is delegated to the Tauri (Rust) backend.
 * No @bsv/sdk imports — all cryptographic operations happen in Rust.
 */

import { broadcastTransaction as infraBroadcast } from '../wallet/transactions'
import { brc100Logger } from '../logger'
import type { WalletKeys } from '../wallet'
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
} from './script'
import { type Result, ok, err } from '../../domain/types'
import { selectCoins } from '../../domain/transaction/coinSelection'
import { p2pkhLockingScriptHex } from '../../domain/transaction/builder'
import { isTauri, tauriInvoke } from '../../utils/tauri'

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
// Transaction building requires the Tauri runtime (Rust backend).
export async function createLockTransaction(
  keys: WalletKeys,
  satoshis: number,
  blocks: number,
  ordinalOrigin?: string
): Promise<Result<{ txid: string; unlockBlock: number }, string>> {
  if (!Number.isFinite(satoshis) || satoshis <= 0 || !Number.isInteger(satoshis)) {
    return err(`Invalid lock amount: ${satoshis} (must be a positive integer)`)
  }
  if (!Number.isFinite(blocks) || blocks <= 0 || !Number.isInteger(blocks)) {
    return err(`Invalid lock duration: ${blocks} (must be a positive integer)`)
  }

  if (!isTauri()) {
    return err('Lock transaction building requires Tauri runtime')
  }

  try {
    const walletWif = await getWifForOperation('wallet', 'createLockTransaction', keys)
    // Derive address from WIF via Tauri
    const keyInfo = await tauriInvoke<{ address: string }>('keys_from_wif', { wif: walletWif })
    const fromAddress = keyInfo.address

    // Get UTXOs
    const utxos = await getUTXOs(fromAddress)
    if (utxos.length === 0) {
      return err('No UTXOs available')
    }

    // Get current block height
    const currentHeight = await getBlockHeight()
    const unlockBlock = currentHeight + blocks

    // Create CLTV locking script
    // S-51: Use walletPubKey for CLTV to match unlock path which uses wallet key
    const lockingScript = createCLTVLockingScript(keys.walletPubKey, unlockBlock)

    // Source locking script for the wallet address (used for signing context)
    const sourceLockingScriptHex = p2pkhLockingScriptHex(fromAddress)

    // Q-52: Use domain coin selection instead of manual greedy loop
    const { selected: inputsToUse, total: totalInput, sufficient } = selectCoins(utxos, satoshis)
    if (!sufficient) {
      return err('Insufficient funds')
    }

    // Calculate outputs (lock output + optional OP_RETURN + change)
    const numOutputs = ordinalOrigin ? 3 : 2 // lock + opreturn + change, or just lock + change
    const fee = calculateTxFee(inputsToUse.length, numOutputs)
    const change = totalInput - satoshis - fee

    if (change < 0) {
      return err(`Insufficient funds (need ${fee} sats for fee)`)
    }

    // Build and sign the transaction via Tauri
    const txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_p2pkh_tx', {
      wif: walletWif,
      toAddress: fromAddress,
      satoshis,
      selectedUtxos: inputsToUse.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? sourceLockingScriptHex
      })),
      totalInput,
      feeRate: 0.1
    })

    const txid = txResult.txid
    const rawTx = txResult.rawTx

    // Broadcast via infrastructure service (cascade: WoC -> ARC -> mAPI)
    // Broadcast FIRST — only save to DB on success to avoid phantom records
    await infraBroadcast(rawTx)

    // Broadcast succeeded — now persist to database
    const addLockResult = await addUTXO({
      txid,
      vout: 0,
      satoshis,
      lockingScript,
      basket: BASKETS.LOCKS,
      spendable: false,
      createdAt: Date.now(),
      tags: ['lock', 'wrootz']
    })
    if (!addLockResult.ok) {
      brc100Logger.error('Broadcast succeeded but failed to save lock UTXO to database', { txid, error: addLockResult.error.message })
      // Return ok since broadcast succeeded — background sync will reconcile
      return ok({ txid, unlockBlock })
    }
    const utxoId = addLockResult.value

    await saveLockToDatabase(utxoId, unlockBlock, ordinalOrigin)

    // Also record the transaction
    const addTxResult = await addTransaction({
      txid,
      rawTx,
      description: `Lock ${satoshis} sats until block ${unlockBlock}`,
      createdAt: Date.now(),
      status: 'pending',
      labels: ['lock', 'wrootz']
    })
    if (!addTxResult.ok) {
      brc100Logger.warn('Failed to record lock transaction in database', { txid, error: addTxResult.error.message })
    }

    brc100Logger.info('Lock saved to database', { txid, utxoId, unlockBlock })

    return ok({ txid, unlockBlock })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}
