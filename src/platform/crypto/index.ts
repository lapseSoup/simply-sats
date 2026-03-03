/**
 * Pure TypeScript Crypto Layer
 *
 * Re-exports all crypto functions needed by the Chrome extension adapter.
 * These functions produce byte-identical output to the Rust backend.
 *
 * @module platform/crypto
 */

export {
  deriveWalletKeys,
  keysFromWif,
  privateKeyToWif,
  wifToPrivateKey,
  privateKeyToPublicKey,
  privateKeyToPublicKeyHex,
  publicKeyToAddress,
  privateKeyToAddress,
  wifToAddress,
  pubkeyToHash160,
  sha256String,
  bytesToHex,
  hexToBytes,
  doubleSha256,
} from './keys'

export {
  deriveChildKey,
  getDerivedAddresses,
  findDerivedKeyForAddress,
  deriveTaggedKey,
  ecdhSharedKey,
} from './brc42'

export {
  buildP2PKHTx,
  buildMultiKeyP2PKHTx,
  buildConsolidationTx,
  buildMultiOutputP2PKHTx,
} from './transaction'

export {
  signMessage,
  signData,
  verifyMessageSignature,
  verifyDataSignature,
  eciesEncrypt,
  eciesDecrypt,
} from './signing'
