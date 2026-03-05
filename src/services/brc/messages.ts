/**
 * MessageService — BRC-77 (signed messages) and BRC-78 (encrypted messages)
 *
 * Provides signed and encrypted messaging using the TauriProtoWallet's
 * createSignature/verifySignature and encrypt/decrypt methods. All
 * cryptographic operations are delegated to the Tauri Rust backend —
 * private keys never leave Rust memory.
 *
 * The SDK's SignedMessage/EncryptedMessage classes require direct access to
 * PrivateKey objects for key derivation, which we cannot provide since keys
 * reside in the Rust backend. Instead, this service implements a simple wire
 * format and delegates all crypto to the ProtoWallet interface.
 *
 * Wire format for signed messages (BRC-77):
 *   [1 byte version][4 byte payload length (big-endian u32)][payload bytes][signature bytes]
 *
 * Wire format for encrypted messages (BRC-78):
 *   [1 byte version][encrypted payload bytes]
 *
 * @module services/brc/messages
 */

import type { WalletProtocol, WalletCounterparty } from '@bsv/sdk'
import type { TauriProtoWallet } from './adapter'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current wire format version for both signed and encrypted messages. */
export const MESSAGE_VERSION = 1

/** Minimum header size for signed messages: version(1) + payloadLen(4) */
const SIGNED_HEADER_SIZE = 5

/** Minimum size for encrypted messages: version(1) + at least 1 ciphertext byte */
const ENCRYPTED_MIN_SIZE = 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Arguments for creating a signed or encrypted message. */
export interface CreateMessageArgs {
  /** The plaintext data to sign or encrypt. */
  data: Uint8Array
  /** BRC-43 protocol ID: [securityLevel, protocolName]. */
  protocolID: WalletProtocol
  /** BRC-43 key ID for key derivation. */
  keyID: string
  /** The counterparty: 'self', 'anyone', or a hex-encoded public key. */
  counterparty: WalletCounterparty
}

/** Arguments for verifying or decrypting (counterparty context). */
export interface MessageContextArgs {
  /** BRC-43 protocol ID used during creation. */
  protocolID: WalletProtocol
  /** BRC-43 key ID used during creation. */
  keyID: string
  /** The counterparty who signed/encrypted the message. */
  counterparty: WalletCounterparty
}

/** Result of verifying a signed message. */
export interface VerifySignedMessageResult {
  /** Whether the signature is valid. */
  valid: boolean
  /** The original payload data extracted from the message. */
  data: Uint8Array
}

// ---------------------------------------------------------------------------
// MessageService
// ---------------------------------------------------------------------------

/**
 * Service for creating and verifying signed messages (BRC-77) and
 * creating and decrypting encrypted messages (BRC-78).
 *
 * All crypto is delegated to the provided TauriProtoWallet instance.
 */
export class MessageService {
  constructor(private readonly wallet: TauriProtoWallet) {}

  // =========================================================================
  // BRC-77 — Signed Messages
  // =========================================================================

  /**
   * Create a signed message.
   *
   * The payload is prepended with a version byte and a 4-byte big-endian
   * payload length, then the signature is appended. This allows the verifier
   * to extract the original data and the signature independently.
   *
   * @param args - The data, protocol, keyID and counterparty for signing.
   * @returns The signed message as a Uint8Array.
   */
  async createSignedMessage(args: CreateMessageArgs): Promise<Uint8Array> {
    const { data, protocolID, keyID, counterparty } = args

    // Sign the raw payload bytes
    const { signature } = await this.wallet.createSignature({
      data: Array.from(data),
      protocolID,
      keyID,
      counterparty,
    })

    // Build the wire format
    const payloadLen = data.length
    const sigBytes = new Uint8Array(signature)
    const totalLen = SIGNED_HEADER_SIZE + payloadLen + sigBytes.length
    const result = new Uint8Array(totalLen)

    // Version byte
    result[0] = MESSAGE_VERSION

    // Payload length (big-endian u32)
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength)
    view.setUint32(1, payloadLen)

    // Payload
    result.set(data, SIGNED_HEADER_SIZE)

    // Signature
    result.set(sigBytes, SIGNED_HEADER_SIZE + payloadLen)

