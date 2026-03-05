/**
 * BRC-103/104 Mutual Authentication Service.
 *
 * Provides authenticated HTTP communication with BRC-100 services by
 * signing request nonces with the wallet's identity key and verifying
 * incoming authentication headers.
 *
 * This is a simplified implementation that handles nonce-based auth
 * headers directly. Full AuthFetch integration (which requires the
 * complete WalletInterface, not just ProtoWallet) is planned for a
 * future task once TauriProtoWallet implements the remaining methods.
 *
 * @module services/brc/auth
 */

import type { TauriProtoWallet } from './adapter'
import type { WalletProtocol } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The BRC-103 protocol identifier used for signing auth nonces. */
const AUTH_PROTOCOL: WalletProtocol = [2, 'brc-103-auth']

/** The default key ID for auth signatures. */
const AUTH_KEY_ID = '1'

// ---------------------------------------------------------------------------
// Hex conversion helpers (kept local to avoid coupling to adapter internals)
// ---------------------------------------------------------------------------

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16))
  }
  return bytes
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {
  private wallet: TauriProtoWallet

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet
  }

  /** Get the wallet's identity public key for authentication. */
  async getIdentityKey(): Promise<string> {
    const result = await this.wallet.getPublicKey({ identityKey: true })
    return result.publicKey
  }

  /**
   * Make an authenticated HTTP request using BRC-103/104.
   * Handles nonce exchange and signature headers automatically.
   *
   * Adds three auth headers to the request:
   * - `x-bsv-auth-identity-key` — the sender's identity public key
   * - `x-bsv-auth-nonce`        — a unique request nonce (UUID)
   * - `x-bsv-auth-signature`    — hex-encoded signature of the nonce
   *
   * Full AuthFetch integration (Peer handshake, session management,
   * certificate exchange, 402 payment handling) requires the complete
   * WalletInterface and is deferred to a future task.
   */
  async authenticatedFetch(
    url: string,
    options?: RequestInit,
  ): Promise<Response> {
    const identityKey = await this.getIdentityKey()

    // Build auth headers
    const headers = new Headers(options?.headers)
    headers.set('x-bsv-auth-identity-key', identityKey)

    // Generate and sign a request nonce
    const nonce = crypto.randomUUID()
    headers.set('x-bsv-auth-nonce', nonce)

    const nonceBytes = new TextEncoder().encode(nonce)
    const sigResult = await this.wallet.createSignature({
      data: Array.from(nonceBytes),
      protocolID: AUTH_PROTOCOL,
      keyID: AUTH_KEY_ID,
      counterparty: 'self',
    })
    headers.set('x-bsv-auth-signature', bytesToHex(sigResult.signature))

    return fetch(url, { ...options, headers })
  }

  /**
   * Verify an incoming BRC-103 authentication request.
   *
   * Checks that the nonce was signed by the claimed identity key using
   * the same protocol parameters as `authenticatedFetch`.
   *
   * @returns `true` if the signature is valid, `false` otherwise.
   */
  async verifyAuthRequest(args: {
    identityKey: string
    nonce: string
    signature: string
  }): Promise<boolean> {
    const nonceBytes = new TextEncoder().encode(args.nonce)
    const sigBytes = hexToBytes(args.signature)

    try {
      const result = await this.wallet.verifySignature({
        data: Array.from(nonceBytes),
        signature: Array.from(sigBytes),
        protocolID: AUTH_PROTOCOL,
        keyID: AUTH_KEY_ID,
        counterparty: args.identityKey,
      })
      return result.valid
    } catch (_err: unknown) {
      // verifySignature throws on invalid signatures (ERR_INVALID_SIGNATURE)
      return false
    }
  }
}
