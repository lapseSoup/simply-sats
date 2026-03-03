/**
 * Pure TypeScript Key Derivation
 *
 * Implements BIP-39/BIP-32/BIP-44 key derivation, WIF encoding/decoding,
 * public key derivation, and P2PKH address generation — all in pure
 * TypeScript using @noble and @scure libraries.
 *
 * Produces byte-identical output to the Rust backend.
 *
 * @module platform/crypto/keys
 */

import { HDKey } from '@scure/bip32'
import { base58check } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import bip39 from 'bip39'
import type { WalletKeys, KeyPair } from '../../domain/types'

// ============================================
// Constants
// ============================================

/** BSV mainnet WIF version byte */
const WIF_VERSION = 0x80

/** BSV mainnet P2PKH address version byte */
const ADDRESS_VERSION = 0x00

/** WIF compression flag */
const COMPRESSION_FLAG = 0x01

// ============================================
// Derivation Paths (BRC-100 compatible, matching Yours Wallet)
// ============================================

function walletPath(accountIndex: number): string {
  return `m/44'/236'/${accountIndex}'/1/0`
}

function ordinalsPath(accountIndex: number): string {
  // Odd indices to avoid collision with wallet paths
  return `m/44'/236'/${accountIndex * 2 + 1}'/0/0`
}

function identityPath(accountIndex: number): string {
  return `m/0'/236'/${accountIndex}'/0/0`
}

// ============================================
// Low-Level Crypto
// ============================================

/** Hash160: RIPEMD-160(SHA-256(data)) */
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

/** Double SHA-256: SHA-256(SHA-256(data)) */
export function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

/** Convert bytes to hex string */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Convert hex string to bytes */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

// ============================================
// WIF Encoding/Decoding
// ============================================

const b58check = base58check(sha256)

/**
 * Encode a 32-byte private key as a WIF string (mainnet, compressed).
 */
export function privateKeyToWif(privKey: Uint8Array): string {
  // Payload: [version(1)] [privkey(32)] [compression_flag(1)] = 34 bytes
  const payload = new Uint8Array(34)
  payload[0] = WIF_VERSION
  payload.set(privKey, 1)
  payload[33] = COMPRESSION_FLAG
  return b58check.encode(payload)
}

/**
 * Decode a WIF string to a 32-byte private key.
 */
export function wifToPrivateKey(wif: string): Uint8Array {
  const decoded = b58check.decode(wif)
  if (decoded[0] !== WIF_VERSION) {
    throw new Error(`Invalid WIF version byte: expected 0x${WIF_VERSION.toString(16)}, got 0x${decoded[0]?.toString(16)}`)
  }
  // Extract 32-byte private key (skip version byte)
  return decoded.slice(1, 33)
}

// ============================================
// Public Key Derivation
// ============================================

/**
 * Derive the compressed public key (33 bytes) from a private key.
 */
export function privateKeyToPublicKey(privKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(privKey, true) // true = compressed
}

/**
 * Derive the compressed public key hex (66 chars) from a private key.
 */
export function privateKeyToPublicKeyHex(privKey: Uint8Array): string {
  return bytesToHex(privateKeyToPublicKey(privKey))
}

// ============================================
// Address Generation
// ============================================

/**
 * Generate a P2PKH address from a compressed public key.
 * Algorithm: pubkey → SHA-256 → RIPEMD-160 → Base58Check with version 0x00
 */
export function publicKeyToAddress(pubKey: Uint8Array): string {
  const pubKeyHash = hash160(pubKey)
  // Payload: [version(1)] [hash160(20)] = 21 bytes
  const payload = new Uint8Array(21)
  payload[0] = ADDRESS_VERSION
  payload.set(pubKeyHash, 1)
  return b58check.encode(payload)
}

/**
 * Generate a P2PKH address from a private key.
 */
export function privateKeyToAddress(privKey: Uint8Array): string {
  const pubKey = privateKeyToPublicKey(privKey)
  return publicKeyToAddress(pubKey)
}

/**
 * Generate a P2PKH address from a WIF string.
 */
export function wifToAddress(wif: string): string {
  const privKey = wifToPrivateKey(wif)
  return privateKeyToAddress(privKey)
}

// ============================================
// BIP-39/BIP-32/BIP-44 Key Derivation
// ============================================

/**
 * Derive an HD key at a specific BIP-32 path from a BIP-39 mnemonic.
 */
function deriveKeyAtPath(mnemonic: string, path: string): HDKey {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed)
  return master.derive(path)
}

/**
 * Extract WIF, address, and pubKey from an HDKey.
 */
function hdKeyToKeyPair(hdKey: HDKey): KeyPair {
  if (!hdKey.privateKey) {
    throw new Error('HDKey has no private key')
  }
  const privKey = hdKey.privateKey
  const pubKey = privateKeyToPublicKey(privKey)

  return {
    wif: privateKeyToWif(privKey),
    address: publicKeyToAddress(pubKey),
    pubKey: bytesToHex(pubKey),
  }
}

/**
 * Derive all wallet keys from a BIP-39 mnemonic.
 *
 * Derives wallet, ordinals, and identity keys at standard BRC-100 paths.
 * Produces the same output as the Rust `derive_wallet_keys` command.
 */
export function deriveWalletKeys(mnemonic: string, accountIndex = 0): WalletKeys {
  const walletKP = hdKeyToKeyPair(deriveKeyAtPath(mnemonic, walletPath(accountIndex)))
  const ordKP = hdKeyToKeyPair(deriveKeyAtPath(mnemonic, ordinalsPath(accountIndex)))
  const identityKP = hdKeyToKeyPair(deriveKeyAtPath(mnemonic, identityPath(accountIndex)))

  return {
    mnemonic,
    walletType: 'yours',
    walletWif: walletKP.wif,
    walletAddress: walletKP.address,
    walletPubKey: walletKP.pubKey,
    ordWif: ordKP.wif,
    ordAddress: ordKP.address,
    ordPubKey: ordKP.pubKey,
    identityWif: identityKP.wif,
    identityAddress: identityKP.address,
    identityPubKey: identityKP.pubKey,
    accountIndex,
  }
}

/**
 * Generate a KeyPair from a WIF string.
 * Produces the same output as the Rust `keys_from_wif` command.
 */
export function keysFromWif(wif: string): KeyPair {
  const privKey = wifToPrivateKey(wif)
  const pubKey = privateKeyToPublicKey(privKey)

  return {
    wif,
    address: publicKeyToAddress(pubKey),
    pubKey: bytesToHex(pubKey),
  }
}

// ============================================
// Utility: Public Key Hash
// ============================================

/**
 * Compute Hash160 of a compressed public key (hex input).
 * Used for P2PKH script construction.
 */
export function pubkeyToHash160(pubKeyHex: string): string {
  return bytesToHex(hash160(hexToBytes(pubKeyHex)))
}

/**
 * SHA-256 hash a string (UTF-8 encoded).
 */
export function sha256String(data: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(data)))
}
