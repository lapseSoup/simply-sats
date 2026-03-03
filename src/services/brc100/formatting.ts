/**
 * BRC-100 Formatting — message formatting and response construction
 *
 * Handles building and broadcasting transactions from createAction requests,
 * including coin selection, output construction, and database tracking.
 *
 * Transaction building is delegated to the Tauri (Rust) backend.
 * No @bsv/sdk imports — all cryptographic operations happen in Rust.
 */

import { brc100Logger } from '../logger'
import type { WalletKeys } from '../wallet'
import { getUTXOs, calculateTxFee } from '../wallet'
import {
  addUTXO,
  markUTXOSpent,
  addTransaction
} from '../database'
import { BASKETS } from '../sync'
import {
  broadcastWithOverlay,
  TOPICS
} from '../overlay'
import { parseInscription, isInscriptionScript } from '../inscription'
import type { CreateActionRequest } from './types'
import { selectCoins } from '../../domain/transaction/coinSelection'
import { isInscriptionTransaction } from './utils'
import { type Result, ok, err } from '../../domain/types'
import { p2pkhLockingScriptHex } from '../../domain/transaction/builder'
import { isTauri, tauriInvoke } from '../../utils/tauri'
import { acquireSyncLock } from '../cancellation'
import { getActiveAccount } from '../accounts'

