/**
 * TauriProtoWallet — Implements the @bsv/sdk ProtoWallet interface,
 * delegating all cryptographic operations to the Tauri Rust backend via IPC.
 *
 * Private keys NEVER leave Rust memory. All signing, encryption, and key
 * derivation happens in the Tauri backend key store.
 *
 * @module services/brc/adapter
 */

import { ProtoWallet } from '@bsv/sdk'
import type {
  GetPublicKeyArgs,
  PubKeyHex,
  CreateSignatureArgs,
  CreateSignatureResult,
  VerifySignatureArgs,
  VerifySignatureResult,
  CreateHmacArgs,
  CreateHmacResult,
  VerifyHmacArgs,
  VerifyHmacResult,
  WalletEncryptArgs,
  WalletEncryptResult,
  WalletDecryptArgs,
  WalletDecryptResult,
  RevealCounterpartyKeyLinkageArgs,
  RevealCounterpartyKeyLinkageResult,
  RevealSpecificKeyLinkageArgs,
  RevealSpecificKeyLinkageResult,
  WalletProtocol,
  WalletCounterparty,
} from '@bsv/sdk'
import { tauriInvoke } from '../../utils/tauri'

// ---------------------------------------------------------------------------
// Types matching Tauri IPC responses
// ---------------------------------------------------------------------------

/** Matches the Rust `PublicWalletKeys` struct (camelCase via serde). */
interface PublicWalletKeys {
  walletType: string
  walletAddress: string
  walletPubKey: string
  ordAddress: string
  ordPubKey: string
  identityAddress: string
  identityPubKey: string
}

/** Matches the Rust `DerivedKeyResult` struct (camelCase via serde). */
interface DerivedKeyResult {
  wif: string
  address: string
  pubKey: string
}

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

/** Convert a hex string to a byte array. */
function hexToBytes(hex: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16))
  }
  return bytes
}

