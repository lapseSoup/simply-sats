/**
 * Marketplace operations
 * Listing and cancelling ordinal sales via js-1sat-ord OrdinalLock contracts
 */

import { PrivateKey, P2PKH, type Transaction } from '@bsv/sdk'
import { createOrdListings, cancelOrdListings } from 'js-1sat-ord'
import type { Utxo as OrdUtxo } from 'js-1sat-ord'
import type { UTXO } from './types'
import { broadcastTransaction } from './transactions'

// js-1sat-ord bundles its own @bsv/sdk with nominally different PrivateKey types.
// At runtime the instances are identical. We cast via this alias to keep the
// eslint-disable scoped to a single line rather than every call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrdPrivateKey = any
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend
} from '../sync'
import { walletLogger } from '../logger'
import { type Result, ok, err } from '../../domain/types'
import { isValidBSVAddress } from '../../domain/wallet/validation'

const mpLogger = walletLogger

/** Convert a hex string to a base64 string */
function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Convert a Simply Sats UTXO to js-1sat-ord Utxo format.
 * js-1sat-ord expects base64-encoded locking scripts.
 * If the UTXO has no script, derive it from the private key.
 */
function toOrdUtxo(utxo: UTXO, pk?: PrivateKey): OrdUtxo {
  let scriptBase64: string

  if (utxo.script) {
    scriptBase64 = hexToBase64(utxo.script)
  } else if (pk) {
    const lockingScript = new P2PKH().lock(pk.toPublicKey().toAddress())
    scriptBase64 = hexToBase64(lockingScript.toHex())
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
  // S-64: Validate addresses — invalid payAddress means sale proceeds are permanently lost
  if (!isValidBSVAddress(payAddress)) {
    return err(`Invalid pay address: ${payAddress}`)
  }
  if (!isValidBSVAddress(ordAddress)) {
    return err(`Invalid ordinal return address: ${ordAddress}`)
  }
  // S-70: Validate price — 0, NaN, or excessive prices allowed through would cause issues
  if (!Number.isFinite(priceSats) || priceSats <= 0 || !Number.isInteger(priceSats)) {
    return err(`Invalid price: ${priceSats} (must be a positive integer)`)
  }

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
        ordPk: ordPk as OrdPrivateKey,
        paymentPk: paymentPk as OrdPrivateKey,
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
): Promise<Result<string, string>> {
  try {
    const ordPk = PrivateKey.fromWif(ordWif)
    const paymentPk = PrivateKey.fromWif(paymentWif)

    const fundingToUse = paymentUtxos.slice(0, 2)

    const utxosToSpend = [
      { txid: listingUtxo.txid, vout: listingUtxo.vout },
      ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))
    ]

    const pendingResult2 = await markUtxosPendingSpend(utxosToSpend, 'cancel-listing-pending')
    if (!pendingResult2.ok) {
      return err(`Failed to mark UTXOs pending for cancel: ${pendingResult2.error.message}`)
    }

    let txid: string
    try {
      const result = await cancelOrdListings({
        utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
        listingUtxos: [toOrdUtxo(listingUtxo, ordPk)],
        ordPk: ordPk as OrdPrivateKey,
        paymentPk: paymentPk as OrdPrivateKey,
      })

      txid = await broadcastTransaction(result.tx as unknown as Transaction)
    } catch (buildErr) {
      // B-56: Log rollback failures explicitly
      try {
        await rollbackPendingSpend(utxosToSpend)
      } catch (rollbackErr) {
        mpLogger.error('CRITICAL: Failed to rollback pending status after cancel failure', rollbackErr)
      }
      return err(buildErr instanceof Error ? buildErr.message : 'Cancel listing failed')
    }

    // B-58: Log post-broadcast DB errors instead of silently swallowing
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
      mpLogger.error('Post-broadcast DB error in cancelOrdinalListing — tx is on-chain but not tracked locally', { txid, error: String(error) })
    }

    mpLogger.info('Ordinal listing cancelled', { txid })
    return ok(txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
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
}): Promise<Result<string, string>> {
  const { paymentWif, paymentUtxos, ordAddress, listingUtxo, payout, priceSats } = params

  // S-64: Validate ordinal receive address
  if (!isValidBSVAddress(ordAddress)) {
    return err(`Invalid ordinal receive address: ${ordAddress}`)
  }
  // S-70: Validate price
  if (!Number.isFinite(priceSats) || priceSats <= 0 || !Number.isInteger(priceSats)) {
    return err(`Invalid price: ${priceSats} (must be a positive integer)`)
  }

  if (paymentUtxos.length === 0) {
    return err('No payment UTXOs available to purchase ordinal')
  }

  try {
    const { purchaseOrdListing } = await import('js-1sat-ord')
    const paymentPk = PrivateKey.fromWif(paymentWif)

    const fundingToUse = paymentUtxos.slice(0, 3)
    const totalFunding = fundingToUse.reduce((s, u) => s + u.satoshis, 0)
    if (totalFunding < priceSats) {
      return err(`Insufficient funds: need at least ${priceSats} sats, have ${totalFunding}`)
    }

    const utxosToSpend = [
      { txid: listingUtxo.txid, vout: listingUtxo.vout },
      ...fundingToUse.map(u => ({ txid: u.txid, vout: u.vout })),
    ]

    const pendingResult = await markUtxosPendingSpend(utxosToSpend, 'purchase-pending')
    if (!pendingResult.ok) {
      return err(`Failed to mark UTXOs pending: ${pendingResult.error.message}`)
    }

    let txid: string
    try {
      const result = await purchaseOrdListing({
        utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
        listing: {
          payout,
          listingUtxo: toOrdUtxo(listingUtxo, paymentPk),
        },
        ordAddress,
        paymentPk: paymentPk as OrdPrivateKey,
        changeAddress: paymentPk.toPublicKey().toAddress(),
      })
      txid = await broadcastTransaction(result.tx as unknown as Transaction)
    } catch (buildErr) {
      // B-56: Log rollback failures explicitly instead of silent catch
      try {
        await rollbackPendingSpend(utxosToSpend)
      } catch (rollbackErr) {
        mpLogger.error('CRITICAL: Failed to rollback pending status after purchase failure', rollbackErr)
      }
      return err(buildErr instanceof Error ? buildErr.message : 'Purchase failed')
    }

    // B-58: Log post-broadcast DB errors instead of silently swallowing
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
    } catch (dbErr) {
      mpLogger.error('Post-broadcast DB error in purchaseOrdinal — tx is on-chain but not tracked locally', { txid, error: String(dbErr) })
    }

    mpLogger.info('Ordinal purchased successfully', { txid, price: priceSats })
    return ok(txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}
