/**
 * BRC-85 PIKE (Proven Identity Key Exchange) Service.
 *
 * Provides secure contact verification using TOTP codes derived from
 * ECDH shared secrets. When two parties each compute a code using the
 * other's identity public key, matching codes prove no MITM occurred
 * during key exchange.
 *
 * Protocol flow:
 * 1. Both parties know each other's identity public keys
 * 2. Each derives an ECDH shared secret via wallet HMAC (BRC-42)
 * 3. Both compute a 6-digit TOTP code from the shared secret
 * 4. They verify codes match via out-of-band communication
 * 5. Matching codes confirm no MITM attack
 *
 * @module services/brc/pike
 */

import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { TauriProtoWallet } from './adapter'
import { BRC } from '../../config'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** BRC-85 protocol identifier for PIKE key derivation. */
const PIKE_PROTOCOL = [2, 'brc85-pike'] as const

/** Fixed data payload used as HMAC input for PIKE verification. */
const PIKE_VERIFICATION_DATA = 'pike-verification'

// ---------------------------------------------------------------------------
// PIKEService
// ---------------------------------------------------------------------------

export class PIKEService {
  private wallet: TauriProtoWallet

  constructor(wallet: TauriProtoWallet) {
    this.wallet = wallet
  }

  /**
   * Generate a 6-digit TOTP verification code for a contact.
   *
   * Both parties computing this with each other's public key will get
   * the same code if and only if there is no MITM. The code rotates
   * every {@link BRC.PIKE_TOTP_WINDOW} seconds.
   */
  async generateVerificationCode(contactPubKey: string): Promise<string> {
    // 1. Create HMAC with contact's pubkey as counterparty.
    //    The wallet internally performs ECDH via BRC-42 key derivation,
    //    so both parties derive the same shared secret.
    const hmacResult = await this.wallet.createHmac({
      data: Array.from(new TextEncoder().encode(PIKE_VERIFICATION_DATA)),
      protocolID: [...PIKE_PROTOCOL],
      keyID: '1',
      counterparty: contactPubKey,
    })

    // 2. Time-based windowing (same principle as RFC 6238 TOTP)
    const timeStep = Math.floor(Date.now() / 1000 / BRC.PIKE_TOTP_WINDOW)
    const timeBytes = new Uint8Array(8)
    new DataView(timeBytes.buffer).setBigUint64(0, BigInt(timeStep))

    // 3. HMAC-SHA256(shared_hmac, time_step) — second HMAC layer
    const totpHmac = hmac(sha256, new Uint8Array(hmacResult.hmac), timeBytes)

    // 4. Dynamic truncation (RFC 4226 section 5.4)
    const offset = totpHmac[totpHmac.length - 1] & 0x0f
    const code =
      (((totpHmac[offset] & 0x7f) << 24) |
        ((totpHmac[offset + 1] & 0xff) << 16) |
        ((totpHmac[offset + 2] & 0xff) << 8) |
        (totpHmac[offset + 3] & 0xff)) %
      1_000_000

    return code.toString().padStart(6, '0')
  }

  /**
   * Verify a contact's TOTP code.
   *
   * Uses constant-time comparison to prevent timing side-channel attacks.
   *
   * @returns `true` if the code matches what we would generate.
   */
  async verifyCode(contactPubKey: string, code: string): Promise<boolean> {
    const expected = await this.generateVerificationCode(contactPubKey)

    // Constant-time comparison — always compare all characters
    if (expected.length !== code.length) return false
    let result = 0
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ code.charCodeAt(i)
    }
    return result === 0
  }

  /**
   * Get the number of seconds remaining in the current TOTP window.
   *
   * Useful for displaying a countdown to the user so they know when
   * the code will rotate.
   */
  getTimeRemaining(): number {
    const now = Math.floor(Date.now() / 1000)
    return BRC.PIKE_TOTP_WINDOW - (now % BRC.PIKE_TOTP_WINDOW)
  }
}