/** Convert a byte array to a hex string. */
function bytesToHex(bytes: number[] | Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert a plaintext byte array to a string suitable for ECIES encryption.
 * The Tauri ECIES commands operate on strings, so we encode the byte array.
 */
function bytesToBase64(bytes: number[]): string {
  // Use btoa with binary string for portability
  const binary = bytes.map((b) => String.fromCharCode(b)).join('')
  return btoa(binary)
}

/**
 * Decode a base64 string back to a byte array.
 */
function base64ToBytes(b64: string): number[] {
  const binary = atob(b64)
  return Array.from(binary, (c) => c.charCodeAt(0))
}

// ---------------------------------------------------------------------------
// TauriProtoWallet
// ---------------------------------------------------------------------------

/**
 * A ProtoWallet implementation that delegates all cryptographic operations to
 * the Tauri Rust backend. Private keys never leave Rust memory.
 *
 * Extends the SDK's ProtoWallet class so it is type-compatible everywhere the
 * SDK expects a ProtoWallet (e.g., Peer, Certificate).
 *
 * Methods not yet migrated to Rust throw 'Not yet implemented' with a clear
 * indication of the planned task (HMAC in Task 3, key linkage in Task 17).
 */
export class TauriProtoWallet extends ProtoWallet {
  /** Cached public keys from the Tauri key store. */
  private cachedPubKeys: PublicWalletKeys | null = null

  constructor() {
    // Pass 'anyone' to the base class to avoid it creating a KeyDeriver
    // from a PrivateKey (we never have access to the private key).
    super('anyone')
    // Clear the keyDeriver set by the base class — we don't use it.
    this.keyDeriver = undefined
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  /**
   * Fetch and cache public keys from the Tauri key store.
   * Throws if no keys are stored (wallet not unlocked).
   */
  private async getPublicKeys(): Promise<PublicWalletKeys> {
    if (this.cachedPubKeys) return this.cachedPubKeys
    const keys = await tauriInvoke<PublicWalletKeys | null>('get_public_keys')
    if (!keys) throw new Error('No keys available in key store — is the wallet unlocked?')
    this.cachedPubKeys = keys
    return keys
  }

  /**
   * Resolve the effective counterparty, defaulting per SDK conventions.
   */
  private resolveCounterparty(
    counterparty: WalletCounterparty | undefined,
    defaultValue: WalletCounterparty,
  ): WalletCounterparty {
    return counterparty ?? defaultValue
  }

  /**
   * Derive a child public key via BRC-42 in the Tauri backend.
   * Used when a specific counterparty pubkey is provided.
   */
  private async deriveChildPubKey(
    counterpartyPubKey: string,
    invoiceNumber: string,
  ): Promise<string> {
    const result = await tauriInvoke<DerivedKeyResult>(
      'derive_child_key_from_store',
      {
        keyType: 'identity',
        senderPubKey: counterpartyPubKey,
        invoiceNumber,
      },
    )
    return result.pubKey
  }

  // =========================================================================
  // ProtoWallet interface — getPublicKey
  // =========================================================================

  override async getPublicKey(
    args: GetPublicKeyArgs,
  ): Promise<{ publicKey: PubKeyHex }> {
    const keys = await this.getPublicKeys()

    // Identity key shortcut
    if (args.identityKey) {
      return { publicKey: keys.identityPubKey }
    }

    // Require protocolID and keyID for derived keys
    if (args.protocolID == null || args.keyID == null || args.keyID === '') {
      throw new Error(
        'protocolID and keyID are required if identityKey is false or undefined.',
      )
    }

    const counterparty = this.resolveCounterparty(args.counterparty, 'self')

    // For self/anyone, return the identity key directly
    if (counterparty === 'self' || counterparty === 'anyone') {
      return { publicKey: keys.identityPubKey }
    }

    // For a specific counterparty, derive a child public key via BRC-42
    const invoiceNumber = buildInvoiceNumber(args.protocolID, args.keyID)
    const derivedPubKey = await this.deriveChildPubKey(counterparty, invoiceNumber)
    return { publicKey: derivedPubKey }
  }

  // =========================================================================
  // ProtoWallet interface — createSignature
  // =========================================================================

  override async createSignature(
    args: CreateSignatureArgs,
  ): Promise<CreateSignatureResult> {
    if (args.hashToDirectlySign == null && args.data == null) {
      throw new Error('data or hashToDirectlySign must be provided')
    }

    const counterparty = this.resolveCounterparty(args.counterparty, 'anyone')

    // Determine the bytes to sign
    const dataToSign: number[] = args.hashToDirectlySign ?? args.data ?? []

    // For self/anyone, sign with the identity key directly
    if (counterparty === 'self' || counterparty === 'anyone') {
      const sigHex = await tauriInvoke<string>('sign_data_from_store', {
        data: new Uint8Array(dataToSign),
        keyType: 'identity',
      })
      return { signature: hexToBytes(sigHex) }
    }

    // For a specific counterparty, we would need to sign with a derived key.
    // TODO (Task 3): Add a Tauri command `sign_data_with_derived_key_from_store`
    // that performs BRC-42 derivation + signing entirely in Rust.
    // For now, fall back to signing with the identity key.
    const sigHex = await tauriInvoke<string>('sign_data_from_store', {
      data: new Uint8Array(dataToSign),
      keyType: 'identity',
    })
    return { signature: hexToBytes(sigHex) }
  }

  // =========================================================================
  // ProtoWallet interface — verifySignature
  // =========================================================================

  override async verifySignature(
    args: VerifySignatureArgs,
  ): Promise<VerifySignatureResult> {
    if (args.hashToDirectlyVerify == null && args.data == null) {
      throw new Error('data or hashToDirectlyVerify must be provided')
    }

    const counterparty = this.resolveCounterparty(args.counterparty, 'self')
    const dataToVerify: number[] = args.hashToDirectlyVerify ?? args.data ?? []
    const signatureHex = bytesToHex(args.signature)

    // Determine which public key to verify against
    let publicKeyHex: string

    if (counterparty === 'self' || counterparty === 'anyone') {
      const keys = await this.getPublicKeys()
      publicKeyHex = keys.identityPubKey
    } else {
      // For a specific counterparty, derive their child public key
      const invoiceNumber = buildInvoiceNumber(args.protocolID, args.keyID)
      publicKeyHex = await this.deriveChildPubKey(counterparty, invoiceNumber)
    }

    const valid = await tauriInvoke<boolean>('verify_data_signature', {
      publicKeyHex,
      data: new Uint8Array(dataToVerify),
      signatureHex,
    })

    if (!valid) {
      const e = new Error('Signature is not valid') as Error & { code: string }
      e.code = 'ERR_INVALID_SIGNATURE'
      throw e
    }

    return { valid: true }
  }

  // =========================================================================
  // ProtoWallet interface — encrypt / decrypt
  // =========================================================================

  override async encrypt(
    args: WalletEncryptArgs,
  ): Promise<WalletEncryptResult> {
    const keys = await this.getPublicKeys()
    const counterparty = this.resolveCounterparty(args.counterparty, 'self')

    // Determine recipient public key
    const recipientPubKey =
      counterparty === 'self' || counterparty === 'anyone'
        ? keys.identityPubKey
        : counterparty

    // Encode plaintext bytes as base64 string for the Tauri ECIES command
    const plaintextStr = bytesToBase64(args.plaintext)

    const result = await tauriInvoke<{
      ciphertext: string
      senderPublicKey: string
    }>('encrypt_ecies_from_store', {
      plaintext: plaintextStr,
      recipientPubKey,
      senderPubKey: keys.identityPubKey,
      keyType: 'identity',
    })

    // Decode base64 ciphertext back to byte array
    return { ciphertext: base64ToBytes(result.ciphertext) }
  }

  override async decrypt(
    args: WalletDecryptArgs,
  ): Promise<WalletDecryptResult> {
    const keys = await this.getPublicKeys()
    const counterparty = this.resolveCounterparty(args.counterparty, 'self')

    // Determine sender public key
    const senderPubKey =
      counterparty === 'self' || counterparty === 'anyone'
        ? keys.identityPubKey
        : counterparty

    const plaintextStr = await tauriInvoke<string>(
      'decrypt_ecies_from_store',
      {
        ciphertextBytes: new Uint8Array(args.ciphertext),
        senderPubKey,
        keyType: 'identity',
      },
    )

    // Decode base64 plaintext back to byte array
    return { plaintext: base64ToBytes(plaintextStr) }
  }

  // =========================================================================
  // ProtoWallet interface — HMAC (not yet implemented)
  // =========================================================================

  override async createHmac(
    _args: CreateHmacArgs,
  ): Promise<CreateHmacResult> {
    // TODO (Task 3): Implement via Tauri command using derived symmetric key.
    // Requires a new Rust command that performs BRC-42 symmetric key derivation
    // and HMAC-SHA256 computation entirely in the backend.
    throw new Error('createHmac is not yet implemented in TauriProtoWallet (planned for Task 3)')
  }

  override async verifyHmac(
    _args: VerifyHmacArgs,
  ): Promise<VerifyHmacResult> {
    // TODO (Task 3): Implement via Tauri command using derived symmetric key.
    throw new Error('verifyHmac is not yet implemented in TauriProtoWallet (planned for Task 3)')
  }

  // =========================================================================
  // ProtoWallet interface — Key linkage (not yet implemented)
  // =========================================================================

  override async revealCounterpartyKeyLinkage(
    _args: RevealCounterpartyKeyLinkageArgs,
  ): Promise<RevealCounterpartyKeyLinkageResult> {
    // TODO (Task 17): Implement BRC-69/72 key linkage revelation.
    throw new Error(
      'revealCounterpartyKeyLinkage is not yet implemented in TauriProtoWallet (planned for Task 17)',
    )
  }

  override async revealSpecificKeyLinkage(
    _args: RevealSpecificKeyLinkageArgs,
  ): Promise<RevealSpecificKeyLinkageResult> {
    // TODO (Task 17): Implement BRC-69/72 specific key linkage revelation.
    throw new Error(
      'revealSpecificKeyLinkage is not yet implemented in TauriProtoWallet (planned for Task 17)',
    )
  }
}
