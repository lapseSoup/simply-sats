/**
 * PaymentService -- BRC-29 authenticated P2PKH payments and BRC-105 micropayments.
 *
 * BRC-29: Derives per-payment public keys using BRC-42 key derivation with
 *         random derivation prefix/suffix values, producing unique P2PKH
 *         outputs for each payment.
 *
 * BRC-105: Handles HTTP 402 Payment Required flows where a server requests
 *          micropayment via response headers and the client retries with
 *          payment headers attached.
 *
 * @module services/brc/payments
 */

import type { TauriProtoWallet } from './adapter'
import type { WalletProtocol } from '@bsv/sdk'
import { BRC } from '../../config'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default BRC-29 protocol ID matching the SDK's Brc29RemittanceModule default. */
const BRC29_PROTOCOL_ID: WalletProtocol = [2, '3241645161d8']

// ---------------------------------------------------------------------------
// PaymentService
// ---------------------------------------------------------------------------

export class PaymentService {
  private wallet: TauriProtoWallet
  private autoPayThreshold: number

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet
    this.autoPayThreshold = BRC.MICROPAYMENT_AUTO_PAY_THRESHOLD
  }

  /**
   * Generate a random derivation prefix for BRC-29 payments.
   *
   * Returns a 32-character hex string (128 bits of randomness).
   */
  generateDerivationPrefix(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * Derive a per-payment public key using BRC-42 (BRC-29 protocol).
   *
   * The keyID is constructed as `${derivationPrefix} ${derivationSuffix}`
   * matching the SDK's Brc29RemittanceModule convention.
   */
  async derivePaymentKey(args: {
    senderPublicKey: string
    derivationPrefix: string
    derivationSuffix: string
    protocolID?: WalletProtocol
  }): Promise<{ publicKey: string }> {
    const keyID = `${args.derivationPrefix} ${args.derivationSuffix}`
    return this.wallet.getPublicKey({
      counterparty: args.senderPublicKey,
      protocolID: args.protocolID ?? BRC29_PROTOCOL_ID,
      keyID,
    })
  }

  /**
   * Check if a micropayment should be auto-approved (BRC-105).
   *
   * Returns false if MICROPAYMENT_REQUIRE_CONFIRMATION is enabled,
   * otherwise checks against the auto-pay threshold.
   */
  shouldAutoPayMicropayment(satoshis: number): boolean {
    if (BRC.MICROPAYMENT_REQUIRE_CONFIRMATION) return false
    return satoshis <= this.autoPayThreshold
  }

  /**
   * Parse a 402 Payment Required response headers (BRC-105).
   *
   * Extracts the required satoshis and derivation prefix from the
   * `x-bsv-payment-satoshis-required` and `x-bsv-payment-derivation-prefix`
   * headers. Returns null if either header is missing.
   */
  parse402Response(headers: Headers): {
    satoshisRequired: number
    derivationPrefix: string
  } | null {
    const satoshis = headers.get('x-bsv-payment-satoshis-required')
    const prefix = headers.get('x-bsv-payment-derivation-prefix')
    if (!satoshis || !prefix) return null
    const parsed = parseInt(satoshis, 10)
    if (isNaN(parsed) || parsed <= 0) return null
    return {
      satoshisRequired: parsed,
      derivationPrefix: prefix,
    }
  }

  /**
   * Create payment headers for a 402 retry (BRC-105).
   *
   * Returns a record with the `x-bsv-payment` header containing a JSON
   * payload with derivation info and the transaction.
   */
  createPaymentHeaders(args: {
    derivationPrefix: string
    derivationSuffix: string
    transaction: string
  }): Record<string, string> {
    return {
      'x-bsv-payment': JSON.stringify({
        derivationPrefix: args.derivationPrefix,
        derivationSuffix: args.derivationSuffix,
        transaction: args.transaction,
      }),
    }
  }
}
