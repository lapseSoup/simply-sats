/**
 * Platform Abstraction Layer — Type Definitions
 *
 * Defines the interface that both Tauri (desktop) and Chrome extension
 * implementations must satisfy. This enables the same React UI and
 * business logic to run on both platforms.
 *
 * @module platform/types
 */

import type {
  WalletKeys,
  KeyPair,
  UTXO,
  ExtendedUTXO,
} from '../domain/types'

// ============================================
// Platform Detection
// ============================================

export type PlatformType = 'tauri' | 'chrome-extension' | 'browser'

// ============================================
// Key Derivation Types
// ============================================

export interface DerivedKeyResult {
  wif: string
  address: string
  pubKey: string
}

export interface DerivedAddressResult {
  address: string
  senderPubKey: string
  invoiceNumber: string
}

export interface DerivationTag {
  label: string
  id: string
  domain?: string
  meta?: Record<string, unknown>
}

export interface TaggedKeyResult {
  wif: string
  publicKey: string
  address: string
  derivationPath: string
}

// ============================================
// Transaction Building Types
// ============================================

export interface BuildP2PKHTxParams {
  toAddress: string
  satoshis: number
  selectedUtxos: UTXO[]
  totalInput: number
  feeRate: number
}

export interface BuildMultiKeyP2PKHTxParams {
  toAddress: string
  satoshis: number
  selectedUtxos: ExtendedUTXO[]
  totalInput: number
  feeRate: number
}

export interface BuildConsolidationTxParams {
  utxos: Array<{ txid: string; vout: number; satoshis: number; script: string }>
  feeRate: number
}

export interface RecipientOutput {
  address: string
  satoshis: number
}

export interface BuildMultiOutputP2PKHTxParams {
  outputs: RecipientOutput[]
  selectedUtxos: UTXO[]
  totalInput: number
  feeRate: number
}

export interface BuiltTransaction {
  tx: null
  rawTx: string
  txid: string
  fee: number
  change: number
  changeAddress: string
  numOutputs: number
  spentOutpoints: Array<{ txid: string; vout: number }>
}

export interface BuiltConsolidationTransaction {
  tx: null
  rawTx: string
  txid: string
  fee: number
  outputSats: number
  address: string
  spentOutpoints: Array<{ txid: string; vout: number }>
}

export interface BuiltMultiOutputTransaction extends BuiltTransaction {
  totalSent: number
}

// ============================================
// Rate Limiting Types
// ============================================

export interface RateLimitCheckResult {
  isLimited: boolean
  remainingMs: number
}

export interface FailedUnlockResult {
  isLocked: boolean
  lockoutMs: number
  attemptsRemaining: number
}

// ============================================
// Encryption Types
// ============================================

export interface EncryptedData {
  ciphertext: string
  iv: string
  salt: string
  version: number
}

// ============================================
// Public Wallet Keys (no WIFs)
// ============================================

export interface PublicWalletKeys {
  walletAddress: string
  walletPubKey: string
  ordAddress: string
  ordPubKey: string
  identityAddress: string
  identityPubKey: string
}

// ============================================
// Platform Adapter Interface
// ============================================

/**
 * The PlatformAdapter interface abstracts all platform-specific operations.
 *
 * Implementations:
 * - TauriAdapter: delegates to Rust backend via tauriInvoke()
 * - ChromeAdapter: uses pure TypeScript crypto + chrome.storage APIs
 *
 * All methods that handle private keys must keep them in memory only
 * for the minimum required duration.
 */
export interface PlatformAdapter {
  /** Which platform this adapter targets */
  readonly platform: PlatformType

  // ----- Key Derivation -----

  /** Derive all wallet keys from a BIP-39 mnemonic */
  deriveWalletKeys(mnemonic: string): Promise<WalletKeys>

  /** Derive wallet keys for a specific account index */
  deriveWalletKeysForAccount(mnemonic: string, accountIndex: number): Promise<WalletKeys>

  /** Generate a KeyPair from a WIF string */
  keysFromWif(wif: string): Promise<KeyPair>

  // ----- BRC-42/43 Key Derivation -----

