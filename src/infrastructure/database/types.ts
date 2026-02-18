/**
 * Database Entity Types
 *
 * Application-level types for database entities.
 * These are the types used throughout the application,
 * distinct from the raw database row types.
 */

// UTXO type matching database schema
export interface UTXO {
  id?: number
  txid: string
  vout: number
  satoshis: number
  lockingScript: string
  address?: string  // The address this UTXO belongs to (optional for backwards compat)
  basket: string
  spendable: boolean
  createdAt: number
  spentAt?: number
  spentTxid?: string
  tags?: string[]
}

// Transaction type
export interface Transaction {
  id?: number
  txid: string
  rawTx?: string
  description?: string
  createdAt: number
  confirmedAt?: number
  blockHeight?: number
  status: 'pending' | 'confirmed' | 'failed'
  labels?: string[]
  amount?: number  // Net satoshis: positive = received, negative = sent
}

// Lock type (for time-locked outputs)
export interface Lock {
  id?: number
  utxoId: number
  unlockBlock: number
  ordinalOrigin?: string
  createdAt: number
  unlockedAt?: number
  lockBlock?: number
}

// Basket type
export interface Basket {
  id?: number
  name: string
  description?: string
  createdAt: number
}

// Derived address type
export interface DerivedAddress {
  id?: number
  address: string
  senderPubkey: string
  invoiceNumber: string
  privateKeyWif: string
  label?: string
  createdAt: number
  lastSyncedAt?: number
  accountId?: number
}

// Contact type — canonical source in domain/types.ts
import type { Contact } from '../../domain/types'
export type { Contact }

// BRC-100 action result for tracking createAction outcomes
export interface ActionResult {
  id?: number
  // Unique request ID from the BRC-100 request
  requestId: string
  // Type of action (createAction, signAction, etc.)
  actionType: string
  // Description from the request
  description: string
  // Origin app that requested this action
  origin?: string
  // Transaction ID if a transaction was created
  txid?: string
  // Whether the action was approved by user
  approved: boolean
  // Error message if action failed
  error?: string
  // JSON blob of input parameters
  inputParams?: string
  // JSON blob of output result
  outputResult?: string
  // When the action was requested
  requestedAt: number
  // When the action was completed/rejected
  completedAt?: number
}

// Cached ordinal content (for content previews and offline access)
export interface CachedOrdinal {
  id?: number
  origin: string
  txid: string
  vout: number
  satoshis: number
  contentType?: string
  contentHash?: string
  contentData?: Uint8Array  // Binary content (images)
  contentText?: string      // Text/JSON content
  accountId?: number
  fetchedAt: number
}

// Database backup format
export interface DatabaseBackup {
  version: number
  exportedAt: number
  utxos: UTXO[]
  transactions: Transaction[]
  locks: Lock[]
  baskets: Basket[]
  syncState: { address: string; height: number; syncedAt: number }[]
  derivedAddresses?: DerivedAddress[]  // Added in version 2
  contacts?: Contact[]  // Added in version 3
  ordinalCache?: CachedOrdinal[]  // Added in version 4 (full backups only)
}
