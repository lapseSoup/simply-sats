/**
 * Wallet type definitions
 * Extracted from wallet.ts for modularity
 *
 * Core types (WalletKeys, UTXO, ExtendedUTXO, Ordinal, LockedUTXO) are
 * canonical in domain/types.ts and re-exported here for backward compatibility.
 */

// Re-export canonical domain types
export type {
  ActiveWallet,
  PublicWalletKeys,
  SessionWallet,
  WalletKeys,
  UTXO,
  ExtendedUTXO,
  Ordinal,
  LockedUTXO
} from '../../domain/types'
import type { ActiveWallet, PublicWalletKeys, SessionWallet, WalletKeys } from '../../domain/types'
import { hasPrivateKeyMaterial } from '../../domain/types'
import { isTauri, tauriInvoke } from '../../utils/tauri'

// Wallet type - simplified to just BRC-100/Yours standard
export type WalletType = 'yours'

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
 * Strip mnemonic and WIFs before putting wallet data into long-lived React state.
 *
 * In Tauri, the Rust key store owns sensitive material. Browser/test environments
 * keep the original keys so local fallback paths continue to work.
 */
export function sanitizeWalletForSession(keys: ActiveWallet): ActiveWallet {
  if (!isTauri() || !hasPrivateKeyMaterial(keys)) return keys

  return toSessionWallet(keys, keys.accountIndex)
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

function toPublicWalletKeys(keys: ActiveWallet): PublicWalletKeys {
  return {
    walletType: keys.walletType,
    walletAddress: keys.walletAddress,
    walletPubKey: keys.walletPubKey,
    ordAddress: keys.ordAddress,
    ordPubKey: keys.ordPubKey,
    identityAddress: keys.identityAddress,
    identityPubKey: keys.identityPubKey
  }
}

export function toSessionWallet(keys: PublicWalletKeys, accountIndex?: number): SessionWallet {
  return {
    walletType: keys.walletType as WalletKeys['walletType'],
    walletAddress: keys.walletAddress,
    walletPubKey: keys.walletPubKey,
    ordAddress: keys.ordAddress,
    ordPubKey: keys.ordPubKey,
    identityAddress: keys.identityAddress,
    identityPubKey: keys.identityPubKey,
    accountIndex
  }
}

/**
 * Fetch the current public wallet keys from the native store.
 *
 * In browser/test environments, falls back to the current wallet object.
 */
export async function getPublicKeysFromStore(
  fallbackKeys?: ActiveWallet
): Promise<PublicWalletKeys> {
  if (isTauri()) {
    const keys = await tauriInvoke<PublicWalletKeys | null>('get_public_keys')
    if (!keys) {
      throw new Error('Wallet is locked — no public keys available')
    }
    return keys
  }

  if (!fallbackKeys) {
    throw new Error('No public keys available — not in Tauri and no fallback keys provided')
  }
  return toPublicWalletKeys(fallbackKeys)
}

/**
 * Reveal a private key only for explicit display/export UX.
 *
 * This uses a dedicated Tauri command rather than the generic operation bridge.
 */
export async function getPrivateKeyForDisplay(
  keyType: KeyType,
  fallbackKeys?: ActiveWallet
): Promise<string> {
  if (isTauri()) {
    return tauriInvoke<string>('reveal_private_key_from_store', { keyType })
  }

  if (!hasPrivateKeyMaterial(fallbackKeys)) {
    throw new Error(`No private key available for display (${keyType})`)
  }
  switch (keyType) {
    case 'wallet': return fallbackKeys.walletWif
    case 'ordinals': return fallbackKeys.ordWif
    case 'identity': return fallbackKeys.identityWif
    default: throw new Error(`Invalid key type: ${keyType as string}`)
  }
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
