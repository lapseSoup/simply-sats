/**
 * Core domain types for Simply Sats
 * These are pure data types with no dependencies on infrastructure
 */

// ============================================
// Result Type (Functional Error Handling)
// ============================================

/**
 * A Result type for explicit error handling without exceptions.
 * Use this for operations that can fail in expected ways.
 *
 * @example
 * ```ts
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('Division by zero')
 *   return ok(a / b)
 * }
 *
 * const result = divide(10, 2)
 * if (isOk(result)) {
 *   console.log(result.value) // 5
 * } else {
 *   console.error(result.error) // Never reached
 * }
 * ```
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

/**
 * Create a successful Result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

/**
 * Create a failed Result
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

/**
 * Type guard to check if a Result is successful
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok
}

/**
 * Type guard to check if a Result is an error
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok
}

/**
 * Unwrap a Result, throwing if it's an error.
 * Use sparingly - prefer pattern matching with isOk/isErr.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value
  }
  throw result.error instanceof Error ? result.error : new Error(String(result.error))
}

/**
 * Unwrap a Result with a default value if it's an error.
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  return isOk(result) ? result.value : defaultValue
}

/**
 * Map over a successful Result's value.
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  return isOk(result) ? ok(fn(result.value)) : result
}

/**
 * Chain Results together (flatMap).
 */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return isOk(result) ? fn(result.value) : result
}

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
  accountIndex?: number
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

/**
 * Convert a database UTXO (with lockingScript) to a wallet UTXO (with script).
 * This mapping is repeated across many service and component files.
 */
export function toWalletUtxo(dbUtxo: { txid: string; vout: number; satoshis: number; lockingScript: string; address?: string }): UTXO {
  return { txid: dbUtxo.txid, vout: dbUtxo.vout, satoshis: dbUtxo.satoshis, script: dbUtxo.lockingScript }
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

/** Common result type for wallet operations (send, lock, unlock, transfer, list) */
export type WalletResult = Result<{ txid: string; warning?: string }, string>

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
  lockingScript: string
  unlockBlock: number
  publicKeyHex: string
  createdAt: number
  lockBlock?: number
  /** Block height where tx was confirmed (from API, not stored in DB) */
  confirmationBlock?: number
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
  blockHeight?: number
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
// Contact Types
// ============================================

export interface Contact {
  id?: number
  pubkey: string
  label: string
  createdAt: number
}

// ============================================
// GorillaPool API Response Types
// (Used by domain/ordinals/parsing for mapping external data)
// ============================================

export interface GpOrdinalOrigin {
  outpoint?: string
  data?: {
    insc?: {
      file?: {
        type?: string
        hash?: string
      }
    }
  }
}

export interface GpOrdinalItem {
  txid: string
  vout: number
  satoshis?: number
  outpoint?: string
  origin?: GpOrdinalOrigin
  height?: number
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
