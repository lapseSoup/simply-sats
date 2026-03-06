/**
 * Chrome Extension Platform Adapter
 *
 * Implements all platform-specific operations using pure TypeScript crypto
 * and chrome.storage APIs. No Rust/Tauri dependencies.
 *
 * Key management: encrypted keys stored in chrome.storage.local,
 * decrypted keys held in service worker memory only.
 *
 * @module platform/chrome
 */

// Minimal chrome types for storage API — avoids depending on chrome-types
// in the root tsconfig while keeping full type safety.
declare const chrome: {
  storage: {
    local: {
      set(items: Record<string, unknown>, callback: () => void): void
      get(keys: string[], callback: (result: Record<string, unknown>) => void): void
      remove(key: string, callback: () => void): void
    }
  }
  runtime: {
    lastError?: { message?: string }
  }
}

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
import * as cryptoKeys from './crypto/keys'
import * as brc42 from './crypto/brc42'
import * as txBuilder from './crypto/transaction'
import * as signing from './crypto/signing'

// ============================================
// In-Memory Key Store
// ============================================

/**
 * In-memory key store for the Chrome extension.
 * Keys are held only in memory (service worker or popup),
 * never persisted unencrypted.
 */
interface KeyStore {
  mnemonic: string | null
  walletWif: string | null
  ordWif: string | null
  identityWif: string | null
  walletAddress: string | null
  walletPubKey: string | null
  ordAddress: string | null
  ordPubKey: string | null
  identityAddress: string | null
  identityPubKey: string | null
  accountIndex: number
}

const keyStore: KeyStore = {
  mnemonic: null,
  walletWif: null,
  ordWif: null,
  identityWif: null,
  walletAddress: null,
  walletPubKey: null,
  ordAddress: null,
  ordPubKey: null,
  identityAddress: null,
  identityPubKey: null,
  accountIndex: 0,
}

function getWifForKeyType(keyType: string): string {
  switch (keyType) {
    case 'wallet': {
      if (!keyStore.walletWif) throw new Error('Wallet key not loaded')
      return keyStore.walletWif
    }
    case 'ordinals': {
      if (!keyStore.ordWif) throw new Error('Ordinals key not loaded')
      return keyStore.ordWif
    }
    case 'identity': {
      if (!keyStore.identityWif) throw new Error('Identity key not loaded')
      return keyStore.identityWif
    }
    default:
      throw new Error(`Unknown key type: ${keyType}`)
  }
}

// ============================================
// Rate Limiter (In-Memory)
// ============================================

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000

const rateLimitState = {
  attempts: 0,
  lockoutUntil: 0,
}

// ============================================
// Chrome Adapter
// ============================================

export class ChromeAdapter implements PlatformAdapter {
  readonly platform = 'chrome-extension' as const

  // ----- Key Derivation -----

  async deriveWalletKeys(mnemonic: string): Promise<WalletKeys> {
    return cryptoKeys.deriveWalletKeys(mnemonic, 0)
  }

  async deriveWalletKeysForAccount(mnemonic: string, accountIndex: number): Promise<WalletKeys> {
    return cryptoKeys.deriveWalletKeys(mnemonic, accountIndex)
  }

  async keysFromWif(wif: string): Promise<KeyPair> {
    return cryptoKeys.keysFromWif(wif)
  }

  // ----- BRC-42/43 -----

