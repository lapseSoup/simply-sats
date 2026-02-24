/**
 * BRC-100 Formatting — message formatting and response construction
 *
 * Handles building and broadcasting transactions from createAction requests,
 * including coin selection, output construction, and database tracking.
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import { brc100Logger } from '../logger'
import type { WalletKeys } from '../wallet'
import { getUTXOs, calculateTxFee, getWifForOperation } from '../wallet'
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
import { convertToLockingScript } from './script'
import { selectCoins } from '../../domain/transaction/coinSelection'
import { isInscriptionTransaction } from './utils'
import { type Result, ok, err } from '../../domain/types'

// Build and broadcast a transaction from createAction request
export async function buildAndBroadcastAction(
  keys: WalletKeys,
  actionRequest: CreateActionRequest
): Promise<Result<{ txid: string }, string>> {
  try {
  const walletWif = await getWifForOperation('wallet', 'buildAndBroadcastAction', keys)
  const privateKey = PrivateKey.fromWif(walletWif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()
  const sourceLockingScript = new P2PKH().lock(fromAddress)

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
    if (!Number.isFinite(output.satoshis) || !Number.isInteger(output.satoshis) || output.satoshis < 0) {
      return err(`Invalid output satoshi value: ${output.satoshis} (must be a non-negative integer)`)
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

  const tx = new Transaction()

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

  // Add outputs from request
  for (const output of actionRequest.outputs) {
    // Convert hex string to proper Script object
    const lockingScript = convertToLockingScript(output.lockingScript)
    tx.addOutput({
      lockingScript,
      satoshis: output.satoshis
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

  // Set locktime if specified
  if (actionRequest.lockTime) {
    tx.lockTime = actionRequest.lockTime
  }

  await tx.sign()

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
  const broadcastResult = await broadcastWithOverlay(tx.toHex(), topic)

  // Check if broadcast succeeded
  const overlaySuccess = broadcastResult.overlayResults.some(r => r.accepted)
  const minerSuccess = broadcastResult.minerBroadcast.ok

  if (!overlaySuccess && !minerSuccess) {
    return err(`Failed to broadcast: ${(!broadcastResult.minerBroadcast.ok ? broadcastResult.minerBroadcast.error : undefined) || 'No nodes accepted'}`)
  }

  const txid = broadcastResult.txid || tx.id('hex')

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
      rawTx: tx.toHex(),
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
        lockingScript: new P2PKH().lock(fromAddress).toHex(),
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
  }
}
