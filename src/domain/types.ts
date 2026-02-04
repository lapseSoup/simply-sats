/**
 * Core domain types for Simply Sats
 * These are pure data types with no dependencies on infrastructure
 */

// ============================================
// Wallet Types
// ============================================

export interface WalletKeys {
  mnemonic: string
  walletType: 'yours'
  walletWif: string
  walletAddress: string
  walletPubKey: string
  ordWif: string
  ordAddress: string
  ordPubKey: string
  identityWif: string
  identityAddress: string
  identityPubKey: string
}

export interface KeyPair {
  wif: string
  address: string
  pubKey: string
}

// ============================================
// UTXO Types
// ============================================

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  script: string
}

export interface ExtendedUTXO extends UTXO {
  wif: string
  address: string
}

export interface DBUtxo {
  id?: number
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  address?: string
  basket: string
  spendable: boolean
  createdAt: number
  spentAt?: number
  spentTxid?: string
  tags?: string[]
}

// ============================================
// Transaction Types
// ============================================

export interface TransactionRecord {
  id?: number
  txid: string
  rawTx?: string
  description?: string
  createdAt: number
  confirmedAt?: number
  blockHeight?: number
  status: 'pending' | 'confirmed' | 'failed'
  labels?: string[]
  amount?: number
}

export interface SendResult {
  success: boolean
  txid?: string
  error?: string
}

// ============================================
// Lock Types
// ============================================

export interface Lock {
  id?: number
  utxoId: number
  unlockBlock: number
  ordinalOrigin?: string
  createdAt: number
  unlockedAt?: number
}

export interface LockedUTXO {
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  blocksRemaining: number
  spendable: boolean
  lockingScript?: string
}

export interface LockedOutput {
  outpoint: string
  txid: string
  vout: number
  satoshis: number
  unlockBlock: number
  tags: string[]
  spendable: boolean
  blocksRemaining: number
}

// ============================================
// Ordinal Types
// ============================================

export interface Ordinal {
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  content?: string
  number?: number
}

// ============================================
// Token Types
// ============================================

export interface TokenBalance {
  ticker: string
  protocol: 'bsv20' | 'bsv21'
  confirmed: string
  pending: string
  id?: string
  decimals?: number
  icon?: string
  sym?: string
}

// ============================================
// Account Types
// ============================================

export interface Account {
  id?: number
  name: string
  encryptedMnemonic: string
  walletAddress: string
  ordAddress: string
  identityAddress: string
  createdAt: number
  isActive: boolean
}

// ============================================
// Network Types
// ============================================

export interface NetworkInfo {
  blockHeight: number
  overlayHealthy: boolean
  overlayNodeCount: number
}

// ============================================
// Fee Types
// ============================================

export interface FeeEstimate {
  fee: number
  inputCount: number
  outputCount: number
  totalInput: number
  canSend: boolean
}

export interface MaxSendResult {
  maxSats: number
  fee: number
  numInputs: number
}

// ============================================
// Basket Constants
// ============================================

export const BASKETS = {
  DEFAULT: 'default',
  ORDINALS: 'ordinals',
  IDENTITY: 'identity',
  LOCKS: 'locks',
  WROOTZ_LOCKS: 'wrootz_locks',
  DERIVED: 'derived'
} as const

export type BasketType = typeof BASKETS[keyof typeof BASKETS]
