/**
 * Marketplace operations
 * Listing and cancelling ordinal sales via js-1sat-ord OrdinalLock contracts
 *
 * STUB: @bsv/sdk and js-1sat-ord dependencies removed as part of migration to
 * Rust backend (Phase 4). All functions throw at runtime with clear messages.
 */

import type { UTXO } from './types'
import { type Result } from '../../domain/types'

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
  _ordWif: string,
  _ordinalUtxo: UTXO,
  _paymentWif: string,
  _paymentUtxos: UTXO[],
  _payAddress: string,
  _ordAddress: string,
  _priceSats: number
): Promise<Result<string, string>> {
  throw new Error('listOrdinal is not yet available — migrating to Rust implementation')
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
  _ordWif: string,
  _listingUtxo: UTXO,
  _paymentWif: string,
  _paymentUtxos: UTXO[]
): Promise<string> {
  throw new Error('cancelOrdinalListing is not yet available — migrating to Rust implementation')
}

/**
 * Purchase a listed ordinal by satisfying the OrdinalLock contract.
 * The caller must supply the `payout` field (base64-encoded payment output
 * script) that was embedded in the listing transaction — this is the
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
export async function purchaseOrdinal(_params: {
  paymentWif: string
  paymentUtxos: UTXO[]
  ordAddress: string
  listingUtxo: UTXO
  payout: string
  priceSats: number
}): Promise<string> {
  throw new Error('purchaseOrdinal is not yet available — migrating to Rust implementation')
}
