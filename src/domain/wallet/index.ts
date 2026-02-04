/**
 * Wallet Domain - Key derivation, signing, encryption
 */

export {
  deriveKeysFromPath,
  deriveWalletKeys,
  keysFromWif,
  WALLET_PATHS
} from './keyDerivation'

export {
  normalizeMnemonic,
  validateMnemonic,
  isValidBSVAddress,
  isValidTxid,
  isValidSatoshiAmount
} from './validation'

export type { MnemonicValidationResult } from './validation'
