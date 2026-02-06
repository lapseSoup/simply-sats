/**
 * Transaction building and broadcasting
 * Handles sendBSV, sendBSVMultiKey, and broadcastTransaction
 */

import { PrivateKey, P2PKH, Transaction } from '@bsv/sdk'
import type { UTXO, ExtendedUTXO } from './types'
import { calculateTxFee } from './fees'
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getSpendableUtxosFromDatabase,
  BASKETS
} from '../sync'
import { getDerivedAddresses, withTransaction, addUTXO } from '../database'
import { walletLogger } from '../logger'
import { resetInactivityTimer } from '../autoLock'

/**
 * Broadcast a signed transaction - try multiple endpoints for non-standard scripts
 */
export async function broadcastTransaction(tx: Transaction): Promise<string> {
  const txhex = tx.toHex()
  walletLogger.debug('Broadcasting transaction', { txhex: txhex.slice(0, 100) + '...' })

  const errors: string[] = []

  // Try WhatsOnChain first
  try {
    walletLogger.debug('Trying WhatsOnChain broadcast')
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex })
    })

    if (response.ok) {
      walletLogger.info('WhatsOnChain broadcast successful')
      return tx.id('hex')
    }

    const errorText = await response.text()
    walletLogger.warn('WoC broadcast failed', { error: errorText })
    errors.push(`WoC: ${errorText}`)
  } catch (error) {
    walletLogger.warn('WoC error', { error: String(error) })
    errors.push(`WoC: ${error}`)
  }

  // Try GorillaPool ARC with skipScriptFlags in JSON body to bypass DISCOURAGE_UPGRADABLE_NOPS policy
  try {
    walletLogger.debug('Trying GorillaPool ARC with skipScriptFlags')
    const arcResponse = await fetch('https://arc.gorillapool.io/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: JSON.stringify({
        rawTx: txhex,
        skipScriptFlags: ['DISCOURAGE_UPGRADABLE_NOPS']
      })
    })

    const arcResult = await arcResponse.json()
    walletLogger.debug('GorillaPool ARC response', { txStatus: arcResult.txStatus, txid: arcResult.txid })

    // ARC returns status 200 even for errors, check txStatus
    // Only accept confirmed statuses - do not accept ambiguous responses
    if (arcResult.txid && (arcResult.txStatus === 'SEEN_ON_NETWORK' || arcResult.txStatus === 'ACCEPTED')) {
      walletLogger.info('ARC broadcast successful', { txid: arcResult.txid })
      return arcResult.txid
    } else {
      const errorMsg = arcResult.detail || arcResult.extraInfo || arcResult.title || 'Unknown ARC error'
      walletLogger.warn('ARC rejected transaction', { error: errorMsg })
      errors.push(`ARC: ${errorMsg}`)
    }
  } catch (error) {
    walletLogger.warn('GorillaPool ARC error', { error: String(error) })
    errors.push(`ARC: ${error}`)
  }

  // Try ARC with plain text format but with skipscriptflags header
  try {
    walletLogger.debug('Trying GorillaPool ARC (plain text)')
    const arcResponse2 = await fetch('https://arc.gorillapool.io/v1/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-SkipScriptFlags': 'DISCOURAGE_UPGRADABLE_NOPS'
      },
      body: txhex
    })

    const arcResult2 = await arcResponse2.json()
    walletLogger.debug('GorillaPool ARC (plain) response', { txStatus: arcResult2.txStatus, txid: arcResult2.txid })

    // Only accept confirmed statuses - do not accept ambiguous responses
    if (arcResult2.txid && (arcResult2.txStatus === 'SEEN_ON_NETWORK' || arcResult2.txStatus === 'ACCEPTED')) {
      walletLogger.info('ARC broadcast successful', { txid: arcResult2.txid })
      return arcResult2.txid
    } else {
      const errorMsg = arcResult2.detail || arcResult2.extraInfo || arcResult2.title || 'Unknown ARC error'
      walletLogger.warn('ARC (plain) rejected transaction', { error: errorMsg })
      errors.push(`ARC2: ${errorMsg}`)
    }
  } catch (error) {
    walletLogger.warn('GorillaPool ARC (plain) error', { error: String(error) })
    errors.push(`ARC2: ${error}`)
  }

  // Try GorillaPool mAPI as fallback
  try {
    walletLogger.debug('Trying GorillaPool mAPI')
    const mapiResponse = await fetch('https://mapi.gorillapool.io/mapi/tx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ rawtx: txhex })
    })

    const result = await mapiResponse.json()
    walletLogger.debug('GorillaPool mAPI response received')

    // mAPI wraps response in payload
    if (result.payload) {
      const payload = typeof result.payload === 'string' ? JSON.parse(result.payload) : result.payload
      walletLogger.debug('mAPI payload', { returnResult: payload.returnResult, txid: payload.txid })

      // Check for success - returnResult must be "success"
      if (payload.returnResult === 'success' && payload.txid) {
        walletLogger.info('mAPI broadcast successful', { txid: payload.txid })
        return payload.txid
      } else {
        // Failed - extract error message
        const errorMsg = payload.resultDescription || payload.returnResult || 'Unknown mAPI error'
        walletLogger.warn('mAPI rejected transaction', { error: errorMsg })
        errors.push(`mAPI: ${errorMsg}`)
      }
    } else {
      errors.push(`mAPI: No payload in response`)
    }
  } catch (error) {
    walletLogger.warn('mAPI error', { error: String(error) })
    errors.push(`mAPI: ${error}`)
  }

  throw new Error(`Failed to broadcast: ${errors.join(' | ')}`)
}

