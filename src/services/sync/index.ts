/**
 * Sync Service barrel re-export
 *
 * Re-exports all sync functionality so existing imports like
 * `from '../services/sync'` continue to work unchanged.
 */

// Re-export BASKETS from domain/types (single source of truth)
export { BASKETS } from '../../domain/types'

// --- Types (extracted to ./types to avoid circular imports) ---
export type { AddressInfo, SyncResult } from './types'

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
