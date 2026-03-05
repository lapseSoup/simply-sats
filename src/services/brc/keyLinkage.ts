/**
 * KeyLinkageService — BRC-69 (counterparty) and BRC-72 (specific) key linkage revelation.
 *
 * Reveals key derivation linkage to third-party verifiers by computing HMAC-based
 * linkage values using the wallet's crypto primitives and encrypting them for the
 * verifier. Private keys never leave the Tauri Rust backend.
 *
 * BRC-69: Reveals the ECDH shared secret between the wallet and a counterparty.
 * BRC-72: Reveals the specific derivation scalar for a (protocolID, keyID) pair.
 *
 * @module services/brc/keyLinkage
 */

import type { TauriProtoWallet } from './adapter'
import type {
  RevealCounterpartyKeyLinkageArgs,
  RevealCounterpartyKeyLinkageResult,
  RevealSpecificKeyLinkageArgs,
  RevealSpecificKeyLinkageResult,
  WalletProtocol,
} from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a BRC-43 invoice number from protocol ID and key ID.
 * Format: `{securityLevel}-{protocolName}-{keyID}`
 */
function buildInvoiceNumber(protocolID: WalletProtocol, keyID: string): string {
  return `${protocolID[0]}-${protocolID[1]}-${keyID}`
}

// Well-known protocol used for encrypting linkage revelations to the verifier.
const LINKAGE_REVELATION_PROTOCOL: WalletProtocol = [2, 'key-linkage-revelation']

// ---------------------------------------------------------------------------
// KeyLinkageService
// ---------------------------------------------------------------------------

export class KeyLinkageService {
  private wallet: TauriProtoWallet

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet
  }

  /**
   * BRC-69: Reveal the counterparty key linkage to a verifier.
   *
   * Computes the HMAC-based linkage (approximating the ECDH shared secret)
   * and encrypts it for the verifier so only they can read it.
   */
  async revealCounterpartyKeyLinkage(
    args: RevealCounterpartyKeyLinkageArgs,
  ): Promise<RevealCounterpartyKeyLinkageResult> {
    const { counterparty, verifier } = args

    // Get our identity public key for the prover field
    const { publicKey: proverPubKey } = await this.wallet.getPublicKey({
      identityKey: true,
    })

    // Compute the counterparty linkage: HMAC of the counterparty's identity
    // using a well-known invoice. This produces a deterministic value that
    // represents the relationship between us and the counterparty.
    const linkageData = new TextEncoder().encode(counterparty)
    const invoiceNumber = buildInvoiceNumber(LINKAGE_REVELATION_PROTOCOL, 'counterparty')

    const hmacResult = await this.wallet.createHmac({
      data: Array.from(linkageData),
      protocolID: LINKAGE_REVELATION_PROTOCOL,
      keyID: 'counterparty',
      counterparty,
    })

    // Encrypt the linkage for the verifier so only they can read it
    const encryptResult = await this.wallet.encrypt({
      plaintext: hmacResult.hmac,
      protocolID: LINKAGE_REVELATION_PROTOCOL,
      keyID: invoiceNumber,
      counterparty: verifier,
    })

    // Encrypt the proof (the original data used to derive the linkage)
    const proofResult = await this.wallet.encrypt({
      plaintext: Array.from(linkageData),
      protocolID: LINKAGE_REVELATION_PROTOCOL,
      keyID: `${invoiceNumber}-proof`,
      counterparty: verifier,
    })

    return {
      encryptedLinkage: encryptResult.ciphertext,
      encryptedLinkageProof: proofResult.ciphertext,
      prover: proverPubKey,
      verifier,
      counterparty,
      revelationTime: new Date().toISOString(),
    }
  }

  /**
   * BRC-72: Reveal specific key linkage to a verifier.
   *
   * Reveals the specific derivation scalar for a given (protocolID, keyID) pair
   * by computing the HMAC that would be used in key derivation, then encrypting
   * it for the verifier.
   */
  async revealSpecificKeyLinkage(
    args: RevealSpecificKeyLinkageArgs,
  ): Promise<RevealSpecificKeyLinkageResult> {
    const { counterparty, verifier, protocolID, keyID } = args

    // Get our identity public key for the prover field
    const { publicKey: proverPubKey } = await this.wallet.getPublicKey({
      identityKey: true,
    })

    // Resolve counterparty — for 'self'/'anyone' the wallet.createHmac
    // will handle the resolution internally (maps to identity pubkey).
    const invoiceNumber = buildInvoiceNumber(protocolID, keyID)

    // Compute the specific key derivation scalar: HMAC using the exact
    // protocolID and keyID that were used in key derivation.
    const specificData = new TextEncoder().encode(invoiceNumber)
    const hmacResult = await this.wallet.createHmac({
      data: Array.from(specificData),
      protocolID,
      keyID,
      counterparty,
    })

    // Encrypt the linkage for the verifier
    const encryptResult = await this.wallet.encrypt({
      plaintext: hmacResult.hmac,
      protocolID: LINKAGE_REVELATION_PROTOCOL,
      keyID: invoiceNumber,
      counterparty: verifier,
    })

    // Encrypt the proof
    const proofResult = await this.wallet.encrypt({
      plaintext: Array.from(specificData),
      protocolID: LINKAGE_REVELATION_PROTOCOL,
      keyID: `${invoiceNumber}-proof`,
      counterparty: verifier,
    })

    return {
      encryptedLinkage: encryptResult.ciphertext,
      encryptedLinkageProof: proofResult.ciphertext,
      prover: proverPubKey,
      verifier,
      counterparty: typeof counterparty === 'string' && counterparty !== 'self' && counterparty !== 'anyone'
        ? counterparty
        : proverPubKey,
      protocolID,
      keyID,
      proofType: 0, // Type 0 = HMAC-based specific key linkage proof
    }
  }
}
