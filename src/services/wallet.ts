/**
 * Wallet service - facade for backwards compatibility
 *
 * This file re-exports all functionality from the modular wallet/ directory.
 * New code should import directly from './wallet/index' or specific modules.
 *
 * Modules:
 * - wallet/types.ts     - Type definitions
 * - wallet/core.ts      - Wallet creation, restoration, import
 * - wallet/storage.ts   - Save, load, clear wallet
 * - wallet/fees.ts      - Fee calculation and management
 * - wallet/balance.ts   - Balance and UTXO fetching
 * - wallet/transactions.ts - Transaction building and broadcasting
 * - wallet/ordinals.ts  - 1Sat Ordinals operations
 * - wallet/locks.ts     - Time lock (OP_PUSH_TX) operations
 */

// Types
export type {
  WalletType,
  WalletKeys,
  PublicWalletKeys,
  KeyType,
  UTXO,
  ExtendedUTXO,
  WocUtxo,
  WocHistoryItem,
  WocTxOutput,
  WocTxInput,
  WocTransaction,
  GpOrdinalOrigin,
  GpOrdinalItem,
  ShaulletBackup,
  OneSatWalletBackup,
  Ordinal,
  LockedUTXO
} from './wallet/types'

// Key store bridge
export { getWifForOperation } from './wallet/types'

// Core wallet operations
export {
  createWallet,
  restoreWallet,
  importFromShaullet,
  importFrom1SatOrdinals,
  importFromJSON,
  verifyMnemonicMatchesWallet,
  WALLET_PATHS
} from './wallet/core'

// Storage operations
export {
  saveWallet,
  saveWalletUnprotected,
  loadWallet,
  hasWallet,
  hasPassword,
  clearWallet,
  changePassword
} from './wallet/storage'

// Fee operations
export {
  fetchDynamicFeeRate,
  getFeeRate,
  getFeeRateAsync,
  setFeeRate,
  clearFeeRateOverride,
  getFeeRatePerKB,
  setFeeRateFromKB,
  feeFromBytes,
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee
} from './wallet/fees'

// Balance and UTXO operations
export {
  getBalance,
  getBalanceFromDB,
  getUTXOsFromDB,
  getUTXOs,
  getUTXOLockingScript,
  getTransactionHistory,
  getTransactionDetails,
  calculateTxAmount
} from './wallet/balance'

// Transaction operations
export {
  broadcastTransaction,
  sendBSV,
  getAllSpendableUTXOs,
  sendBSVMultiKey,
  consolidateUtxos
} from './wallet/transactions'

// Ordinal operations
export {
  getOrdinals,
  getOrdinalDetails,
  scanHistoryForOrdinals,
  transferOrdinal
} from './wallet/ordinals'

// Lock operations
export {
  getTimelockScriptSize,
  lockBSV,
  unlockBSV,
  getCurrentBlockHeight,
  generateUnlockTxHex,
  detectLockedUtxos,
  hex2Int
} from './wallet/locks'