  /** Derive a child key via BRC-42 ECDH */
  deriveChildKey(receiverWif: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult>

  /** Derive a child key using a key from the secure store */
  deriveChildKeyFromStore(keyType: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult>

  /** Batch-derive addresses from known senders */
  getDerivedAddresses(receiverWif: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]>

  /** Batch-derive using a key from the secure store */
  getDerivedAddressesFromStore(keyType: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]>

  /** Find which invoice number produces a target address */
  findDerivedKeyForAddress(receiverWif: string, targetAddress: string, senderPubKeyHex: string, invoiceNumbers: string[], maxNumeric: number): Promise<DerivedKeyResult | null>

  /** Derive a tagged key (BRC-43 compatible) */
  deriveTaggedKey(rootWif: string, tag: DerivationTag): Promise<TaggedKeyResult>

  /** Derive a tagged key from the secure store */
  deriveTaggedKeyFromStore(keyType: string, tag: DerivationTag): Promise<TaggedKeyResult>

  // ----- Transaction Building -----

  /** Build and sign a single-key P2PKH transaction */
  buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction>

  /** Build and sign a multi-key P2PKH transaction */
  buildMultiKeyP2PKHTx(params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction>

  /** Build and sign a consolidation transaction */
  buildConsolidationTx(params: BuildConsolidationTxParams): Promise<BuiltConsolidationTransaction>

  /** Build and sign a multi-output P2PKH transaction */
  buildMultiOutputP2PKHTx(params: BuildMultiOutputP2PKHTxParams): Promise<BuiltMultiOutputTransaction>

  // ----- Secure Key Storage -----

  /** Store wallet keys (encrypted by password) */
  storeKeys(mnemonic: string, accountIndex: number): Promise<void>

  /** Store keys directly from WIFs (for WIF import) */
  storeKeysDirect(walletWif: string, walletAddress: string, walletPubKey: string, ordWif: string, ordAddress: string, ordPubKey: string, identityWif: string, identityAddress: string, identityPubKey: string): Promise<void>

  /** Switch to a different account's keys in the store */
  switchAccountFromStore(accountIndex: number): Promise<PublicWalletKeys>

  /** Rotate session credentials for an account */
  rotateSessionForAccount(accountId: string): Promise<void>

  /** Get the wallet WIF for a one-time operation */
  getWifForOperation(): Promise<string>

  /** Get the mnemonic once (consumed after read) */
  getMnemonicOnce(): Promise<string>

  /** Get the mnemonic without clearing it from the store */
  getMnemonic(): Promise<string>

  /** Clear all keys from the store */
  clearKeys(): Promise<void>

  // ----- Signing & Verification -----

  /** Sign a message using a key from the store */
  signMessageFromStore(message: string, keyType: string): Promise<string>

  /** Sign raw data using a key from the store */
  signDataFromStore(data: string, keyType: string): Promise<string>

  /** Verify a signature */
  verifySignature(publicKeyHex: string, message: string, signatureHex: string): Promise<boolean>

  /** Verify a data signature */
  verifyDataSignature(publicKeyHex: string, data: string, signatureHex: string): Promise<boolean>

  // ----- Encryption -----

  /** Encrypt data with a password */
  encryptData(plaintext: string, password: string): Promise<EncryptedData>

  /** Decrypt data with a password */
  decryptData(encryptedData: EncryptedData, password: string): Promise<string>

  /** ECIES encrypt using a key from the store */
  encryptEciesFromStore(plaintext: string, recipientPubKey: string, keyType: string): Promise<{ ciphertext: string; senderPublicKey: string }>

  /** ECIES decrypt using a key from the store */
  decryptEciesFromStore(ciphertextBytes: string, senderPubKey: string, keyType: string): Promise<string>

  // ----- Secure Storage (encrypted wallet file) -----

  /** Save encrypted wallet data to persistent storage */
  secureStorageSave(data: EncryptedData): Promise<void>

  /** Load encrypted wallet data from persistent storage */
  secureStorageLoad(): Promise<EncryptedData | null>

  /** Check if encrypted wallet data exists */
  secureStorageExists(): Promise<boolean>

  /** Clear encrypted wallet data */
  secureStorageClear(): Promise<void>

  // ----- Rate Limiting -----

  /** Check if unlock attempts are rate limited */
  checkUnlockRateLimit(): Promise<RateLimitCheckResult>

  /** Record a failed unlock attempt */
  recordFailedUnlock(): Promise<FailedUnlockResult>

  /** Record a successful unlock (resets rate limit) */
  recordSuccessfulUnlock(): Promise<void>

  /** Get remaining unlock attempts */
  getRemainingAttempts(): Promise<number>

  // ----- BRC-100 -----

  /** Send a response to a BRC-100 request */
  respondToBrc100(requestId: string, response: unknown): Promise<void>

  // ----- Hashing Utilities -----

  /** SHA-256 hash a string */
  sha256Hash(data: string): Promise<string>
}
