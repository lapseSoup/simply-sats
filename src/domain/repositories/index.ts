/**
 * Repository Interfaces
 *
 * Defines abstract interfaces for data access, enabling:
 * - Testability through mocking
 * - Potential backend swaps (SQLite → IndexedDB, etc.)
 * - Clear separation of concerns
 *
 * @module domain/repositories
 */

import type { UTXO, Ordinal, LockedUTXO } from '../../services/wallet'
import type { Contact } from '../../services/database'
import type { Account } from '../../services/accounts'
import type { TokenBalance } from '../../services/tokens'

// ============================================
// Transaction Repository
// ============================================

export interface TransactionRecord {
  txid: string
  blockHeight: number | null
  amount?: number
  timestamp?: number
  status: 'confirmed' | 'pending' | 'failed'
  labels?: string[]
}

export interface ITransactionRepository {
  /** Get all transactions, optionally limited */
  getAll(limit?: number): Promise<TransactionRecord[]>

  /** Get a single transaction by txid */
  getByTxid(txid: string): Promise<TransactionRecord | null>

  /** Save a transaction */
  save(tx: TransactionRecord): Promise<void>

  /** Update transaction status/height */
  update(txid: string, updates: Partial<TransactionRecord>): Promise<void>

  /** Delete a transaction */
  delete(txid: string): Promise<void>

  /** Get transactions by address */
  getByAddress(address: string, limit?: number): Promise<TransactionRecord[]>
}

// ============================================
// UTXO Repository
// ============================================

export interface DBUtxo extends UTXO {
  basket: string
  address: string
  isSpendable: boolean
  isReserved: boolean
  accountId?: number
}

export interface IUtxoRepository {
  /** Get all UTXOs for an account */
  getAll(accountId: number): Promise<DBUtxo[]>

  /** Get spendable UTXOs */
  getSpendable(accountId: number, basket?: string): Promise<DBUtxo[]>

  /** Get UTXOs by basket */
  getByBasket(accountId: number, basket: string): Promise<DBUtxo[]>

  /** Save or update a UTXO */
  save(utxo: DBUtxo): Promise<void>

  /** Save multiple UTXOs */
  saveMany(utxos: DBUtxo[]): Promise<void>

  /** Mark UTXO as spent */
  markSpent(txid: string, vout: number): Promise<void>

  /** Mark UTXO as reserved (for pending transactions) */
  markReserved(txid: string, vout: number, reserved: boolean): Promise<void>

  /** Delete UTXOs by txid:vout */
  delete(txid: string, vout: number): Promise<void>

  /** Get balance by basket */
  getBalance(accountId: number, basket?: string): Promise<number>
}

// ============================================
// Ordinal Repository
// ============================================

export interface DBOrdinal extends Ordinal {
  accountId: number
  origin: string
}

export interface IOrdinalRepository {
  /** Get all ordinals for an account */
  getAll(accountId: number): Promise<DBOrdinal[]>

  /** Get ordinal by origin */
  getByOrigin(origin: string): Promise<DBOrdinal | null>

  /** Save or update an ordinal */
  save(ordinal: DBOrdinal): Promise<void>

  /** Save multiple ordinals */
  saveMany(ordinals: DBOrdinal[]): Promise<void>

  /** Delete an ordinal */
  delete(origin: string): Promise<void>

  /** Update ordinal location (after transfer) */
  updateLocation(origin: string, txid: string, vout: number): Promise<void>
}

// ============================================
// Lock Repository
// ============================================

export interface DBLock extends LockedUTXO {
  accountId: number
  tags?: string[]
}

export interface ILockRepository {
  /** Get all locks for an account */
  getAll(accountId: number): Promise<DBLock[]>

  /** Get locks that can be unlocked (block height reached) */
  getUnlockable(accountId: number, currentBlockHeight: number): Promise<DBLock[]>

  /** Save a lock */
  save(lock: DBLock): Promise<void>

  /** Delete a lock (after unlock) */
  delete(txid: string, vout: number): Promise<void>

  /** Get total locked amount */
  getTotalLocked(accountId: number): Promise<number>
}

// ============================================
// Contact Repository
// ============================================

export interface IContactRepository {
  /** Get all contacts */
  getAll(): Promise<Contact[]>

  /** Get contact by address */
  getByAddress(address: string): Promise<Contact | null>

  /** Save or update a contact */
  save(contact: Contact): Promise<void>

  /** Delete a contact */
  delete(address: string): Promise<void>

  /** Search contacts by name or address */
  search(query: string): Promise<Contact[]>
}

// ============================================
// Account Repository
// ============================================

export interface IAccountRepository {
  /** Get all accounts */
  getAll(): Promise<Account[]>

  /** Get active account */
  getActive(): Promise<Account | null>

  /** Get account by ID */
  getById(id: number): Promise<Account | null>

  /** Create a new account */
  create(account: Omit<Account, 'id'>): Promise<Account>

  /** Update an account */
  update(id: number, updates: Partial<Account>): Promise<void>

  /** Delete an account */
  delete(id: number): Promise<void>

  /** Set active account */
  setActive(id: number): Promise<void>
}

// ============================================
// Token Repository
// ============================================

export interface DBTokenBalance extends TokenBalance {
  accountId: number
}

export interface ITokenRepository {
  /** Get all token balances for an account */
  getAll(accountId: number): Promise<DBTokenBalance[]>

  /** Get balance for a specific token */
  getByTicker(accountId: number, ticker: string, protocol: 'bsv20' | 'bsv21'): Promise<DBTokenBalance | null>

  /** Save or update token balance */
  save(balance: DBTokenBalance): Promise<void>

  /** Save multiple token balances */
  saveMany(balances: DBTokenBalance[]): Promise<void>

  /** Delete token balance */
  delete(accountId: number, ticker: string, protocol: 'bsv20' | 'bsv21'): Promise<void>
}

// ============================================
// Audit Log Repository (Phase 4)
// ============================================

export type AuditAction =
  | 'wallet_created'
  | 'wallet_restored'
  | 'wallet_unlocked'
  | 'wallet_locked'
  | 'unlock_failed'
  | 'transaction_sent'
  | 'transaction_received'
  | 'lock_created'
  | 'lock_released'
  | 'origin_trusted'
  | 'origin_removed'
  | 'app_connected'
  | 'app_disconnected'
  | 'account_created'
  | 'account_deleted'
  | 'account_switched'

export interface AuditLogEntry {
  id: number
  timestamp: number
  action: AuditAction
  details?: Record<string, unknown>
  accountId?: number
  origin?: string
  txid?: string
}

export interface IAuditLogRepository {
  /** Log an action */
  log(action: AuditAction, details?: Record<string, unknown>): Promise<void>

  /** Get recent log entries */
  getRecent(limit?: number): Promise<AuditLogEntry[]>

  /** Get log entries by action type */
  getByAction(action: AuditAction, limit?: number): Promise<AuditLogEntry[]>

  /** Get log entries for an account */
  getByAccount(accountId: number, limit?: number): Promise<AuditLogEntry[]>

  /** Export all logs (for backup) */
  exportAll(): Promise<AuditLogEntry[]>

  /** Clear old logs (retention policy) */
  clearOlderThan(timestamp: number): Promise<number>
}

// ============================================
// Repository Factory Interface
// ============================================

export interface IRepositoryFactory {
  transactions: ITransactionRepository
  utxos: IUtxoRepository
  ordinals: IOrdinalRepository
  locks: ILockRepository
  contacts: IContactRepository
  accounts: IAccountRepository
  tokens: ITokenRepository
  auditLog: IAuditLogRepository
}