// Build and broadcast a transaction from createAction request
// Transaction building requires the Tauri runtime (Rust backend).
export async function buildAndBroadcastAction(
  keys: WalletKeys,
  actionRequest: CreateActionRequest
): Promise<Result<{ txid: string }, string>> {
  if (!isTauri()) {
    return err('BRC-100 action transaction building requires Tauri runtime')
  }

  // S-87: Acquire sync lock to prevent concurrent sync from modifying UTXOs during action
  const activeAccount = await getActiveAccount()
  const accountId = activeAccount?.id ?? 1
  const releaseLock = await acquireSyncLock(accountId)

  try {
  // S-85: Use keys.walletAddress directly instead of pulling WIF into JS heap
  const fromAddress = keys.walletAddress
  const fromScriptHex = p2pkhLockingScriptHex(fromAddress)

  // Check if this is an inscription
  const isInscription = isInscriptionTransaction(actionRequest)
  if (isInscription) {
    brc100Logger.debug('Detected inscription transaction, using ordinals address')
  }

  // Get UTXOs - for inscriptions, we still use wallet UTXOs as funding
  const utxos = await getUTXOs(fromAddress)
  if (utxos.length === 0) {
    return err('No UTXOs available')
  }

  // Validate output count to prevent excessive transaction size
  if (actionRequest.outputs.length === 0 || actionRequest.outputs.length > 100) {
    return err(`Invalid output count: ${actionRequest.outputs.length} (must be 1-100)`)
  }

  // SEC-3: Validate each output's satoshi value is a safe positive integer
  for (const output of actionRequest.outputs) {
    // S-109: Reject zero-satoshi outputs — unspendable P2PKH outputs waste UTXO space
    if (!Number.isFinite(output.satoshis) || !Number.isInteger(output.satoshis) || output.satoshis < 1) {
      return err(`Invalid output satoshi value: ${output.satoshis} (must be a positive integer)`)
    }
  }

  // SEC-4: Validate locking scripts are valid hex and non-empty
  for (const output of actionRequest.outputs) {
    if (!output.lockingScript || typeof output.lockingScript !== 'string') {
      return err('Output missing lockingScript')
    }
    if (!/^[0-9a-fA-F]+$/.test(output.lockingScript) || output.lockingScript.length < 2) {
      return err('Output lockingScript must be valid hex (at least 1 byte)')
    }
  }

  // Calculate total output amount
  const totalOutput = actionRequest.outputs.reduce((sum, o) => sum + o.satoshis, 0)
  if (!Number.isSafeInteger(totalOutput)) {
    return err('Total output amount exceeds safe integer range')
  }

  // Use domain coin selection (smallest-first, proper fee buffer)
  const numOutputs = actionRequest.outputs.length + 1 // outputs + change
  const estimatedFee = calculateTxFee(Math.min(utxos.length, 3), numOutputs)
  const selectionResult = selectCoins(utxos, totalOutput + estimatedFee)

  if (!selectionResult.sufficient) {
    return err('Insufficient funds')
  }

  const inputsToUse = selectionResult.selected
  const totalInput = selectionResult.total

  // Recalculate fee with actual input count
  const fee = calculateTxFee(inputsToUse.length, numOutputs)
  const change = totalInput - totalOutput - fee

  if (change < 0) {
    return err(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // S-85: Build and sign the transaction via Tauri using key store (WIF stays in Rust)
  const txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_p2pkh_tx_from_store', {
    toAddress: fromAddress,
    satoshis: totalOutput,
    selectedUtxos: inputsToUse.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? fromScriptHex
    })),
    totalInput,
    feeRate: 0.1
  })

  const rawTx = txResult.rawTx

  // Determine topic based on output baskets and transaction type
  let topic: string = TOPICS.DEFAULT
  const hasLocksBasket = actionRequest.outputs.some(o => o.basket === 'locks' || o.basket === 'wrootz_locks')
  const hasOrdinalsBasket = actionRequest.outputs.some(o =>
    o.basket === 'ordinals' ||
    o.basket?.includes('ordinal') ||
    o.basket?.includes('inscription')
  )
  if (hasLocksBasket) topic = TOPICS.WROOTZ_LOCKS
  else if (hasOrdinalsBasket || isInscription) topic = TOPICS.ORDINALS

  // Broadcast via overlay network AND WhatsOnChain
  const broadcastResult = await broadcastWithOverlay(rawTx, topic)

  // Check if broadcast succeeded
  const overlaySuccess = broadcastResult.overlayResults.some(r => r.accepted)
  const minerSuccess = broadcastResult.minerBroadcast.ok

  if (!overlaySuccess && !minerSuccess) {
    return err(`Failed to broadcast: ${(!broadcastResult.minerBroadcast.ok ? broadcastResult.minerBroadcast.error : undefined) || 'No nodes accepted'}`)
  }

  const txid = broadcastResult.txid || txResult.txid

  // Log overlay results
  brc100Logger.info('Overlay broadcast results', {
    txid,
    overlayAccepted: overlaySuccess,
    minerAccepted: minerSuccess,
    overlayResults: broadcastResult.overlayResults
  })

  // Track transaction in database
  try {
    // Record the transaction
    const addTxResult = await addTransaction({
      txid,
      rawTx,
      description: actionRequest.description,
      createdAt: Date.now(),
      status: 'pending',
      labels: actionRequest.labels || ['createAction']
    })
    if (!addTxResult.ok) {
      brc100Logger.warn('Failed to record transaction in database', { txid, error: addTxResult.error.message })
    }

    // Mark spent UTXOs
    for (const utxo of inputsToUse) {
      const markResult = await markUTXOSpent(utxo.txid, utxo.vout, txid)
      if (!markResult.ok) {
        brc100Logger.warn('Failed to mark UTXO spent', { txid: utxo.txid, vout: utxo.vout, error: markResult.error.message })
      }
    }

    // Add new outputs to database if they belong to us
    // For inscriptions, add the ordinal output with parsed content-type
    if (isInscription) {
      for (let i = 0; i < actionRequest.outputs.length; i++) {
        const output = actionRequest.outputs[i]!
        // Inscription outputs are typically 1 sat with envelope script
        if (output.satoshis === 1 && isInscriptionScript(output.lockingScript)) {
          // Parse the inscription to extract content-type
          const parsed = parseInscription(output.lockingScript)
          const contentType = parsed.isValid ? parsed.contentType : 'application/octet-stream'

          // Build tags including content-type
          const tags = output.tags || []
          if (!tags.includes('inscription')) tags.push('inscription')
          if (!tags.includes('ordinal')) tags.push('ordinal')
          tags.push(`content-type:${contentType}`)

          const addInscrResult = await addUTXO({
            txid,
            vout: i,
            satoshis: output.satoshis,
            lockingScript: output.lockingScript,
            basket: BASKETS.ORDINALS,
            spendable: true,
            createdAt: Date.now(),
            tags
          })
          if (!addInscrResult.ok) {
            brc100Logger.warn('Failed to add inscription UTXO to ordinals basket', { outpoint: `${txid}:${i}`, error: addInscrResult.error.message })
          } else {
            brc100Logger.info('Inscription added to ordinals basket', { outpoint: `${txid}:${i}`, contentType })
          }
        }
      }
    }

    // Add change output if there is any change
    // Note: BSV has no dust limit - all change amounts are valid
    if (change > 0) {
      const changeVout = actionRequest.outputs.length
      const addChangeResult = await addUTXO({
        txid,
        vout: changeVout,
        satoshis: change,
        lockingScript: fromScriptHex,
        basket: BASKETS.DEFAULT,
        spendable: true,
        createdAt: Date.now(),
        tags: ['change']
      })
      if (!addChangeResult.ok) {
        brc100Logger.warn('Failed to add change UTXO', { txid, changeVout, error: addChangeResult.error.message })
      }
    }

    brc100Logger.info('Transaction tracked in database', { txid })
  } catch (error) {
    brc100Logger.error('Failed to track transaction in database', error)
    // Transaction is already broadcast, continue
  }

  return ok({ txid })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  } finally {
    releaseLock()
  }
}
