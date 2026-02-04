/**
 * Transaction Domain - TX building, fee calculation, coin selection
 */

export {
  calculateTxFee,
  calculateLockFee,
  calculateMaxSend,
  calculateExactFee,
  feeFromBytes,
  varintSize,
  clampFeeRate,
  P2PKH_INPUT_SIZE,
  P2PKH_OUTPUT_SIZE,
  TX_OVERHEAD,
  DEFAULT_FEE_RATE,
  MIN_FEE_RATE,
  MAX_FEE_RATE
} from './fees'

export {
  selectCoins,
  selectCoinsMultiKey,
  sortUtxosByValue,
  needsChangeOutput
} from './coinSelection'

export type { CoinSelectionResult } from './coinSelection'
