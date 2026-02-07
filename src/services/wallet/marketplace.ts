/**
 * Marketplace operations
 * Listing and cancelling ordinal sales via js-1sat-ord OrdinalLock contracts
 */

import { PrivateKey, P2PKH } from '@bsv/sdk'
import { createOrdListings, cancelOrdListings } from 'js-1sat-ord'
import type { Utxo as OrdUtxo } from 'js-1sat-ord'
import type { UTXO } from './types'
import { broadcastTransaction } from './transactions'
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend
} from '../sync'
import { walletLogger } from '../logger'

const mpLogger = walletLogger

/**
 * Convert a Simply Sats UTXO to js-1sat-ord Utxo format.
 * js-1sat-ord expects base64-encoded locking scripts.
 * If the UTXO has no script, derive it from the private key.
 */
function toOrdUtxo(utxo: UTXO, pk?: PrivateKey): OrdUtxo {
  let scriptBase64: string

  if (utxo.script) {
    // Convert hex script to base64
    const bytes = new Uint8Array(utxo.script.length / 2)
    for (let i = 0; i < utxo.script.length; i += 2) {
      bytes[i / 2] = parseInt(utxo.script.substring(i, i + 2), 16)
    }
    scriptBase64 = btoa(String.fromCharCode(...bytes))
  } else if (pk) {
    // Derive P2PKH locking script from the private key
    const lockingScript = new P2PKH().lock(pk.toPublicKey().toAddress())
    const hexScript = lockingScript.toHex()
    const bytes = new Uint8Array(hexScript.length / 2)
    for (let i = 0; i < hexScript.length; i += 2) {
      bytes[i / 2] = parseInt(hexScript.substring(i, i + 2), 16)
    }
    scriptBase64 = btoa(String.fromCharCode(...bytes))
  } else {
    throw new Error('UTXO has no script and no private key to derive one')
  }

  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: scriptBase64,
  }
}

/**
 * List an ordinal for sale using an OrdinalLock smart contract.
 * Creates an on-chain lock that anyone can purchase by paying the specified price.
 *
 * @param ordWif - WIF private key for the ordinal address
 * @param ordinalUtxo - The 1-sat ordinal UTXO to list
 * @param paymentWif - WIF private key for fee payment
 * @param paymentUtxos - UTXOs available for paying the listing fee
 * @param payAddress - Address to receive payment when ordinal is purchased
 * @param ordAddress - Address to return ordinal to if listing is cancelled
 * @param priceSats - Listing price in satoshis
 * @returns Transaction ID of the listing
 */
export async function listOrdinal(
  ordWif: string,
  ordinalUtxo: UTXO,
  paymentWif: string,
  paymentUtxos: UTXO[],
  payAddress: string,
  ordAddress: string,
  priceSats: number
): Promise<string> {
  const ordPk = PrivateKey.fromWif(ordWif)
  const paymentPk = PrivateKey.fromWif(paymentWif)

  // Select up to 2 funding UTXOs (usually enough for listing fee)
  const fundingToUse = paymentUtxos.slice(0, 2)

  // UTXOs we'll be spending
  const utxosToSpend = [
    { txid: ordinalUtxo.txid, vout: ordinalUtxo.vout },
    ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))
  ]

  // Mark UTXOs as pending before building tx
  try {
    await markUtxosPendingSpend(utxosToSpend, 'listing-pending')
  } catch (error) {
    mpLogger.error('Failed to mark UTXOs as pending for listing', error)
    throw new Error('Failed to prepare listing - UTXOs could not be locked')
  }

  let txid: string
  try {
    const result = await createOrdListings({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      listings: [{
        payAddress,
        price: priceSats,
        listingUtxo: toOrdUtxo(ordinalUtxo, ordPk),
        ordAddress,
      }],
      ordPk,
      paymentPk,
    })

    // Broadcast the signed transaction
    txid = await broadcastTransaction(result.tx)
  } catch (err) {
    // Rollback pending status on failure
    try {
      await rollbackPendingSpend(utxosToSpend)
    } catch (rollbackErr) {
      mpLogger.error('CRITICAL: Failed to rollback pending status after listing failure', rollbackErr)
    }
    throw err
  }

  // Record the transaction locally
  try {
    await recordSentTransaction(
      txid,
      '',
      `Listed ordinal ${ordinalUtxo.txid.slice(0, 8)}... for ${priceSats} sats`,
      ['ordinal', 'listing']
    )
    await confirmUtxosSpent(utxosToSpend, txid)
  } catch (error) {
    mpLogger.warn('Failed to track listing locally', { error: String(error) })
  }

  mpLogger.info('Ordinal listed successfully', { txid, price: priceSats })
  return txid
}

/**
 * Cancel an ordinal listing by unlocking the OrdinalLock contract.
 * Returns the ordinal to the original ordinal address.
 *
 * @param ordWif - WIF private key for the ordinal address
 * @param listingUtxo - The UTXO of the listed ordinal (in the lock script)
 * @param paymentWif - WIF private key for fee payment
 * @param paymentUtxos - UTXOs available for paying the cancellation fee
 * @returns Transaction ID of the cancellation
 */
export async function cancelOrdinalListing(
  ordWif: string,
  listingUtxo: UTXO,
  paymentWif: string,
  paymentUtxos: UTXO[]
): Promise<string> {
  const ordPk = PrivateKey.fromWif(ordWif)
  const paymentPk = PrivateKey.fromWif(paymentWif)

  const fundingToUse = paymentUtxos.slice(0, 2)

  const utxosToSpend = [
    { txid: listingUtxo.txid, vout: listingUtxo.vout },
    ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))
  ]

  try {
    await markUtxosPendingSpend(utxosToSpend, 'cancel-listing-pending')
  } catch (error) {
    mpLogger.error('Failed to mark UTXOs as pending for cancellation', error)
    throw new Error('Failed to prepare cancellation - UTXOs could not be locked')
  }

  let txid: string
  try {
    const result = await cancelOrdListings({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      listingUtxos: [toOrdUtxo(listingUtxo)],
      ordPk,
      paymentPk,
    })

    txid = await broadcastTransaction(result.tx)
  } catch (err) {
    try {
      await rollbackPendingSpend(utxosToSpend)
    } catch (rollbackErr) {
      mpLogger.error('CRITICAL: Failed to rollback pending status after cancel failure', rollbackErr)
    }
    throw err
  }

  try {
    await recordSentTransaction(
      txid,
      '',
      `Cancelled listing for ordinal ${listingUtxo.txid.slice(0, 8)}...`,
      ['ordinal', 'cancel-listing']
    )
    await confirmUtxosSpent(utxosToSpend, txid)
  } catch (error) {
    mpLogger.warn('Failed to track cancellation locally', { error: String(error) })
  }

  mpLogger.info('Ordinal listing cancelled', { txid })
  return txid
}
