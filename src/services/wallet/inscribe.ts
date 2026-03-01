/**
 * Ordinal inscription creation
 * Creates new 1Sat Ordinals on-chain via js-1sat-ord createOrdinals
 *
 * STUB: @bsv/sdk and js-1sat-ord dependencies removed as part of migration to
 * Rust backend (Phase 4). All functions throw at runtime with clear messages.
 */

export interface InscribeParams {
  /** WIF for the payment/funding key */
  paymentWif: string
  /** UTXOs available to cover the inscription fee */
  paymentUtxos: import('./types').UTXO[]
  /** Raw bytes of the content to inscribe */
  content: Uint8Array
  /** MIME type of the content, e.g. 'image/png' */
  contentType: string
  /** BSV address that will receive the minted ordinal */
  destinationAddress: string
}

/**
 * Build and broadcast a 1Sat Ordinal inscription transaction.
 *
 * Follows the same pattern as listOrdinal in marketplace.ts:
 * mark UTXOs pending -> build tx -> broadcast -> rollback on failure -> record locally
 *
 * @returns Transaction ID of the inscription
 */
export async function buildInscriptionTx(_params: InscribeParams): Promise<string> {
  throw new Error('buildInscriptionTx is not yet available — migrating to Rust implementation')
}
