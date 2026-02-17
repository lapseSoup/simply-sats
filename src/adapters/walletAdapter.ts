/**
 * Wallet Adapter
 *
 * Bridges the old wallet.ts service with new domain layer.
 * Old code can import from here and get new implementations.
 * Once migration is complete, old services can be removed.
 */

// Re-export domain layer functions with same signatures as old code
export {
  deriveWalletKeys as restoreWallet,
  deriveKeysFromPath,
  keysFromWif,
  WALLET_PATHS
} from '../domain/wallet/keyDerivation'

export {
  validateMnemonic,
  normalizeMnemonic,
  isValidBSVAddress
} from '../domain/wallet/validation'

export {
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee,
  feeFromBytes,
  DEFAULT_FEE_RATE,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD
} from '../domain/transaction/fees'

export {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue
} from '../domain/transaction/coinSelection'

// Re-export types
export type {
  WalletKeys,
  KeyPair,
  UTXO,
  ExtendedUTXO,
  FeeEstimate,
  MaxSendResult
} from '../domain/types'

// Infrastructure adapters
export { createWocClient, getWocClient } from '../infrastructure/api/wocClient'
export { createFeeService, getFeeService } from '../infrastructure/api/feeService'

/**
 * Create wallet from new mnemonic
 * Thin wrapper that generates mnemonic then uses domain layer
 */
import * as bip39 from 'bip39'
import { deriveWalletKeys } from '../domain/wallet/keyDerivation'
import type { WalletKeys } from '../domain/types'

export async function createWallet(): Promise<WalletKeys> {
  const mnemonic = bip39.generateMnemonic()
  return deriveWalletKeys(mnemonic)
}
