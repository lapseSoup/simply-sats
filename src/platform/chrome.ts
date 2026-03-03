/**
 * Chrome Extension Platform Adapter (Stub)
 *
 * This is a placeholder that will be implemented in Phase 2.
 * Each method throws a descriptive error until the pure TypeScript
 * crypto layer is built.
 *
 * @module platform/chrome
 */

import type {
  PlatformAdapter,
  DerivedKeyResult,
  DerivedAddressResult,
  DerivationTag,
  TaggedKeyResult,
  BuildP2PKHTxParams,
  BuildMultiKeyP2PKHTxParams,
  BuildConsolidationTxParams,
  BuildMultiOutputP2PKHTxParams,
  BuiltTransaction,
  BuiltConsolidationTransaction,
  BuiltMultiOutputTransaction,
  RateLimitCheckResult,
  FailedUnlockResult,
  EncryptedData,
  PublicWalletKeys,
} from './types'
import type { WalletKeys, KeyPair } from '../domain/types'

function notImplemented(method: string): never {
  throw new Error(`ChromeAdapter.${method}() is not yet implemented. Phase 2 required.`)
}

/**
 * Chrome extension platform adapter.
 * Uses pure TypeScript crypto + chrome.storage APIs.
 *
 * TODO: Implement in Phase 2 with @noble/secp256k1
 */
export class ChromeAdapter implements PlatformAdapter {
  readonly platform = 'chrome-extension' as const

  // ----- Key Derivation -----
  async deriveWalletKeys(_mnemonic: string): Promise<WalletKeys> { return notImplemented('deriveWalletKeys') }
  async deriveWalletKeysForAccount(_mnemonic: string, _accountIndex: number): Promise<WalletKeys> { return notImplemented('deriveWalletKeysForAccount') }
  async keysFromWif(_wif: string): Promise<KeyPair> { return notImplemented('keysFromWif') }

  // ----- BRC-42/43 -----
  async deriveChildKey(_receiverWif: string, _senderPubKeyHex: string, _invoiceNumber: string): Promise<DerivedKeyResult> { return notImplemented('deriveChildKey') }
  async deriveChildKeyFromStore(_keyType: string, _senderPubKeyHex: string, _invoiceNumber: string): Promise<DerivedKeyResult> { return notImplemented('deriveChildKeyFromStore') }
  async getDerivedAddresses(_receiverWif: string, _senderPubKeys: string[], _invoiceNumbers: string[]): Promise<DerivedAddressResult[]> { return notImplemented('getDerivedAddresses') }
  async getDerivedAddressesFromStore(_keyType: string, _senderPubKeys: string[], _invoiceNumbers: string[]): Promise<DerivedAddressResult[]> { return notImplemented('getDerivedAddressesFromStore') }
  async findDerivedKeyForAddress(_receiverWif: string, _targetAddress: string, _senderPubKeyHex: string, _invoiceNumbers: string[], _maxNumeric: number): Promise<DerivedKeyResult | null> { return notImplemented('findDerivedKeyForAddress') }
  async deriveTaggedKey(_rootWif: string, _tag: DerivationTag): Promise<TaggedKeyResult> { return notImplemented('deriveTaggedKey') }
  async deriveTaggedKeyFromStore(_keyType: string, _tag: DerivationTag): Promise<TaggedKeyResult> { return notImplemented('deriveTaggedKeyFromStore') }

  // ----- Transaction Building -----
  async buildP2PKHTx(_params: BuildP2PKHTxParams): Promise<BuiltTransaction> { return notImplemented('buildP2PKHTx') }
  async buildMultiKeyP2PKHTx(_params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction> { return notImplemented('buildMultiKeyP2PKHTx') }
  async buildConsolidationTx(_params: BuildConsolidationTxParams): Promise<BuiltConsolidationTransaction> { return notImplemented('buildConsolidationTx') }
  async buildMultiOutputP2PKHTx(_params: BuildMultiOutputP2PKHTxParams): Promise<BuiltMultiOutputTransaction> { return notImplemented('buildMultiOutputP2PKHTx') }

  // ----- Key Storage -----
  async storeKeys(_mnemonic: string, _accountIndex: number): Promise<void> { return notImplemented('storeKeys') }
  async storeKeysDirect(_walletWif: string, _walletAddress: string, _walletPubKey: string, _ordWif: string, _ordAddress: string, _ordPubKey: string, _identityWif: string, _identityAddress: string, _identityPubKey: string): Promise<void> { return notImplemented('storeKeysDirect') }
  async switchAccountFromStore(_accountIndex: number): Promise<PublicWalletKeys> { return notImplemented('switchAccountFromStore') }
  async rotateSessionForAccount(_accountId: string): Promise<void> { return notImplemented('rotateSessionForAccount') }
  async getWifForOperation(): Promise<string> { return notImplemented('getWifForOperation') }
  async getMnemonicOnce(): Promise<string> { return notImplemented('getMnemonicOnce') }
  async clearKeys(): Promise<void> { return notImplemented('clearKeys') }

  // ----- Signing -----
  async signMessageFromStore(_message: string, _keyType: string): Promise<string> { return notImplemented('signMessageFromStore') }
  async signDataFromStore(_data: string, _keyType: string): Promise<string> { return notImplemented('signDataFromStore') }
  async verifySignature(_publicKeyHex: string, _message: string, _signatureHex: string): Promise<boolean> { return notImplemented('verifySignature') }
  async verifyDataSignature(_publicKeyHex: string, _data: string, _signatureHex: string): Promise<boolean> { return notImplemented('verifyDataSignature') }

  // ----- Encryption -----
  async encryptData(_plaintext: string, _password: string): Promise<EncryptedData> { return notImplemented('encryptData') }
  async decryptData(_encryptedData: EncryptedData, _password: string): Promise<string> { return notImplemented('decryptData') }
  async encryptEciesFromStore(_plaintext: string, _recipientPubKey: string, _keyType: string): Promise<{ ciphertext: string; senderPublicKey: string }> { return notImplemented('encryptEciesFromStore') }
  async decryptEciesFromStore(_ciphertextBytes: string, _senderPubKey: string, _keyType: string): Promise<string> { return notImplemented('decryptEciesFromStore') }

  // ----- Secure Storage -----
  async secureStorageSave(_data: EncryptedData): Promise<void> { return notImplemented('secureStorageSave') }
  async secureStorageLoad(): Promise<EncryptedData | null> { return notImplemented('secureStorageLoad') }
  async secureStorageExists(): Promise<boolean> { return notImplemented('secureStorageExists') }
  async secureStorageClear(): Promise<void> { return notImplemented('secureStorageClear') }

  // ----- Rate Limiting -----
  async checkUnlockRateLimit(): Promise<RateLimitCheckResult> { return notImplemented('checkUnlockRateLimit') }
  async recordFailedUnlock(): Promise<FailedUnlockResult> { return notImplemented('recordFailedUnlock') }
  async recordSuccessfulUnlock(): Promise<void> { return notImplemented('recordSuccessfulUnlock') }
  async getRemainingAttempts(): Promise<number> { return notImplemented('getRemainingAttempts') }

  // ----- BRC-100 -----
  async respondToBrc100(_requestId: string, _response: unknown): Promise<void> { return notImplemented('respondToBrc100') }

  // ----- Hashing -----
  async sha256Hash(_data: string): Promise<string> { return notImplemented('sha256Hash') }
}
