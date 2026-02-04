/**
 * Pure key derivation functions
 * No side effects, no storage operations
 */

import { HD, Mnemonic, PrivateKey } from '@bsv/sdk'
import type { WalletKeys, KeyPair } from '../types'

// BRC-100 standard derivation paths (matching Yours Wallet exactly)
export const WALLET_PATHS = {
  yours: {
    wallet: "m/44'/236'/0'/1/0",    // BSV spending (DEFAULT_WALLET_PATH)
    ordinals: "m/44'/236'/1'/0/0",   // Ordinals (DEFAULT_ORD_PATH)
    identity: "m/0'/236'/0'/0/0"     // Identity/BRC-100 authentication
  }
} as const

/**
 * Derive keys from mnemonic and derivation path
 * Pure function - no side effects
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
 * Derive all wallet keys from mnemonic
 * Pure function - returns complete WalletKeys structure
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
 * Generate keys from WIF (for importing from other wallets)
 * Pure function - no side effects
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
