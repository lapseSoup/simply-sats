/**
 * Pure Key Derivation Functions
 *
 * This module provides pure functions for HD wallet key derivation
 * following the BRC-100 standard (Yours Wallet compatible).
 *
 * When running inside Tauri, derivation is delegated to Rust so that
 * mnemonics and private keys never enter the webview's JavaScript heap.
 * Falls back to @bsv/sdk in browser dev mode and tests.
 *
 * @module domain/wallet/keyDerivation
 */

import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { WalletKeys, KeyPair } from '../types'

// ---------------------------------------------------------------------------
// Tauri bridge helpers (same pattern as services/crypto.ts)
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
 * Derive a key pair from a mnemonic and derivation path.
 *
 * This is a pure function with no side effects. It deterministically
 * derives a private/public key pair from the given BIP-39 mnemonic
 * using the specified BIP-32 derivation path.
 *
 * @param mnemonic - A valid BIP-39 mnemonic phrase (12 or 24 words)
 * @param path - BIP-32 derivation path (e.g., "m/44'/236'/0'/1/0")
 * @returns A KeyPair containing WIF, address, and public key
 *
 * @example
 * ```typescript
 * const keys = deriveKeysFromPath(
 *   'abandon abandon abandon ... about',
 *   WALLET_PATHS.yours.wallet
 * )
 * console.log(keys.address) // "1..."
 * ```
 */
export function deriveKeysFromPath(mnemonic: string, path: string): KeyPair {
  const seed = Mnemonic.fromString(mnemonic).toSeed()
  const masterNode = HD.fromSeed(seed)
  const childNode = masterNode.derive(path)
  const privateKey = childNode.privKey
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}

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
  // Delegate to Rust when running in Tauri — mnemonic stays in native memory
  if (isTauri()) {
    try {
      return await tauriInvoke<WalletKeys>('derive_wallet_keys', { mnemonic })
    } catch (_e) {
      // Fall through to JS implementation
    }
  }

  const paths = WALLET_PATHS.yours
  const wallet = deriveKeysFromPath(mnemonic, paths.wallet)
  const ord = deriveKeysFromPath(mnemonic, paths.ordinals)
  const identity = deriveKeysFromPath(mnemonic, paths.identity)

  return {
    mnemonic,
    walletType: 'yours',
    walletWif: wallet.wif,
    walletAddress: wallet.address,
    walletPubKey: wallet.pubKey,
    ordWif: ord.wif,
    ordAddress: ord.address,
    ordPubKey: ord.pubKey,
    identityWif: identity.wif,
    identityAddress: identity.address,
    identityPubKey: identity.pubKey,
    accountIndex: 0
  }
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
  // Delegate to Rust when running in Tauri — mnemonic stays in native memory
  if (isTauri()) {
    try {
      return await tauriInvoke<WalletKeys>('derive_wallet_keys_for_account', {
        mnemonic,
        accountIndex
      })
    } catch (_e) {
      // Fall through to JS implementation
    }
  }

  // Derive paths with account index
  // wallet:   m/44'/236'/accountIndex'/1/0
  // ordinals: m/44'/236'/(accountIndex*2+1)'/0/0  - separate from wallet
  // identity: m/0'/236'/accountIndex'/0/0
  const walletPath = `m/44'/236'/${accountIndex}'/1/0`
  const ordinalsPath = `m/44'/236'/${accountIndex * 2 + 1}'/0/0`
  const identityPath = `m/0'/236'/${accountIndex}'/0/0`

  const wallet = deriveKeysFromPath(mnemonic, walletPath)
  const ord = deriveKeysFromPath(mnemonic, ordinalsPath)
  const identity = deriveKeysFromPath(mnemonic, identityPath)

  return {
    mnemonic,
    walletType: 'yours',
    walletWif: wallet.wif,
    walletAddress: wallet.address,
    walletPubKey: wallet.pubKey,
    ordWif: ord.wif,
    ordAddress: ord.address,
    ordPubKey: ord.pubKey,
    identityWif: identity.wif,
    identityAddress: identity.address,
    identityPubKey: identity.pubKey,
    accountIndex
  }
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
  // Delegate to Rust when running in Tauri
  if (isTauri()) {
    try {
      const result = await tauriInvoke<{ wif: string; address: string; pubKey: string }>('keys_from_wif', { wif })
      return result
    } catch (_e) {
      // Fall through to JS implementation
    }
  }

  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}
