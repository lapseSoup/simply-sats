/**
 * Database Row Types for Simply Sats
 *
 * These interfaces represent the raw database row structures returned from SQL queries.
 * They map directly to the database schema with snake_case column names.
 * Use these types with database.select<T[]>() to ensure type safety.
 */

// ============================================
// UTXO Table Rows
// ============================================

/**
 * Raw UTXO row from database (full row)
 */
export interface UTXORow {
  id: number
  txid: string
  vout: number
  satoshis: number
  locking_script: string
  address: string | null
  basket: string
  spendable: number  // 0 or 1
  created_at: number
  spent_at: number | null
  spent_txid: string | null
  spending_status: 'unspent' | 'pending' | 'spent' | null
  pending_spending_txid: string | null
  pending_since: number | null
}

/**
 * Partial UTXO row for existence checks
 */
export interface UTXOExistsRow {
  id: number
  basket: string
  address: string | null
  spendable: number
  spent_at: number | null
  account_id: number | null
}

/**
 * Partial UTXO row for verification
 */
export interface UTXOVerifyRow {
  id: number
  basket: string
  spendable: number
}

/**
 * Pending UTXO row for recovery
 */
export interface PendingUTXORow {
  txid: string
  vout: number
  satoshis: number
  pending_spending_txid: string
  pending_since: number
}

/**
 * Migration check row for address column
 */
export interface AddressCheckRow {
  address: string | null
}

/**
 * Migration check row for spending_status column
 */
export interface SpendingStatusCheckRow {
  spending_status: string | null
}

// ============================================
// Transaction Table Rows
// ============================================

/**
 * Raw transaction row from database
 */
export interface TransactionRow {
  id: number
  txid: string
  raw_tx: string | null
  description: string | null
  created_at: number
  confirmed_at: number | null
  block_height: number | null
  status: 'pending' | 'confirmed' | 'failed'
  amount: number | null
}

// ============================================
// Lock Table Rows
// ============================================

/**
 * Raw lock row from database
 */
export interface LockRow {
  id: number
  utxo_id: number
  unlock_block: number
  ordinal_origin: string | null
  created_at: number
  unlocked_at: number | null
  account_id: number
  lock_block: number | null
}

/**
 * Lock row with UTXO join
 */
export interface LockWithUTXORow extends LockRow {
  txid: string
  vout: number
  satoshis: number
  locking_script: string
  basket: string
  address: string | null
}

// ============================================
// Basket Table Rows
// ============================================

/**
 * Raw basket row from database
 */
export interface BasketRow {
  id: number
  name: string
  description: string | null
  created_at: number
}

// ============================================
// Sync State Table Rows
// ============================================

/**
 * Raw sync state row from database
 */
export interface SyncStateRow {
  address: string
  last_synced_height: number
  last_synced_at: number
}

// ============================================
// Derived Address Table Rows
// ============================================

/**
 * Raw derived address row from database
 */
export interface DerivedAddressRow {
  id: number
  address: string
  sender_pubkey: string
  invoice_number: string
  private_key_wif: string
  label: string | null
  created_at: number
  last_synced_at: number | null
  account_id: number
}

// ============================================
// Contact Table Rows
// ============================================

/**
 * Raw contact row from database
 */
export interface ContactRow {
  id: number
  pubkey: string
  label: string
  created_at: number
}

// ============================================
// Account Table Rows
// ============================================

/**
 * Raw account row from database
 */
export interface AccountRow {
  id: number
  name: string
  identity_address: string
  encrypted_keys: string
  is_active: number  // 0 or 1
  created_at: number
  last_accessed_at: number | null
  updated_at: number | null  // Added in migration 007
  derivation_index: number | null  // Added in migration 019
}

/**
 * Account settings row from database
 */
export interface AccountSettingRow {
  setting_key: string
  setting_value: string
  updated_at: number | null  // Added in migration 007
}

/**
 * Simple ID check row
 */
export interface IdCheckRow {
  id: number
}

// ============================================
// Action Results Table Rows
// ============================================

/**
 * Raw action result row from database
 */
export interface ActionResultRow {
  id: number
  request_id: string
  action_type: string
  description: string | null
  origin: string | null
  txid: string | null
  approved: number  // 0 or 1
  error: string | null
  input_params: string | null
  output_result: string | null
  requested_at: number
  completed_at: number | null
}

// ============================================
// Certificate Table Rows
// ============================================

/**
 * Raw certificate row from database
 */
export interface CertificateRow {
  id: number
  type: string
  subject: string
  certifier: string
  serial_number: string
  fields: string  // JSON string
  signature: string
  issued_at: number
  expires_at: number | null
  revocation_txid: string | null
  created_at: number
}

// ============================================
// Token Table Rows
// ============================================

/**
 * Raw token row from database
 */
export interface TokenRow {
  id: number
  ticker: string
  protocol: string
  contract_txid: string | null
  name: string | null
  decimals: number
  total_supply: string | null
  icon_url: string | null
  verified: number  // 0 or 1
  created_at: number
  updated_at: number | null  // Added in migration 007
}

/**
 * Token balance with token join
 */
export interface TokenBalanceRow {
  // From token_balances
  token_id: number
  account_id: number
  amount: string
  status: string
  created_at: number
  // From tokens join
  ticker: string
  protocol: string
  contract_txid: string | null
  name: string | null
  decimals: number
  total_supply: string | null
  icon_url: string | null
  verified: number
}

/**
 * Token transfer with token join
 */
export interface TokenTransferRow {
  id: number
  account_id: number
  token_id: number
  txid: string
  amount: string
  direction: string
  counterparty: string | null
  created_at: number
  // From tokens join
  ticker: string
  decimals: number
  icon_url: string | null
}

/**
 * Favorite token check row
 */
export interface FavoriteTokenRow {
  id: number
}

// ============================================
// Ordinal Cache Table Rows
// ============================================

/**
 * Raw ordinal cache row from database
 */
export interface OrdinalCacheRow {
  id: number
  origin: string
  txid: string
  vout: number
  satoshis: number
  content_type: string | null
  content_hash: string | null
  content_data: ArrayBuffer | null  // BLOB returns as ArrayBuffer
  content_text: string | null
  account_id: number | null
  fetched_at: number
}

/**
 * Ordinal cache stats row
 */
export interface OrdinalCacheStatsRow {
  count: number
  total_size: number
}

// ============================================
// Aggregate Query Rows
// ============================================

/**
 * Balance sum result
 */
export interface BalanceSumRow {
  total: number | null
}

/**
 * Count result
 */
export interface CountRow {
  count: number
}

/**
 * Tag row
 */
export interface TagRow {
  tag: string
}

/**
 * UTXO tag row with timestamp (migration 007)
 */
export interface UTXOTagRow {
  id: number
  utxo_id: number
  tag: string
  created_at: number | null  // Added in migration 007
}

/**
 * Transaction label row with timestamp (migration 007)
 */
export interface TransactionLabelRow {
  id: number
  txid: string
  label: string
  created_at: number | null  // Added in migration 007
}

/**
 * Connected app row from database
 */
export interface ConnectedAppRow {
  id: number
  account_id: number
  origin: string
  app_name: string | null
  app_icon: string | null
  permissions: string | null  // JSON array
  trusted: number  // 0 or 1
  connected_at: number
  last_used_at: number | null
  updated_at: number | null  // Added in migration 007
}

// ============================================
// Type for dynamic SQL parameters
// ============================================

/**
 * Valid SQL parameter types
 */
export type SqlParam = string | number | null | boolean

/**
 * Array of SQL parameters
 */
export type SqlParams = SqlParam[]
