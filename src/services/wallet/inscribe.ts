/**
 * Ordinal inscription creation
 * Creates new 1Sat Ordinals on-chain via Rust backend inscription builder.
 *
 * Transaction building and signing happen entirely in Rust — private keys
 * never enter the JavaScript heap.
 */

import { isTauri, tauriInvoke } from '../../utils/tauri'
import type { UTXO } from './types'

export interface InscribeParams {
  /** WIF for the payment/funding key */
  paymentWif: string
  /** UTXOs available to cover the inscription fee */
  paymentUtxos: UTXO[]
  /** Raw bytes of the content to inscribe */
  content: Uint8Array
  /** MIME type of the content, e.g. 'image/png' */
  contentType: string
  /** BSV address that will receive the minted ordinal */
  destinationAddress: string
}

export interface InscriptionResult {
  rawTx: string
  txid: string
  fee: number
  change: number
  changeAddress: string
  spentOutpoints: Array<{ txid: string; vout: number }>
}

/**
 * Build a 1Sat Ordinal inscription transaction.
 *
 * Delegates to the Rust `build_inscription_tx` Tauri command which creates
 * a transaction with an inscription envelope (OP_FALSE OP_IF ... OP_ENDIF)
 * followed by a standard P2PKH locking script.
 *
 * @returns Transaction ID of the inscription
 */
export async function buildInscriptionTx(params: InscribeParams): Promise<string> {
  if (!isTauri()) {
    throw new Error('Inscription building requires Tauri runtime')
  }

  const result = await tauriInvoke<InscriptionResult>('build_inscription_tx', {
    wif: params.paymentWif,
    content: Array.from(params.content), // Vec<u8> in Rust
    contentType: params.contentType,
    destAddress: params.destinationAddress,
    fundingUtxos: params.paymentUtxos.map(u => ({
      txid: u.txid,
      vout: u.vout,
      satoshis: u.satoshis,
      script: u.script ?? ''
    })),
    feeRate: 0.05
  })

  return result.txid
}