  async deriveChildKey(receiverWif: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult> {
    return brc42.deriveChildKey(receiverWif, senderPubKeyHex, invoiceNumber)
  }

  async deriveChildKeyFromStore(keyType: string, senderPubKeyHex: string, invoiceNumber: string): Promise<DerivedKeyResult> {
    const wif = getWifForKeyType(keyType)
    return brc42.deriveChildKey(wif, senderPubKeyHex, invoiceNumber)
  }

  async getDerivedAddresses(receiverWif: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]> {
    return brc42.getDerivedAddresses(receiverWif, senderPubKeys, invoiceNumbers)
  }

  async getDerivedAddressesFromStore(keyType: string, senderPubKeys: string[], invoiceNumbers: string[]): Promise<DerivedAddressResult[]> {
    const wif = getWifForKeyType(keyType)
    return brc42.getDerivedAddresses(wif, senderPubKeys, invoiceNumbers)
  }

  async findDerivedKeyForAddress(receiverWif: string, targetAddress: string, senderPubKeyHex: string, invoiceNumbers: string[], maxNumeric: number): Promise<DerivedKeyResult | null> {
    return brc42.findDerivedKeyForAddress(receiverWif, targetAddress, senderPubKeyHex, invoiceNumbers, maxNumeric)
  }

  async deriveTaggedKey(rootWif: string, tag: DerivationTag): Promise<TaggedKeyResult> {
    return brc42.deriveTaggedKey(rootWif, tag)
  }

  async deriveTaggedKeyFromStore(keyType: string, tag: DerivationTag): Promise<TaggedKeyResult> {
    const wif = getWifForKeyType(keyType)
    return brc42.deriveTaggedKey(wif, tag)
  }

  // ----- Transaction Building -----

  async buildP2PKHTx(params: BuildP2PKHTxParams): Promise<BuiltTransaction> {
    const wif = getWifForKeyType('wallet')
    return txBuilder.buildP2PKHTx(wif, params)
  }

  async buildMultiKeyP2PKHTx(params: BuildMultiKeyP2PKHTxParams): Promise<BuiltTransaction> {
    const changeWif = getWifForKeyType('wallet')
    return txBuilder.buildMultiKeyP2PKHTx(changeWif, params)
  }

  async buildConsolidationTx(params: BuildConsolidationTxParams): Promise<BuiltConsolidationTransaction> {
    const wif = getWifForKeyType('wallet')
    return txBuilder.buildConsolidationTx(wif, params)
  }

  async buildMultiOutputP2PKHTx(params: BuildMultiOutputP2PKHTxParams): Promise<BuiltMultiOutputTransaction> {
    const wif = getWifForKeyType('wallet')
    return txBuilder.buildMultiOutputP2PKHTx(wif, params)
  }

  // ----- Key Storage -----

  async storeKeys(mnemonic: string, accountIndex: number): Promise<void> {
    const keys = cryptoKeys.deriveWalletKeys(mnemonic, accountIndex)
    keyStore.mnemonic = mnemonic
    keyStore.walletWif = keys.walletWif
    keyStore.ordWif = keys.ordWif
    keyStore.identityWif = keys.identityWif
    keyStore.walletAddress = keys.walletAddress
    keyStore.walletPubKey = keys.walletPubKey
    keyStore.ordAddress = keys.ordAddress
    keyStore.ordPubKey = keys.ordPubKey
    keyStore.identityAddress = keys.identityAddress
    keyStore.identityPubKey = keys.identityPubKey
    keyStore.accountIndex = accountIndex
  }

  async storeKeysDirect(
    walletWif: string, walletAddress: string, walletPubKey: string,
    ordWif: string, ordAddress: string, ordPubKey: string,
    identityWif: string, identityAddress: string, identityPubKey: string
  ): Promise<void> {
    keyStore.walletWif = walletWif
    keyStore.walletAddress = walletAddress
    keyStore.walletPubKey = walletPubKey
    keyStore.ordWif = ordWif
    keyStore.ordAddress = ordAddress
    keyStore.ordPubKey = ordPubKey
    keyStore.identityWif = identityWif
    keyStore.identityAddress = identityAddress
    keyStore.identityPubKey = identityPubKey
  }

  async switchAccountFromStore(accountIndex: number): Promise<PublicWalletKeys> {
    if (!keyStore.mnemonic) throw new Error('No mnemonic loaded')
    const keys = cryptoKeys.deriveWalletKeys(keyStore.mnemonic, accountIndex)

    keyStore.walletWif = keys.walletWif
    keyStore.ordWif = keys.ordWif
    keyStore.identityWif = keys.identityWif
    keyStore.walletAddress = keys.walletAddress
    keyStore.walletPubKey = keys.walletPubKey
    keyStore.ordAddress = keys.ordAddress
    keyStore.ordPubKey = keys.ordPubKey
    keyStore.identityAddress = keys.identityAddress
    keyStore.identityPubKey = keys.identityPubKey
    keyStore.accountIndex = accountIndex

    return {
      walletAddress: keys.walletAddress,
      walletPubKey: keys.walletPubKey,
      ordAddress: keys.ordAddress,
      ordPubKey: keys.ordPubKey,
      identityAddress: keys.identityAddress,
      identityPubKey: keys.identityPubKey,
    }
  }

  async rotateSessionForAccount(_accountId: string): Promise<void> {
    // No-op in Chrome extension — session management is handled by service worker
  }

  // S-128: JS strings are immutable — setting to null is the best we can do.
  // The original values may persist in V8 heap until garbage collection.
  // For true zeroization, use the Tauri desktop platform which uses Rust's Zeroizing<String>.
  async clearKeys(): Promise<void> {
    keyStore.mnemonic = null
    keyStore.walletWif = null
    keyStore.ordWif = null
    keyStore.identityWif = null
    keyStore.walletAddress = null
    keyStore.walletPubKey = null
    keyStore.ordAddress = null
    keyStore.ordPubKey = null
    keyStore.identityAddress = null
    keyStore.identityPubKey = null
  }

  // ----- Signing -----

  async signMessageFromStore(message: string, keyType: string): Promise<string> {
    const wif = getWifForKeyType(keyType)
    return signing.signMessage(wif, message)
  }

  async signDataFromStore(data: string, keyType: string): Promise<string> {
    const wif = getWifForKeyType(keyType)
    return signing.signData(wif, data)
  }

  async verifySignature(publicKeyHex: string, message: string, signatureHex: string): Promise<boolean> {
    return signing.verifyMessageSignature(publicKeyHex, message, signatureHex)
  }

  async verifyDataSignature(publicKeyHex: string, data: string, signatureHex: string): Promise<boolean> {
    return signing.verifyDataSignature(publicKeyHex, data, signatureHex)
  }

  // ----- Encryption (AES-256-GCM + PBKDF2) -----

  async encryptData(plaintext: string, password: string): Promise<EncryptedData> {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // PBKDF2 key derivation
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    )

    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        new TextEncoder().encode(plaintext)
      )
    )

    return {
      version: 1,
      ciphertext: btoa(String.fromCharCode(...ciphertext)),
      iv: btoa(String.fromCharCode(...iv)),
      salt: btoa(String.fromCharCode(...salt)),
    }
  }

  async decryptData(encryptedData: EncryptedData, password: string): Promise<string> {
    const ciphertext = Uint8Array.from(atob(encryptedData.ciphertext), c => c.charCodeAt(0))
    const iv = Uint8Array.from(atob(encryptedData.iv), c => c.charCodeAt(0))
    const salt = Uint8Array.from(atob(encryptedData.salt), c => c.charCodeAt(0))

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    const aesKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    )

    return new TextDecoder().decode(plaintext)
  }

  async encryptEciesFromStore(plaintext: string, recipientPubKey: string, keyType: string): Promise<{ ciphertext: string; senderPublicKey: string }> {
    const wif = getWifForKeyType(keyType)
    return signing.eciesEncrypt(wif, plaintext, recipientPubKey)
  }

  async decryptEciesFromStore(ciphertextBytes: string, senderPubKey: string, keyType: string): Promise<string> {
    const wif = getWifForKeyType(keyType)
    return signing.eciesDecrypt(wif, ciphertextBytes, senderPubKey)
  }

  // ----- Secure Storage (chrome.storage.local) -----

  async secureStorageSave(data: EncryptedData): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ simply_sats_wallet: data }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve()
        }
      })
    })
  }

  async secureStorageLoad(): Promise<EncryptedData | null> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(['simply_sats_wallet'], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve((result.simply_sats_wallet as EncryptedData) ?? null)
        }
      })
    })
  }

  async secureStorageExists(): Promise<boolean> {
    const data = await this.secureStorageLoad()
    return data !== null
  }

  async secureStorageClear(): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove('simply_sats_wallet', () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve()
        }
      })
    })
  }

  // ----- Rate Limiting (In-Memory) -----

  async checkUnlockRateLimit(): Promise<RateLimitCheckResult> {
    const now = Date.now()
    if (rateLimitState.lockoutUntil > 0 && now > rateLimitState.lockoutUntil) {
      rateLimitState.attempts = 0
      rateLimitState.lockoutUntil = 0
    }
    const isLimited = rateLimitState.attempts >= MAX_ATTEMPTS
    return {
      isLimited,
      remainingMs: isLimited ? Math.max(0, rateLimitState.lockoutUntil - now) : 0,
    }
  }

  async recordFailedUnlock(): Promise<FailedUnlockResult> {
    rateLimitState.attempts++
    const isLocked = rateLimitState.attempts >= MAX_ATTEMPTS
    if (isLocked) {
      rateLimitState.lockoutUntil = Date.now() + LOCKOUT_MS
    }
    return {
      isLocked,
      lockoutMs: isLocked ? LOCKOUT_MS : 0,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - rateLimitState.attempts),
    }
  }

  async recordSuccessfulUnlock(): Promise<void> {
    rateLimitState.attempts = 0
    rateLimitState.lockoutUntil = 0
  }

  async getRemainingAttempts(): Promise<number> {
    return Math.max(0, MAX_ATTEMPTS - rateLimitState.attempts)
  }

  // ----- BRC-100 -----

  async respondToBrc100(_requestId: string, _response: unknown): Promise<void> {
    // In Chrome extension, BRC-100 responses go through native messaging
    // TODO: Implement native messaging bridge in Phase 4
    throw new Error('BRC-100 native messaging not yet implemented')
  }

  // ----- Hashing -----

  async sha256Hash(data: string): Promise<string> {
    return cryptoKeys.sha256String(data)
  }
}
