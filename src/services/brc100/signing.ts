/**
 * BRC-100 Signing Operations
 *
 * Message signing and verification delegated to Rust Tauri commands.
 * All crypto operations run in the Tauri backend — WIF keys never leave Rust.
 */

import type { WalletKeys } from '../wallet'
import { tauriInvoke } from '../../utils/tauri'

/**
 * Sign a message with the identity key.
 * Uses the Tauri key store — WIF never leaves Rust.
 */
export async function signMessage(_keys: WalletKeys, message: string): Promise<string> {
  return tauriInvoke<string>('sign_message_from_store', { message, keyType: 'identity' })
}

/**
 * Sign arbitrary data with specified key type.
 * Uses the Tauri key store — WIF never leaves Rust.
 */
export async function signData(
  _keys: WalletKeys,
  data: number[],
  keyType: 'identity' | 'wallet' | 'ordinals' = 'identity'
): Promise<string> {
  return tauriInvoke<string>('sign_data_from_store', { data: new Uint8Array(data), keyType })
}

/**
 * Verify a signature over raw byte data (matching signData format)
 */
export async function verifyDataSignature(
  publicKeyHex: string,
  data: number[],
  signatureHex: string
): Promise<boolean> {
  return tauriInvoke<boolean>('verify_data_signature', {
    publicKeyHex,
    data: new Uint8Array(data),
    signatureHex
  })
}

/**
 * Verify a signature
 */
export async function verifySignature(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): Promise<boolean> {
  return tauriInvoke<boolean>('verify_signature', { publicKeyHex, message, signatureHex })
}
