/**
 * Key Derivation Functions (Tauri-only)
 *
 * This module provides functions for HD wallet key derivation
 * following the BRC-100 standard (Yours Wallet compatible).
 *
 * All derivation is delegated to Rust via Tauri commands so that
 * mnemonics and private keys never enter the webview's JavaScript heap.
 *
 * @module domain/wallet/keyDerivation
 */

import type { WalletKeys, KeyPair } from '../types'
import { isTauri, tauriInvoke } from '../../utils/tauri'

/**
 * BRC-100 standard derivation paths (matching Yours Wallet exactly)
 *
 * - `wallet`: Main spending key for BSV transactions
 * - `ordinals`: Key for inscription/ordinal operations
 * - `identity`: Key for BRC-100 authentication and signing
 *
 * @constant
 */
export const WALLET_PATHS = {
  yours: {
    /** BSV spending key path (DEFAULT_WALLET_PATH) */
    wallet: "m/44'/236'/0'/1/0",
    /** Ordinals/inscription key path (DEFAULT_ORD_PATH) */
    ordinals: "m/44'/236'/1'/0/0",
    /** Identity/BRC-100 authentication key path */
    identity: "m/0'/236'/0'/0/0"
  }
} as const

/**
 * Derive all wallet keys from a mnemonic.
 *
 * Derives the complete set of keys for a Simply Sats wallet:
 * - Wallet key (for BSV transactions)
 * - Ordinals key (for inscription operations)
 * - Identity key (for BRC-100 authentication)
 *
 * All keys are derived using BRC-100 standard paths.
 *
 * @param mnemonic - A valid BIP-39 mnemonic phrase (12 or 24 words)
 * @returns Complete WalletKeys structure with all derived keys
 *
 * @example
 * ```typescript
 * const keys = deriveWalletKeys('abandon abandon abandon ... about')
 * console.log(keys.walletAddress) // Main spending address
 * console.log(keys.ordAddress)    // Ordinals address
 * console.log(keys.identityAddress) // Identity address
 * ```
 */
export async function deriveWalletKeys(mnemonic: string): Promise<WalletKeys> {
  if (!isTauri()) {
    throw new Error('Key derivation requires the Tauri runtime')
  }
  return await tauriInvoke<WalletKeys>('derive_wallet_keys', { mnemonic })
}

/**
 * Derive wallet keys for a specific account index.
 *
 * Uses the account index in the derivation path to create unique addresses
 * for each account while sharing the same master mnemonic.
 *
 * Derivation paths with account index N:
 * - wallet:   m/44'/236'/N'/1/0
 * - ordinals: m/44'/236'/(N*2+1)'/0/0  (odd indices to avoid collision with wallet)
 * - identity: m/0'/236'/N'/0/0
 *
 * Account 0 matches the standard WALLET_PATHS.yours paths exactly.
 *
 * @param mnemonic - A valid BIP-39 mnemonic phrase (12 or 24 words)
 * @param accountIndex - Account index (0, 1, 2, ...) for derivation path
 * @returns Complete WalletKeys structure with all derived keys for the account
 *
 * @example
 * ```typescript
 * // First account (index 0) - same as deriveWalletKeys()
 * const account0 = deriveWalletKeysForAccount('abandon...about', 0)
 *
 * // Second account (index 1) - different addresses, same seed
 * const account1 = deriveWalletKeysForAccount('abandon...about', 1)
 * ```
 */
export async function deriveWalletKeysForAccount(mnemonic: string, accountIndex: number): Promise<WalletKeys> {
  if (!isTauri()) {
    throw new Error('Key derivation requires the Tauri runtime')
  }
  return await tauriInvoke<WalletKeys>('derive_wallet_keys_for_account', {
    mnemonic,
    accountIndex
  })
}

/**
 * Generate a key pair from a WIF (Wallet Import Format) string.
 *
 * Use this for importing keys from other wallets that export
 * in WIF format. The function extracts the private key and
 * derives the corresponding public key and address.
 *
 * @param wif - Private key in Wallet Import Format
 * @returns A KeyPair containing WIF, address, and public key
 * @throws Error if the WIF is invalid
 *
 * @example
 * ```typescript
 * const keys = keysFromWif('L1...')
 * console.log(keys.address) // Derived address
 * ```
 */
export async function keysFromWif(wif: string): Promise<KeyPair> {
  if (!isTauri()) {
    throw new Error('Key derivation requires the Tauri runtime')
  }
  return await tauriInvoke<KeyPair>('keys_from_wif', { wif })
}
