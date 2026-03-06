/**
 * BRC-100 Cryptography Operations
 *
 * ECIES encryption and decryption delegated to Rust Tauri commands.
 * All crypto operations run in the Tauri backend — WIF keys never leave Rust.
 */

import type { ActiveWallet } from '../wallet'
import { tauriInvoke } from '../../utils/tauri'

/**
 * Encrypt plaintext using ECIES with counterparty's public key.
 * Uses the Tauri key store — WIF never leaves Rust.
 */
export async function encryptECIES(
  keys: ActiveWallet,
  plaintext: string,
  recipientPubKey: string
): Promise<{ ciphertext: string; senderPublicKey: string }> {
  return tauriInvoke<{ ciphertext: string; senderPublicKey: string }>('encrypt_ecies_from_store', {
    plaintext,
    recipientPubKey,
    senderPubKey: keys.identityPubKey,
    keyType: 'identity'
  })
}

/**
 * Decrypt ciphertext using ECIES with counterparty's public key.
 * Uses the Tauri key store — WIF never leaves Rust.
 */
export async function decryptECIES(
  _keys: ActiveWallet,
  ciphertextBytes: number[],
  senderPubKey: string
): Promise<string> {
  return tauriInvoke<string>('decrypt_ecies_from_store', {
    ciphertextBytes: new Uint8Array(ciphertextBytes),
    senderPubKey,
    keyType: 'identity'
  })
}
