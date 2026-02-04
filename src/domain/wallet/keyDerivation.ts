/**
 * Pure Key Derivation Functions
 *
 * This module provides pure functions for HD wallet key derivation
 * following the BRC-100 standard (Yours Wallet compatible).
 *
 * No side effects, no storage operations - all functions are deterministic.
 *
 * @module domain/wallet/keyDerivation
 */

import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { WalletKeys, KeyPair } from '../types'

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
export function deriveWalletKeys(mnemonic: string): WalletKeys {
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
    identityPubKey: identity.pubKey
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
export function keysFromWif(wif: string): KeyPair {
  const privateKey = PrivateKey.fromWif(wif)
  const publicKey = privateKey.toPublicKey()

  return {
    wif: privateKey.toWif(),
    address: publicKey.toAddress(),
    pubKey: publicKey.toString()
  }
}
