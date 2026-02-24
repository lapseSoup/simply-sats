/**
 * Marketplace operations
 * Listing and cancelling ordinal sales via js-1sat-ord OrdinalLock contracts
 */

import { PrivateKey, P2PKH, type Transaction } from '@bsv/sdk'
import { createOrdListings, cancelOrdListings } from 'js-1sat-ord'
import type { Utxo as OrdUtxo } from 'js-1sat-ord'
import type { UTXO } from './types'
import { broadcastTransaction } from './transactions'

// js-1sat-ord bundles its own @bsv/sdk with different class declarations.
// We cast through unknown at the type boundary since the runtime types are compatible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrivateKey = any
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend
} from '../sync'
import { walletLogger } from '../logger'
import { type Result, ok, err } from '../../domain/types'

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
): Promise<Result<string, string>> {
  try {
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
    const pendingResult1 = await markUtxosPendingSpend(utxosToSpend, 'listing-pending')
    if (!pendingResult1.ok) {
      return err(`Failed to mark UTXOs pending: ${pendingResult1.error.message}`)
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
        ordPk: ordPk as AnyPrivateKey,
        paymentPk: paymentPk as AnyPrivateKey,
      })

      // Broadcast the signed transaction
      txid = await broadcastTransaction(result.tx as unknown as Transaction)
    } catch (buildErr) {
      // Rollback pending status on failure
      try {
        await rollbackPendingSpend(utxosToSpend)
      } catch (rollbackErr) {
        mpLogger.error('CRITICAL: Failed to rollback pending status after listing failure', rollbackErr)
      }
      return err(buildErr instanceof Error ? buildErr.message : 'Listing failed')
    }

    // Record the transaction locally
    try {
      await recordSentTransaction(
        txid,
        '',
        `Listed ordinal ${ordinalUtxo.txid.slice(0, 8)}... for ${priceSats} sats`,
        ['ordinal', 'listing']
      )
      const confirmResult1 = await confirmUtxosSpent(utxosToSpend, txid)
      if (!confirmResult1.ok) {
        mpLogger.warn('Failed to confirm UTXOs spent for listing', { txid, error: confirmResult1.error.message })
      }
    } catch (error) {
      mpLogger.warn('Failed to track listing locally', { error: String(error) })
    }

    mpLogger.info('Ordinal listed successfully', { txid, price: priceSats })
    return ok(txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
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
    const pendingResult2 = await markUtxosPendingSpend(utxosToSpend, 'cancel-listing-pending')
    if (!pendingResult2.ok) {
      throw new Error(`Failed to mark UTXOs pending for cancel: ${pendingResult2.error.message}`)
    }
  } catch (error) {
    mpLogger.error('Failed to mark UTXOs as pending for cancellation', error)
    throw new Error('Failed to prepare cancellation - UTXOs could not be locked')
  }

  let txid: string
  try {
    const result = await cancelOrdListings({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      listingUtxos: [toOrdUtxo(listingUtxo)],
      ordPk: ordPk as AnyPrivateKey,
      paymentPk: paymentPk as AnyPrivateKey,
    })

    txid = await broadcastTransaction(result.tx as unknown as Transaction)
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
    const confirmResult2 = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult2.ok) {
      mpLogger.warn('Failed to confirm UTXOs spent for cancel listing', { txid, error: confirmResult2.error.message })
    }
  } catch (error) {
    mpLogger.warn('Failed to track cancellation locally', { error: String(error) })
  }

  mpLogger.info('Ordinal listing cancelled', { txid })
  return txid
}

/**
 * Purchase a listed ordinal by satisfying the OrdinalLock contract.
 * The caller must supply the `payout` field (base64-encoded payment output
 * script) that was embedded in the listing transaction — this is the
 * counterpart to the seller's `payAddress` and `price` encoded on-chain.
 *
 * @param paymentWif    - WIF private key for the funding address
 * @param paymentUtxos  - UTXOs available for paying the purchase price + fees
 * @param ordAddress    - Address to receive the purchased ordinal
 * @param listingUtxo   - The UTXO of the listed ordinal (the locked 1-sat output)
 * @param payout        - Base64-encoded payment output script from the listing tx
 * @param priceSats     - Expected price in satoshis (used to validate funding)
 * @returns Transaction ID of the purchase
 */
export async function purchaseOrdinal(params: {
  paymentWif: string
  paymentUtxos: UTXO[]
  ordAddress: string
  listingUtxo: UTXO
  payout: string
  priceSats: number
}): Promise<string> {
  const { paymentWif, paymentUtxos, ordAddress, listingUtxo, payout, priceSats } = params

  if (paymentUtxos.length === 0) {
    throw new Error('No payment UTXOs available to purchase ordinal')
  }

  const { purchaseOrdListing } = await import('js-1sat-ord')
  const paymentPk = PrivateKey.fromWif(paymentWif)

  const fundingToUse = paymentUtxos.slice(0, 3)
  const totalFunding = fundingToUse.reduce((s, u) => s + u.satoshis, 0)
  if (totalFunding < priceSats) {
    throw new Error(`Insufficient funds: need at least ${priceSats} sats, have ${totalFunding}`)
  }

  const utxosToSpend = [
    { txid: listingUtxo.txid, vout: listingUtxo.vout },
    ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout })),
  ]

  const pendingResult = await markUtxosPendingSpend(utxosToSpend, 'purchase-pending')
  if (!pendingResult.ok) {
    throw new Error(`Failed to mark UTXOs pending: ${pendingResult.error.message}`)
  }

  let txid: string
  try {
    const result = await purchaseOrdListing({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      listing: {
        payout,
        listingUtxo: toOrdUtxo(listingUtxo),
      },
      ordAddress,
      paymentPk: paymentPk as AnyPrivateKey,
      changeAddress: paymentPk.toPublicKey().toAddress(),
    })
    txid = await broadcastTransaction(result.tx as unknown as Transaction)
  } catch (err) {
    try { await rollbackPendingSpend(utxosToSpend) } catch { /* best-effort */ }
    throw err
  }

  try {
    await recordSentTransaction(
      txid,
      '',
      `Purchased ordinal ${listingUtxo.txid.slice(0, 8)}... for ${priceSats} sats`,
      ['ordinal', 'purchase']
    )
    const confirmResult = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult.ok) {
      mpLogger.warn('Failed to confirm UTXOs spent after purchase', { txid, error: confirmResult.error.message })
    }
  } catch (err) {
    mpLogger.warn('Failed to record purchase locally', { error: String(err) })
  }

  mpLogger.info('Ordinal purchased successfully', { txid, price: priceSats })
  return txid
}
