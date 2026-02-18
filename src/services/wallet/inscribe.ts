/**
 * Ordinal inscription creation
 * Creates new 1Sat Ordinals on-chain via js-1sat-ord createOrdinals
 */

import { PrivateKey, P2PKH, type Transaction } from '@bsv/sdk'
// js-1sat-ord bundles its own @bsv/sdk with different class declarations.
// Cast through unknown at the type boundary — runtime types are compatible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrivateKey = any
import { createOrdinals } from 'js-1sat-ord'
import type { Utxo as OrdUtxo } from 'js-1sat-ord'
import type { UTXO } from './types'
import { broadcastTransaction } from './transactions'
import {
  recordSentTransaction,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
} from '../sync'
import { walletLogger } from '../logger'

const inscribeLogger = walletLogger

const MAX_INSCRIPTION_BYTES = 100 * 1024 // 100 KB

/**
 * Safe base64 encoder for Uint8Array that avoids spread-argument RangeError
 * on large files (btoa(String.fromCharCode(...bytes)) hits call stack limits).
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

/**
 * Convert a Simply Sats UTXO to js-1sat-ord Utxo format.
 * js-1sat-ord expects base64-encoded locking scripts.
 */
function toOrdUtxo(utxo: UTXO, pk: PrivateKey): OrdUtxo {
  let scriptBase64: string

  if (utxo.script) {
    const bytes = new Uint8Array(utxo.script.length / 2)
    for (let i = 0; i < utxo.script.length; i += 2) {
      bytes[i / 2] = parseInt(utxo.script.substring(i, i + 2), 16)
    }
    scriptBase64 = uint8ArrayToBase64(bytes)
  } else {
    const lockingScript = new P2PKH().lock(pk.toPublicKey().toAddress())
    const hexScript = lockingScript.toHex()
    const bytes = new Uint8Array(hexScript.length / 2)
    for (let i = 0; i < hexScript.length; i += 2) {
      bytes[i / 2] = parseInt(hexScript.substring(i, i + 2), 16)
    }
    scriptBase64 = uint8ArrayToBase64(bytes)
  }

  return {
    txid: utxo.txid,
    vout: utxo.vout,
    satoshis: utxo.satoshis,
    script: scriptBase64,
  }
}

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

/**
 * Build and broadcast a 1Sat Ordinal inscription transaction.
 *
 * Follows the same pattern as listOrdinal in marketplace.ts:
 * mark UTXOs pending → build tx → broadcast → rollback on failure → record locally
 *
 * @returns Transaction ID of the inscription
 */
export async function buildInscriptionTx(params: InscribeParams): Promise<string> {
  const { paymentWif, paymentUtxos, content, contentType, destinationAddress } = params

  if (paymentUtxos.length === 0) {
    throw new Error('No funding UTXOs provided for inscription fee')
  }

  if (content.byteLength > MAX_INSCRIPTION_BYTES) {
    throw new Error(`Content exceeds maximum inscription size of ${MAX_INSCRIPTION_BYTES / 1024} KB`)
  }

  const paymentPk = PrivateKey.fromWif(paymentWif)

  // Use up to 3 funding UTXOs (inscriptions can be larger txs)
  const fundingToUse = paymentUtxos.slice(0, 3)
  const utxosToSpend = fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))

  const pendingResult = await markUtxosPendingSpend(utxosToSpend, 'inscribe-pending')
  if (!pendingResult.ok) {
    throw new Error(`Failed to mark UTXOs pending: ${pendingResult.error.message}`)
  }

  let txid: string
  try {
    // Convert content bytes to base64 for js-1sat-ord
    const contentBase64 = uint8ArrayToBase64(content)

    const result = await createOrdinals({
      utxos: fundingToUse.map(u => toOrdUtxo(u, paymentPk)),
      destinations: [{
        address: destinationAddress,
        inscription: {
          dataB64: contentBase64,
          contentType,
        },
      }],
      paymentPk: paymentPk as AnyPrivateKey,
      changeAddress: paymentPk.toPublicKey().toAddress(),
    })

    txid = await broadcastTransaction(result.tx as unknown as Transaction)
  } catch (err) {
    try { await rollbackPendingSpend(utxosToSpend) } catch (_rollbackErr) {
      inscribeLogger.error('CRITICAL: Failed to rollback pending status after inscription failure', _rollbackErr)
    }
    throw err
  }

  try {
    await recordSentTransaction(
      txid,
      '',
      `Inscribed ${contentType} ordinal`,
      ['ordinal', 'inscribe']
    )
    const confirmResult = await confirmUtxosSpent(utxosToSpend, txid)
    if (!confirmResult.ok) {
      inscribeLogger.warn('Failed to confirm UTXOs spent for inscription', { txid, error: confirmResult.error.message })
    }
  } catch (err) {
    inscribeLogger.warn('Failed to record inscription locally', { error: String(err) })
  }

  inscribeLogger.info('Ordinal inscribed successfully', { txid, contentType })
  return txid
}