    return result
  }

  /**
   * Verify a signed message and extract its payload.
   *
   * Parses the wire format, extracts the payload and signature, then
   * delegates verification to the wallet.
   *
   * @param message - The signed message bytes.
   * @param context - Protocol, keyID and counterparty for verification context.
   * @returns The verification result with the extracted data.
   */
  async verifySignedMessage(
    message: Uint8Array,
    context: MessageContextArgs,
  ): Promise<VerifySignedMessageResult> {
    if (message.length < SIGNED_HEADER_SIZE) {
      throw new Error('Signed message is too short to contain a valid header')
    }

    // Parse version
    const version = message[0]
    if (version !== MESSAGE_VERSION) {
      throw new Error(
        `Unsupported message version: expected ${MESSAGE_VERSION}, got ${version}`,
      )
    }

    // Parse payload length
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength)
    const payloadLen = view.getUint32(1)

    // Validate we have enough bytes
    if (message.length < SIGNED_HEADER_SIZE + payloadLen) {
      throw new Error(
        'Signed message is truncated: payload length exceeds available bytes',
      )
    }

    // Extract payload and signature
    const data = message.slice(SIGNED_HEADER_SIZE, SIGNED_HEADER_SIZE + payloadLen)
    const signatureBytes = message.slice(SIGNED_HEADER_SIZE + payloadLen)

    // Verify the signature against the original payload
    try {
      const result = await this.wallet.verifySignature({
        data: Array.from(data),
        signature: Array.from(signatureBytes),
        protocolID: context.protocolID,
        keyID: context.keyID,
        counterparty: context.counterparty,
      })
      return { valid: result.valid, data }
    } catch (e: unknown) {
      // The adapter throws on invalid signatures with code ERR_INVALID_SIGNATURE
      if (e instanceof Error && (e as Error & { code?: string }).code === 'ERR_INVALID_SIGNATURE') {
        return { valid: false, data }
      }
      throw e
    }
  }

  // =========================================================================
  // BRC-78 — Encrypted Messages
  // =========================================================================

  /**
   * Create an encrypted message.
   *
   * Encrypts the payload using the wallet's encrypt method and prepends
   * a version byte.
   *
   * @param args - The data, protocol, keyID and counterparty for encryption.
   * @returns The encrypted message as a Uint8Array.
   */
  async createEncryptedMessage(args: CreateMessageArgs): Promise<Uint8Array> {
    const { data, protocolID, keyID, counterparty } = args

    // Encrypt via the wallet (ECIES in the Tauri backend)
    const { ciphertext } = await this.wallet.encrypt({
      plaintext: Array.from(data),
      protocolID,
      keyID,
      counterparty,
    })

    // Build the wire format: version byte + ciphertext
    const ciphertextBytes = new Uint8Array(ciphertext)
    const result = new Uint8Array(1 + ciphertextBytes.length)
    result[0] = MESSAGE_VERSION
    result.set(ciphertextBytes, 1)

    return result
  }

  /**
   * Decrypt an encrypted message.
   *
   * Strips the version byte, then delegates decryption to the wallet.
   *
   * @param message - The encrypted message bytes.
   * @param context - Protocol, keyID and counterparty for decryption context.
   * @returns The decrypted plaintext as a Uint8Array.
   */
  async decryptMessage(
    message: Uint8Array,
    context: MessageContextArgs,
  ): Promise<Uint8Array> {
    if (message.length < ENCRYPTED_MIN_SIZE + 1) {
      throw new Error('Encrypted message is too short to contain valid data')
    }

    // Parse version
    const version = message[0]
    if (version !== MESSAGE_VERSION) {
      throw new Error(
        `Unsupported message version: expected ${MESSAGE_VERSION}, got ${version}`,
      )
    }

    // Extract ciphertext (everything after the version byte)
    const ciphertext = Array.from(message.slice(1))

    // Decrypt via the wallet
    const { plaintext } = await this.wallet.decrypt({
      ciphertext,
      protocolID: context.protocolID,
      keyID: context.keyID,
      counterparty: context.counterparty,
    })

    return new Uint8Array(plaintext)
  }
}