/**
 * Build and sign a simple P2PKH transaction
 */
export async function sendBSV(
  wif: string,
  toAddress: string,
  satoshis: number,
  utxos: UTXO[],
  accountId?: number  // Account ID for scoping transaction record
): Promise<string> {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const fromAddress = publicKey.toAddress()

  // Generate locking script for the source address
  const sourceLockingScript = new P2PKH().lock(fromAddress)

  const tx = new Transaction()

  // Collect inputs we'll use
  const inputsToUse: UTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    // Break if we have enough for amount + reasonable fee buffer
    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee based on actual transaction size using configured fee rate
  const numInputs = inputsToUse.length

  // First calculate if we'll have meaningful change
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100 // Need room for fee + non-dust change

  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs - pass sourceSatoshis and lockingScript to unlock() for signing
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

  // Add recipient output
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if there is any change
  // Note: BSV has no dust limit - all change amounts are valid
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
  // If we crash after broadcast but before marking as spent, these UTXOs won't be double-spent
  try {
    await markUtxosPendingSpend(utxosToSpend, pendingTxid)
    walletLogger.debug('Marked UTXOs as pending spend', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
      walletLogger.debug('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  // Broadcast succeeded - confirm the spend and record the transaction
  try {
    await withTransaction(async () => {
      // Record with negative amount (sent) including fee for accurate net change
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Sent ${satoshis} sats to ${toAddress}`,
        ['send'],
        -(satoshis + fee),  // Negative = money out, includes fee
        accountId
      )

      // Confirm UTXOs as spent (updates from pending -> spent)
      await confirmUtxosSpent(utxosToSpend, txid)

      // Track change UTXO immediately so balance stays correct
      // Without this, balance drops by the full UTXO amount until next sync
      if (change > 0) {
        await addUTXO({
          txid: pendingTxid,
          vout: tx.outputs.length - 1,  // Change is always last output
          satoshis: change,
          lockingScript: new P2PKH().lock(fromAddress).toHex(),
          address: fromAddress,
          basket: 'default',
          spendable: true,
          createdAt: Date.now()
        }, accountId)
      }
    })

    walletLogger.info('Transaction tracked locally', { txid, change })
    resetInactivityTimer()
  } catch (error) {
    // Log error but don't fail - tx is already broadcast
    // UTXOs are still marked as pending, which is safe (they won't be double-spent)
    walletLogger.error('CRITICAL: Failed to confirm transaction locally', error, { txid })
  }

  return txid
}

/**
 * Get all spendable UTXOs from both default and derived baskets
 * Returns UTXOs with their associated WIFs for signing
 */
export async function getAllSpendableUTXOs(walletWif: string): Promise<ExtendedUTXO[]> {
  const result: ExtendedUTXO[] = []

  // Get UTXOs from default basket
  const defaultUtxos = await getSpendableUtxosFromDatabase(BASKETS.DEFAULT)
  const walletPrivKey = PrivateKey.fromWif(walletWif)
  const walletAddress = walletPrivKey.toPublicKey().toAddress()

  for (const u of defaultUtxos) {
    result.push({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.lockingScript,
      wif: walletWif,
      address: walletAddress
    })
  }

  // Get UTXOs from derived basket with their WIFs
  const derivedUtxos = await getSpendableUtxosFromDatabase(BASKETS.DERIVED)
  const derivedAddresses = await getDerivedAddresses()

  for (const u of derivedUtxos) {
    // Find the derived address entry that matches this UTXO's locking script
    const derivedAddr = derivedAddresses.find(d => {
      const derivedLockingScript = new P2PKH().lock(d.address).toHex()
      return derivedLockingScript === u.lockingScript
    })

    if (derivedAddr) {
      result.push({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.lockingScript,
        wif: derivedAddr.privateKeyWif,
        address: derivedAddr.address
      })
    }
  }

  // Sort by satoshis (smallest first for efficient coin selection)
  return result.sort((a, b) => a.satoshis - b.satoshis)
}

/**
 * Send BSV using UTXOs from multiple addresses/keys
 * Supports spending from both default wallet and derived addresses
 */
export async function sendBSVMultiKey(
  changeWif: string,  // WIF for change output (usually wallet WIF)
  toAddress: string,
  satoshis: number,
  utxos: ExtendedUTXO[],
  accountId?: number  // Account ID for scoping transaction record
): Promise<string> {
  const changePrivKey = PrivateKey.fromWif(changeWif)
  const changeAddress = changePrivKey.toPublicKey().toAddress()

  const tx = new Transaction()

  // Collect inputs we'll use
  const inputsToUse: ExtendedUTXO[] = []
  let totalInput = 0

  for (const utxo of utxos) {
    inputsToUse.push(utxo)
    totalInput += utxo.satoshis

    // Break if we have enough for amount + reasonable fee buffer
    if (totalInput >= satoshis + 100) break
  }

  if (totalInput < satoshis) {
    throw new Error('Insufficient funds')
  }

  // Calculate fee
  const numInputs = inputsToUse.length
  const prelimChange = totalInput - satoshis
  const willHaveChange = prelimChange > 100
  const numOutputs = willHaveChange ? 2 : 1
  const fee = calculateTxFee(numInputs, numOutputs)

  const change = totalInput - satoshis - fee

  if (change < 0) {
    throw new Error(`Insufficient funds (need ${fee} sats for fee)`)
  }

  // Add inputs - each with its own key
  for (const utxo of inputsToUse) {
    const inputPrivKey = PrivateKey.fromWif(utxo.wif)
    const inputLockingScript = new P2PKH().lock(utxo.address)

    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        inputPrivKey,
        'all',
        false,
        utxo.satoshis,
        inputLockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Add recipient output
  tx.addOutput({
    lockingScript: new P2PKH().lock(toAddress),
    satoshis
  })

  // Add change output if there is any change
  // Note: BSV has no dust limit - all change amounts are valid
  if (change > 0) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(changeAddress),
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
    walletLogger.debug('Marked UTXOs as pending spend (multi-key)', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare transaction - UTXOs could not be locked')
  }

  // Now broadcast the transaction
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    // Broadcast failed - rollback the pending status
    walletLogger.error('Broadcast failed, rolling back pending status', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
      walletLogger.debug('Rolled back pending status for UTXOs')
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  // Broadcast succeeded - confirm the spend and record the transaction
  try {
    await withTransaction(async () => {
      // Record with negative amount (sent) including fee for accurate net change
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Sent ${satoshis} sats to ${toAddress}`,
        ['send'],
        -(satoshis + fee),  // Negative = money out, includes fee
        accountId
      )

      // Confirm UTXOs as spent (updates from pending -> spent)
      await confirmUtxosSpent(utxosToSpend, txid)

      // Track change UTXO immediately so balance stays correct
      if (change > 0) {
        await addUTXO({
          txid: pendingTxid,
          vout: tx.outputs.length - 1,
          satoshis: change,
          lockingScript: new P2PKH().lock(changeAddress).toHex(),
          address: changeAddress,
          basket: 'default',
          spendable: true,
          createdAt: Date.now()
        }, accountId)
      }
    })

    walletLogger.info('Transaction tracked locally', { txid, change })
    resetInactivityTimer()
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to confirm transaction locally', error, { txid })
  }

  return txid
}

/**
 * Consolidate multiple UTXOs into a single UTXO
 * Combines all selected UTXOs minus fees into one output back to the wallet address
 */
export async function consolidateUtxos(
  wif: string,
  utxoIds: Array<{ txid: string; vout: number; satoshis: number; script: string }>
): Promise<{ txid: string; outputSats: number; fee: number }> {
  if (utxoIds.length < 2) {
    throw new Error('Need at least 2 UTXOs to consolidate')
  }

  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()
  const address = publicKey.toAddress()
  const lockingScript = new P2PKH().lock(address)

  const tx = new Transaction()

  // Calculate total input
  let totalInput = 0
  for (const utxo of utxoIds) {
    totalInput += utxo.satoshis
  }

  // Calculate fee (n inputs, 1 output)
  const fee = calculateTxFee(utxoIds.length, 1)
  const outputSats = totalInput - fee

  if (outputSats <= 0) {
    throw new Error(`Cannot consolidate: total ${totalInput} sats minus ${fee} fee leaves no output`)
  }

  // Add all inputs
  for (const utxo of utxoIds) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(
        privateKey,
        'all',
        false,
        utxo.satoshis,
        lockingScript
      ),
      sequence: 0xffffffff
    })
  }

  // Single output back to our address
  tx.addOutput({
    lockingScript: new P2PKH().lock(address),
    satoshis: outputSats
  })

  await tx.sign()

  // Get the UTXOs we're about to spend
  const utxosToSpend = utxoIds.map(u => ({ txid: u.txid, vout: u.vout }))

  // Compute txid before broadcast
  const pendingTxid = tx.id('hex')

  // Mark UTXOs as pending
  try {
    await markUtxosPendingSpend(utxosToSpend, pendingTxid)
    walletLogger.debug('Marked UTXOs as pending for consolidation', { txid: pendingTxid })
  } catch (error) {
    walletLogger.error('Failed to mark UTXOs as pending', error)
    throw new Error('Failed to prepare consolidation - UTXOs could not be locked')
  }

  // Broadcast
  let txid: string
  try {
    txid = await broadcastTransaction(tx)
  } catch (broadcastError) {
    walletLogger.error('Consolidation broadcast failed, rolling back', broadcastError)
    try {
      await rollbackPendingSpend(utxosToSpend)
    } catch (rollbackError) {
      walletLogger.error('CRITICAL: Failed to rollback pending status', rollbackError)
    }
    throw broadcastError
  }

  // Record transaction
  try {
    await withTransaction(async () => {
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Consolidated ${utxoIds.length} UTXOs (${totalInput} sats → ${outputSats} sats)`,
        ['consolidate']
      )
      await confirmUtxosSpent(utxosToSpend, txid)

      // Track consolidated UTXO immediately
      await addUTXO({
        txid: pendingTxid,
        vout: 0,
        satoshis: outputSats,
        lockingScript: new P2PKH().lock(address).toHex(),
        address,
        basket: 'default',
        spendable: true,
        createdAt: Date.now()
      })
    })
    walletLogger.info('Consolidation complete', { txid, inputCount: utxoIds.length, outputSats })
  } catch (error) {
    walletLogger.error('CRITICAL: Failed to record consolidation locally', error, { txid })
  }

  return { txid, outputSats, fee }
}
