/**
 * Marketplace operations
 * Listing, cancelling, and purchasing ordinal sales via the Rust OrdinalLock contract
 *
 * All transaction building and signing is performed in the Tauri backend so
 * that private keys never enter the webview's JavaScript heap.
 */

import { isTauri, tauriInvoke } from '../../utils/tauri'
import type { UTXO } from './types'
import { type Result, ok, err } from '../../domain/types'

/** Shape returned by the Rust BuiltTransactionResult (camelCase via serde). */
interface BuiltTxResult {
  rawTx: string
  txid: string
  fee: number
  change: number
  changeAddress: string
  spentOutpoints: { txid: string; vout: number }[]
}

/** Map a UTXO to the shape expected by the Rust UtxoInput struct. */
function toUtxoInput(u: UTXO) {
  return { txid: u.txid, vout: u.vout, satoshis: u.satoshis, script: u.script ?? '' }
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
 * @returns Result with the transaction ID on success
 */
export async function listOrdinal(
  ordWif: string,
  ordinalUtxo: UTXO,
  paymentWif: string,
  paymentUtxos: UTXO[],
  payAddress: string,
  ordAddress: string,
  priceSats: number,
): Promise<Result<string, string>> {
  if (!isTauri()) return err('Marketplace requires Tauri runtime')

  try {
    const result = await tauriInvoke<BuiltTxResult>('create_ordinal_listing', {
      ordWif,
      ordinalUtxo: toUtxoInput(ordinalUtxo),
      paymentWif,
      paymentUtxos: paymentUtxos.map(toUtxoInput),
      payAddress,
      ordAddress,
      priceSats,
    })
    return ok(result.txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Listing failed')
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
  paymentUtxos: UTXO[],
): Promise<string> {
  if (!isTauri()) throw new Error('Marketplace requires Tauri runtime')

  const result = await tauriInvoke<BuiltTxResult>('cancel_ordinal_listing', {
    ordWif,
    listingUtxo: toUtxoInput(listingUtxo),
    paymentWif,
    paymentUtxos: paymentUtxos.map(toUtxoInput),
  })
  return result.txid
}

/**
 * Purchase a listed ordinal by satisfying the OrdinalLock contract.
 * The caller must supply the `payout` field (base64-encoded payment output
 * script) that was embedded in the listing transaction -- this is the
 * counterpart to the seller's `payAddress` and `price` encoded on-chain.
 *
 * @param params.paymentWif    - WIF private key for the funding address
 * @param params.paymentUtxos  - UTXOs available for paying the purchase price + fees
 * @param params.ordAddress    - Address to receive the purchased ordinal
 * @param params.listingUtxo   - The UTXO of the listed ordinal (the locked 1-sat output)
 * @param params.payout        - Base64-encoded payment output script from the listing tx
 * @param params.priceSats     - Expected price in satoshis (used to validate funding)
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
  if (!isTauri()) throw new Error('Marketplace requires Tauri runtime')

  const result = await tauriInvoke<BuiltTxResult>('purchase_ordinal', {
    paymentWif: params.paymentWif,
    paymentUtxos: params.paymentUtxos.map(toUtxoInput),
    ordAddress: params.ordAddress,
    listingUtxo: toUtxoInput(params.listingUtxo),
    payout: params.payout,
    priceSats: params.priceSats,
  })
  return result.txid
}
