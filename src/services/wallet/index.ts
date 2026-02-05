/**
 * Wallet module index
 * Re-exports all wallet functionality for backwards compatibility
 */

// Types
export type {
  WalletType,
  WalletKeys,
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
} from './types'

// Core wallet operations
export {
  createWallet,
  restoreWallet,
  importFromShaullet,
  importFrom1SatOrdinals,
  importFromJSON,
  verifyMnemonicMatchesWallet,
  WALLET_PATHS
} from './core'

// Storage operations
export {
  saveWallet,
  loadWallet,
  hasWallet,
  clearWallet,
  changePassword
} from './storage'

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
} from './fees'

// Balance and UTXO operations
export {
  getBalance,
  getBalanceFromDB,
  getUTXOsFromDB,
  getUTXOs,
  getTransactionHistory,
  getTransactionDetails,
  calculateTxAmount
} from './balance'

// Transaction operations
export {
  broadcastTransaction,
  sendBSV,
  getAllSpendableUTXOs,
  sendBSVMultiKey
} from './transactions'

// Ordinal operations
export {
  getOrdinals,
  getOrdinalDetails,
  scanHistoryForOrdinals,
  transferOrdinal
} from './ordinals'

// Lock operations
export {
  getTimelockScriptSize,
  lockBSV,
  unlockBSV,
  getCurrentBlockHeight,
  generateUnlockTxHex,
  detectLockedUtxos,
  hex2Int
} from './locks'
