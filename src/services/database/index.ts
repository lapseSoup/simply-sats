/**
 * Database Service Module
 *
 * Re-exports all database functionality for backward compatibility.
 * Import from this module or directly from specific repository files.
 */

// Connection management
export { initDatabase, getDatabase, withTransaction, closeDatabase } from './connection'

// Entity types
export type {
  UTXO,
  Transaction,
  Lock,
  Basket,
  DerivedAddress,
  Contact,
  ActionResult,
  DatabaseBackup
} from './types'

// UTXO operations
export {
  addUTXO,
  getUTXOsByBasket,
  getSpendableUTXOs,
  getSpendableUTXOsByAddress,
  markUTXOSpent,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos,
  getBalanceFromDB,
  getAllUTXOs,
  repairUTXOs,
  toggleUtxoFrozen,
  getUtxoByOutpoint
} from './utxoRepository'

// Transaction operations
export {
  addTransaction,
  upsertTransaction,
  getAllTransactions,
  getTransactionByTxid,
  updateTransactionAmount,
  getTransactionsByLabel,
  updateTransactionStatus,
  updateTransactionLabels,
  getTransactionLabels,
  getAllLabels,
  getTopLabels,
  searchTransactions,
  searchTransactionsByLabels
} from './txRepository'

// Lock operations
export {
  addLock,
  getLocks,
  markLockUnlocked,
  markLockUnlockedByTxid,
  getAllLocks,
  updateLockBlock
} from './lockRepository'

// Sync state operations
export {
  getLastSyncedHeight,
  updateSyncState,
  getAllSyncStates
} from './syncRepository'

// Basket operations
export {
  getBaskets,
  createBasket,
  ensureBasket
} from './basketRepository'

// Derived address operations
export {
  ensureDerivedAddressesTable,
  addDerivedAddress,
  getDerivedAddresses,
  getDerivedAddressByAddress,
  updateDerivedAddressSyncTime,
  deleteDerivedAddress,
  exportSenderPubkeys,
  getDerivedAddressCount,
  getNextInvoiceNumber
} from './addressRepository'

// Contact operations
export {
  ensureContactsTable,
  addContact,
  getContacts,
  getContactByPubkey,
  updateContactLabel,
  deleteContact
} from './contactRepository'

// Action result operations
export {
  ensureActionResultsTable,
  recordActionRequest,
  updateActionResult,
  getRecentActionResults,
  getActionResultsByOrigin,
  getActionResultByTxid
} from './actionRepository'

// Backup/restore operations
export {
  exportDatabase,
  importDatabase,
  clearDatabase,
  resetUTXOs
} from './backup'
