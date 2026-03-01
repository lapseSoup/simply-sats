/**
 * Tests for BRC-100 Signing Operations
 *
 * Tests: signMessage, signData, verifySignature, verifyDataSignature
 * All functions now delegate to Tauri commands — tests mock tauriInvoke.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletKeys } from '../wallet/types'

// Mock the tauri utility module
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

import {
  signMessage,
  signData,
  verifySignature,
  verifyDataSignature
} from './signing'

const testKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
  walletAddress: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
  walletPubKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  ordWif: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU74NMTptX4',
  ordAddress: '1EHNa6Q4Jz2uvNExL497mE43ikXhwF6kZm',
  ordPubKey: '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  identityWif: 'L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi',
  identityAddress: '1F3sAm6ZtwLAUnj7d38pGFxtP3RVEvtsbV',
  identityPubKey: '03a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd',
}

beforeEach(() => {
  mockTauriInvoke.mockReset()
})

// ---------- signMessage ----------

describe('signMessage', () => {
  it('should invoke sign_message_from_store with identity keyType', async () => {
    mockTauriInvoke.mockResolvedValue('3045022100abcd')
    const sig = await signMessage(testKeys, 'Hello, world!')

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'sign_message_from_store',
      { message: 'Hello, world!', keyType: 'identity' }
    )
    expect(sig).toBe('3045022100abcd')
  })

  it('should return the hex signature from Tauri', async () => {
    mockTauriInvoke.mockResolvedValue('30440220deadbeef')
    const sig = await signMessage(testKeys, 'test message')
    expect(sig).toBe('30440220deadbeef')
  })

  it('should propagate Tauri errors', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('Tauri command failed'))
    await expect(signMessage(testKeys, 'fail')).rejects.toThrow('Tauri command failed')
  })
})

// ---------- signData ----------

describe('signData', () => {
  const testData = [1, 2, 3, 4, 5]

  it('should invoke sign_data_from_store with identity key by default', async () => {
    mockTauriInvoke.mockResolvedValue('3045sig')
    await signData(testKeys, testData)

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'sign_data_from_store',
      { data: new Uint8Array(testData), keyType: 'identity' }
    )
  })

  it('should pass wallet keyType when specified', async () => {
    mockTauriInvoke.mockResolvedValue('wallet-sig')
    await signData(testKeys, testData, 'wallet')

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'sign_data_from_store',
      { data: new Uint8Array(testData), keyType: 'wallet' }
    )
  })

  it('should pass ordinals keyType when specified', async () => {
    mockTauriInvoke.mockResolvedValue('ord-sig')
    await signData(testKeys, testData, 'ordinals')

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'sign_data_from_store',
      { data: new Uint8Array(testData), keyType: 'ordinals' }
    )
  })

  it('should convert data array to Uint8Array', async () => {
    mockTauriInvoke.mockResolvedValue('sig')
    await signData(testKeys, [10, 20, 30])

    const callArgs = mockTauriInvoke.mock.calls[0]!
    expect(callArgs[1].data).toBeInstanceOf(Uint8Array)
    expect(Array.from(callArgs[1].data as Uint8Array)).toEqual([10, 20, 30])
  })
})

// ---------- verifySignature ----------

describe('verifySignature', () => {
  it('should invoke verify_signature with correct args', async () => {
    mockTauriInvoke.mockResolvedValue(true)
    const result = await verifySignature('02abc', 'message', 'sigHex')

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'verify_signature',
      { publicKeyHex: '02abc', message: 'message', signatureHex: 'sigHex' }
    )
    expect(result).toBe(true)
  })

  it('should return false when Tauri says invalid', async () => {
    mockTauriInvoke.mockResolvedValue(false)
    const result = await verifySignature('02abc', 'msg', 'bad-sig')
    expect(result).toBe(false)
  })

  it('should propagate Tauri errors', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('verify failed'))
    await expect(verifySignature('02abc', 'msg', 'sig')).rejects.toThrow('verify failed')
  })
})

// ---------- verifyDataSignature ----------

describe('verifyDataSignature', () => {
  it('should invoke verify_data_signature with correct args', async () => {
    mockTauriInvoke.mockResolvedValue(true)
    const data = [1, 2, 3]
    const result = await verifyDataSignature('02abc', data, 'sigHex')

    expect(mockTauriInvoke).toHaveBeenCalledWith(
      'verify_data_signature',
      { publicKeyHex: '02abc', data: new Uint8Array(data), signatureHex: 'sigHex' }
    )
    expect(result).toBe(true)
  })

  it('should return false when Tauri says invalid', async () => {
    mockTauriInvoke.mockResolvedValue(false)
    const result = await verifyDataSignature('02abc', [4, 5], 'bad')
    expect(result).toBe(false)
  })

  it('should convert data array to Uint8Array', async () => {
    mockTauriInvoke.mockResolvedValue(true)
    await verifyDataSignature('02abc', [7, 8, 9], 'sig')

    const callArgs = mockTauriInvoke.mock.calls[0]!
    expect(callArgs[1].data).toBeInstanceOf(Uint8Array)
    expect(Array.from(callArgs[1].data as Uint8Array)).toEqual([7, 8, 9])
  })
})
