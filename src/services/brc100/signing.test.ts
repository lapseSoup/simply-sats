// @vitest-environment node
/**
 * Tests for BRC-100 Signing Operations
 *
 * Tests: signMessage, signData, verifySignature, verifyDataSignature
 * Uses the JS fallback path (non-Tauri environment).
 */

import { describe, it, expect } from 'vitest'
import { PrivateKey } from '@bsv/sdk'
import type { WalletKeys } from '../wallet/types'

import {
  signMessage,
  signData,
  verifySignature,
  verifyDataSignature
} from './signing'

// Generate deterministic test keys
const identityKey = PrivateKey.fromWif('L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi')
const walletKey = PrivateKey.fromWif('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn')
const ordKey = PrivateKey.fromWif('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4')

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: walletKey.toWif(),
  walletAddress: walletKey.toPublicKey().toAddress(),
  walletPubKey: walletKey.toPublicKey().toString(),
  ordWif: ordKey.toWif(),
  ordAddress: ordKey.toPublicKey().toAddress(),
  ordPubKey: ordKey.toPublicKey().toString(),
  identityWif: identityKey.toWif(),
  identityAddress: identityKey.toPublicKey().toAddress(),
  identityPubKey: identityKey.toPublicKey().toString(),
}

// ---------- signMessage ----------

describe('signMessage', () => {
  it('should produce a hex-encoded DER signature', async () => {
    const sig = await signMessage(testKeys, 'Hello, world!')
    expect(sig).toMatch(/^[0-9a-f]+$/i)
    // DER signatures start with 0x30
    expect(sig.startsWith('30')).toBe(true)
  })

  it('should produce different signatures for different messages', async () => {
    const sig1 = await signMessage(testKeys, 'message one')
    const sig2 = await signMessage(testKeys, 'message two')
    expect(sig1).not.toBe(sig2)
  })

  it('should produce deterministic signatures for same input', async () => {
    const sig1 = await signMessage(testKeys, 'deterministic')
    const sig2 = await signMessage(testKeys, 'deterministic')
    expect(sig1).toBe(sig2)
  })
})

// ---------- signData ----------

describe('signData', () => {
  const testData = Array.from(new TextEncoder().encode('raw data bytes'))

  it('should sign with identity key by default', async () => {
    const sig = await signData(testKeys, testData)
    expect(sig).toMatch(/^[0-9a-f]+$/i)
    expect(sig.startsWith('30')).toBe(true)
  })

  it('should sign with identity key explicitly', async () => {
    const sig = await signData(testKeys, testData, 'identity')
    // Same key => same signature
    const sigDefault = await signData(testKeys, testData)
    expect(sig).toBe(sigDefault)
  })

  it('should sign with wallet key', async () => {
    const sig = await signData(testKeys, testData, 'wallet')
    expect(sig).toMatch(/^[0-9a-f]+$/i)
    // Different key => different signature
    const sigIdentity = await signData(testKeys, testData, 'identity')
    expect(sig).not.toBe(sigIdentity)
  })

  it('should sign with ordinals key', async () => {
    const sig = await signData(testKeys, testData, 'ordinals')
    expect(sig).toMatch(/^[0-9a-f]+$/i)
  })

  it('should produce different signatures for different data', async () => {
    const data1 = [1, 2, 3]
    const data2 = [4, 5, 6]
    const sig1 = await signData(testKeys, data1)
    const sig2 = await signData(testKeys, data2)
    expect(sig1).not.toBe(sig2)
  })
})

// ---------- verifySignature ----------

describe('verifySignature', () => {
  it('should verify a valid signature', async () => {
    const message = 'verify this message'
    const sig = await signMessage(testKeys, message)

    const isValid = await verifySignature(testKeys.identityPubKey, message, sig)
    expect(isValid).toBe(true)
  })

  it('should reject signature with wrong message', async () => {
    const sig = await signMessage(testKeys, 'original message')

    const isValid = await verifySignature(testKeys.identityPubKey, 'different message', sig)
    expect(isValid).toBe(false)
  })

  it('should reject signature with wrong public key', async () => {
    const sig = await signMessage(testKeys, 'test message')

    // Use a different key for verification
    const isValid = await verifySignature(testKeys.walletPubKey, 'test message', sig)
    expect(isValid).toBe(false)
  })

  it('should return false for empty signature', async () => {
    const isValid = await verifySignature(testKeys.identityPubKey, 'test', '')
    expect(isValid).toBe(false)
  })

  it('should return false for non-hex signature', async () => {
    const isValid = await verifySignature(testKeys.identityPubKey, 'test', 'not-hex-zzz!!!')
    expect(isValid).toBe(false)
  })

  it('should return false for malformed DER signature', async () => {
    const isValid = await verifySignature(testKeys.identityPubKey, 'test', 'deadbeef')
    expect(isValid).toBe(false)
  })
})

// ---------- verifyDataSignature ----------

describe('verifyDataSignature', () => {
  it('should verify a valid data signature', async () => {
    const data = Array.from(new TextEncoder().encode('verify this data'))
    const sig = await signData(testKeys, data, 'identity')

    const isValid = await verifyDataSignature(testKeys.identityPubKey, data, sig)
    expect(isValid).toBe(true)
  })

  it('should verify with wallet key', async () => {
    const data = [10, 20, 30, 40]
    const sig = await signData(testKeys, data, 'wallet')

    const isValid = await verifyDataSignature(testKeys.walletPubKey, data, sig)
    expect(isValid).toBe(true)
  })

  it('should reject signature with wrong data', async () => {
    const data = [1, 2, 3]
    const sig = await signData(testKeys, data, 'identity')

    const isValid = await verifyDataSignature(testKeys.identityPubKey, [4, 5, 6], sig)
    expect(isValid).toBe(false)
  })

  it('should reject signature with wrong public key', async () => {
    const data = [1, 2, 3]
    const sig = await signData(testKeys, data, 'identity')

    const isValid = await verifyDataSignature(testKeys.walletPubKey, data, sig)
    expect(isValid).toBe(false)
  })

  it('should return false for empty signature', async () => {
    const isValid = await verifyDataSignature(testKeys.identityPubKey, [1, 2, 3], '')
    expect(isValid).toBe(false)
  })

  it('should return false for non-hex signature', async () => {
    const isValid = await verifyDataSignature(testKeys.identityPubKey, [1], 'zzz!!!invalid')
    expect(isValid).toBe(false)
  })
})

// ---------- sign + verify round-trip ----------

describe('sign-verify round-trip', () => {
  it('should round-trip signMessage + verifySignature', async () => {
    const message = 'End-to-end round trip test'
    const sig = await signMessage(testKeys, message)
    const isValid = await verifySignature(testKeys.identityPubKey, message, sig)
    expect(isValid).toBe(true)
  })

  it('should round-trip signData + verifyDataSignature for all key types', async () => {
    const data = Array.from(new TextEncoder().encode('multi-key round trip'))

    for (const keyType of ['identity', 'wallet', 'ordinals'] as const) {
      const pubKeyMap = {
        identity: testKeys.identityPubKey,
        wallet: testKeys.walletPubKey,
        ordinals: testKeys.ordPubKey,
      }
      const sig = await signData(testKeys, data, keyType)
      const isValid = await verifyDataSignature(pubKeyMap[keyType], data, sig)
      expect(isValid).toBe(true)
    }
  })
})
