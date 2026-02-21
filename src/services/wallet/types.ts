/**
 * Wallet type definitions
 * Extracted from wallet.ts for modularity
 */

// Wallet type - simplified to just BRC-100/Yours standard
export type WalletType = 'yours'

export interface WalletKeys {
  mnemonic: string
  walletType: WalletType
  /** @deprecated Use getWifForOperation() — WIF should not live in JS state in production. */
  walletWif: string
  walletAddress: string
  walletPubKey: string
  /** @deprecated Use getWifForOperation() — WIF should not live in JS state in production. */
  ordWif: string
  ordAddress: string
  ordPubKey: string
  /** @deprecated Use getWifForOperation() — WIF should not live in JS state in production. */
  identityWif: string
  identityAddress: string
  identityPubKey: string
  /** BIP-44 account index used for key derivation. Added to eliminate WIF transit over IPC. */
  accountIndex?: number
}

/**
 * Unprotected wallet data — plaintext keys stored in OS keychain.
 * Used when user opts out of password protection during setup.
 * version: 0 distinguishes this from EncryptedData (version: 1).
 */
export interface UnprotectedWalletData {
  version: 0
  mode: 'unprotected'
  keys: WalletKeys
}

/**
 * Type guard for UnprotectedWalletData
 */
export function isUnprotectedData(data: unknown): data is UnprotectedWalletData {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return obj.version === 0 && obj.mode === 'unprotected' && typeof obj.keys === 'object'
}

/**
 * Key type for retrieving WIFs from the Rust key store.
 */
export type KeyType = 'wallet' | 'ordinals' | 'identity'

/**
 * Retrieve a WIF from the Rust key store for a single operation.
 *
 * In Tauri (desktop), this fetches the WIF from Rust memory and returns it
 * for the duration of one operation. The caller MUST NOT persist the value.
 *
 * In browser dev mode, falls back to reading from the WalletKeys object.
 *
 * @param keyType - Which key to retrieve: 'wallet', 'ordinals', or 'identity'
 * @param operation - Descriptive label for audit logging (e.g. 'lockBSV')
 * @param fallbackKeys - WalletKeys object for browser dev mode fallback
 */
export async function getWifForOperation(
  keyType: KeyType,
  operation: string,
  fallbackKeys?: WalletKeys
): Promise<string> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<string>('get_wif_for_operation', { keyType, operation })
  }

  // Browser dev mode fallback
  if (!fallbackKeys) {
    throw new Error(`No WIF available for '${operation}' — not in Tauri and no fallback keys provided`)
  }
  switch (keyType) {
    case 'wallet': return fallbackKeys.walletWif
    case 'ordinals': return fallbackKeys.ordWif
    case 'identity': return fallbackKeys.identityWif
    default: throw new Error(`Invalid key type: ${keyType as string}`)
  }
}

/**
 * Public-only wallet keys — returned from Rust key store.
 * Contains addresses and public keys but NO private keys or mnemonic.
 * Use _from_store Tauri commands for operations that need private keys.
 */
export interface PublicWalletKeys {
  walletType: string
  walletAddress: string
  walletPubKey: string
  ordAddress: string
  ordPubKey: string
  identityAddress: string
  identityPubKey: string
}

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

// Extended UTXO type that includes WIF for multi-key spending
export interface ExtendedUTXO extends UTXO {
  wif: string
  address: string
}

// WhatsOnChain API response types
export interface WocUtxo {
  tx_hash: string
  tx_pos: number
  value: number
  height?: number
}

export interface WocHistoryItem {
  tx_hash: string
  height: number
}

export interface WocTxOutput {
  value: number
  n: number
  scriptPubKey: {
    asm: string
    hex: string
    reqSigs?: number
    type: string
    addresses?: string[]
  }
}

export interface WocTxInput {
  txid?: string         // Absent for coinbase transactions
  vout?: number         // Absent for coinbase transactions
  scriptSig?: {         // Absent for coinbase transactions
    asm: string
    hex: string
  }
  sequence: number
  coinbase?: string     // Present only for coinbase transactions
  // prevout is included in some API responses
  prevout?: {
    value: number
    scriptPubKey: {
      addresses?: string[]
    }
  }
}

export interface WocTransaction {
  txid: string
  hash: string
  version: number
  size: number
  locktime: number
  vin: WocTxInput[]
  vout: WocTxOutput[]
  blockhash?: string
  confirmations?: number
  time?: number
  blocktime?: number
  blockheight?: number
}

// GorillaPool Ordinals API response types — canonical source in domain/types.ts
export type { GpOrdinalOrigin, GpOrdinalItem } from '../../domain/types'

// Backup format types
export interface ShaulletBackup {
  mnemonic?: string
  seed?: string
  keys?: {
    privateKey?: string
    wif?: string
  }
}

// 1Sat Ordinals wallet JSON format
export interface OneSatWalletBackup {
  ordPk?: string      // Ordinals private key (WIF)
  payPk?: string      // Payment private key (WIF)
  mnemonic?: string   // Optional mnemonic
}

// 1Sat Ordinals types
export interface Ordinal {
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  content?: string
  blockHeight?: number
}

// Ordinal details from GorillaPool API
export interface OrdinalDetails {
  origin?: string
  txid?: string
  vout?: number
  height?: number
  idx?: number
  data?: {
    insc?: {
      file?: {
        type?: string
        size?: number
        hash?: string
      }
      text?: string
      json?: Record<string, unknown>
    }
    map?: Record<string, string>
    bsv20?: {
      tick?: string
      amt?: string
      op?: string
    }
  }
  owner?: string
  satoshis?: number
  spend?: string // Spending txid if this ordinal has been spent
}

// Locked UTXO type
export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  unlockBlock: number
  publicKeyHex: string
  createdAt: number
  lockBlock?: number
  /** Block height where tx was confirmed (from API, not stored in DB) */
  confirmationBlock?: number
}
