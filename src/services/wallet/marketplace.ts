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
import { isValidBSVAddress } from '../../domain/wallet/validation'

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

// S-70: Validate price parameter for marketplace operations
function validatePrice(priceSats: number): string | null {
  if (!Number.isFinite(priceSats) || priceSats <= 0 || !Number.isInteger(priceSats)) {
    return 'Invalid price: must be a positive integer in satoshis'
  }
  return null
}

/**
 * List an ordinal for sale using an OrdinalLock smart contract.
 * Creates an on-chain lock that anyone can purchase by paying the specified price.
 *
 * @param ordinalUtxo - The 1-sat ordinal UTXO to list
 * @param paymentUtxos - UTXOs available for paying the listing fee
 * @param payAddress - Address to receive payment when ordinal is purchased
 * @param ordAddress - Address to return ordinal to if listing is cancelled
 * @param priceSats - Listing price in satoshis
 * @returns Result with the transaction ID on success
 */
export async function listOrdinal(
  ordinalUtxo: UTXO,
  paymentUtxos: UTXO[],
  payAddress: string,
  ordAddress: string,
  priceSats: number,
): Promise<Result<string, string>> {
  if (!isTauri()) return err('Marketplace requires Tauri runtime')

  // S-64: Validate addresses before sending to Rust backend
  if (!isValidBSVAddress(payAddress)) return err('Invalid payment address')
  if (!isValidBSVAddress(ordAddress)) return err('Invalid ordinal address')

  // S-70: Validate price
  const priceError = validatePrice(priceSats)
  if (priceError) return err(priceError)

  try {
    const result = await tauriInvoke<BuiltTxResult>('create_ordinal_listing_from_store', {
      ordinalUtxo: toUtxoInput(ordinalUtxo),
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
 * @param listingUtxo - The UTXO of the listed ordinal (in the lock script)
 * @param paymentUtxos - UTXOs available for paying the cancellation fee
 * @returns Result with the transaction ID on success
 */
export async function cancelOrdinalListing(
  listingUtxo: UTXO,
  paymentUtxos: UTXO[],
): Promise<Result<string, string>> {
  if (!isTauri()) return err('Marketplace requires Tauri runtime')

  try {
    const result = await tauriInvoke<BuiltTxResult>('cancel_ordinal_listing_from_store', {
      listingUtxo: toUtxoInput(listingUtxo),
      paymentUtxos: paymentUtxos.map(toUtxoInput),
    })
    return ok(result.txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Cancellation failed')
  }
}

/**
 * Purchase a listed ordinal by satisfying the OrdinalLock contract.
 * The caller must supply the `payout` field (base64-encoded payment output
 * script) that was embedded in the listing transaction -- this is the
 * counterpart to the seller's `payAddress` and `price` encoded on-chain.
 *
 * @param params.paymentUtxos  - UTXOs available for paying the purchase price + fees
 * @param params.ordAddress    - Address to receive the purchased ordinal
 * @param params.listingUtxo   - The UTXO of the listed ordinal (the locked 1-sat output)
 * @param params.payout        - Base64-encoded payment output script from the listing tx
 * @param params.priceSats     - Expected price in satoshis (used to validate funding)
 * @returns Result with the transaction ID on success
 */
export async function purchaseOrdinal(params: {
  paymentUtxos: UTXO[]
  ordAddress: string
  listingUtxo: UTXO
  payout: string
  priceSats: number
}): Promise<Result<string, string>> {
  if (!isTauri()) return err('Marketplace requires Tauri runtime')

  // S-64: Validate ordinal destination address
  if (!isValidBSVAddress(params.ordAddress)) return err('Invalid ordinal destination address')

  // S-70: Validate price
  const priceError = validatePrice(params.priceSats)
  if (priceError) return err(priceError)

  try {
    const result = await tauriInvoke<BuiltTxResult>('purchase_ordinal_from_store', {
      paymentUtxos: params.paymentUtxos.map(toUtxoInput),
      ordAddress: params.ordAddress,
      listingUtxo: toUtxoInput(params.listingUtxo),
      payout: params.payout,
      priceSats: params.priceSats,
    })
    return ok(result.txid)
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Purchase failed')
  }
}
