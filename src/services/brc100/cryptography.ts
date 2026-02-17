/**
 * BRC-100 Cryptography Operations
 *
 * ECIES encryption and decryption using BSV SDK (JS fallback)
 * or Rust Tauri commands (desktop app).
 */

import { PrivateKey, PublicKey, Hash, SymmetricKey } from '@bsv/sdk'
import type { WalletKeys } from '../wallet'

// ---------------------------------------------------------------------------
// Tauri detection (same pattern as signing.ts)
// ---------------------------------------------------------------------------

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const TAURI_COMMAND_TIMEOUT_MS = 30_000

async function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  const result = invoke<T>(cmd, args)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Tauri command '${cmd}' timed out after ${TAURI_COMMAND_TIMEOUT_MS}ms`)), TAURI_COMMAND_TIMEOUT_MS)
  )
  return Promise.race([result, timeout])
}

/**
 * Encrypt plaintext using ECIES with counterparty's public key
 */
export async function encryptECIES(
  keys: WalletKeys,
  plaintext: string,
  recipientPubKey: string
): Promise<{ ciphertext: string; senderPublicKey: string }> {
  if (isTauri()) {
    // Use key store — WIF never leaves Rust.
    // tauriInvoke throws on failure (no silent fallback to JS path).
    return tauriInvoke<{ ciphertext: string; senderPublicKey: string }>('encrypt_ecies_from_store', {
      plaintext,
      recipientPubKey,
      senderPubKey: keys.identityPubKey,
      keyType: 'identity'
    })
  }

  // JS fallback — browser dev mode only (never reached in production Tauri build)
  // Derive shared secret using ECDH
  const senderPrivKey = PrivateKey.fromWif(keys.identityWif)
  const recipientPublicKey = PublicKey.fromString(recipientPubKey)

  // Use ECDH to derive shared secret
  const sharedSecret = senderPrivKey.deriveSharedSecret(recipientPublicKey)
  const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

  // Encrypt using AES with the shared secret
  const plaintextBytes = new TextEncoder().encode(plaintext)
  const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
  const encrypted = symmetricKey.encrypt(Array.from(plaintextBytes))

  // Convert encrypted bytes to hex string
  const encryptedHex = Array.from(encrypted as number[])
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  // Return as hex string along with sender's public key for decryption
  return {
    ciphertext: encryptedHex,
    senderPublicKey: keys.identityPubKey
  }
}

/**
 * Decrypt ciphertext using ECIES with counterparty's public key
 */
export async function decryptECIES(
  keys: WalletKeys,
  ciphertextBytes: number[],
  senderPubKey: string
): Promise<string> {
  if (isTauri()) {
    // Use key store — WIF never leaves Rust.
    // tauriInvoke throws on failure (no silent fallback to JS path).
    return tauriInvoke<string>('decrypt_ecies_from_store', {
      ciphertextBytes: new Uint8Array(ciphertextBytes),
      senderPubKey,
      keyType: 'identity'
    })
  }

  // JS fallback — browser dev mode only (never reached in production Tauri build)
  // Derive shared secret using ECDH
  const recipientPrivKey = PrivateKey.fromWif(keys.identityWif)
  const senderPublicKey = PublicKey.fromString(senderPubKey)

  // Use ECDH to derive shared secret
  const sharedSecret = recipientPrivKey.deriveSharedSecret(senderPublicKey)
  const sharedSecretHash = Hash.sha256(sharedSecret.encode(true))

  // Decrypt using AES with the shared secret
  const symmetricKey = new SymmetricKey(Array.from(sharedSecretHash))
  const decrypted = symmetricKey.decrypt(ciphertextBytes)

  // Return plaintext
  const decryptedBytes = decrypted instanceof Uint8Array
    ? decrypted
    : new Uint8Array(decrypted as number[])
  return new TextDecoder().decode(decryptedBytes)
}
