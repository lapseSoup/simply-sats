/**
 * Sync Service barrel re-export
 *
 * Re-exports all sync functionality so existing imports like
 * `from '../services/sync'` continue to work unchanged.
 */

// Re-export BASKETS from domain/types (single source of truth)
export { BASKETS } from '../../domain/types'

// --- Types ---

// Address info for syncing
export interface AddressInfo {
  address: string
  basket: string
  wif?: string // Optional - for signing
  accountId?: number // Account ID for scoping data
}

// Sync result
export interface SyncResult {
  address: string
  basket: string
  newUtxos: number
  spentUtxos: number
  totalBalance: number
}

// --- Address Sync ---
export { syncAddress, getCurrentBlockHeight } from './addressSync'

// --- History Sync ---
// (syncTransactionHistory and calculateTxAmount are internal — not exported from original)

// --- UTXO Sync ---
export {
  getBalanceFromDatabase,
  getSpendableUtxosFromDatabase,
  mapDbLocksToLockedUtxos,
  getOrdinalsFromDatabase,
  recordSentTransaction,
  markUtxosSpent,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos
} from './utxoSync'

// --- Orchestration ---
export {
  cancelSync,
  startNewSync,
  isSyncInProgress,
  diagnoseSyncHealth,
  syncAllAddresses,
  syncWallet,
  needsInitialSync,
  getLastSyncTimeForAccount,
  clearSyncTimesForAccount,
  restoreFromBlockchain
} from './orchestration'

export type { SyncHealthResult } from './orchestration'
