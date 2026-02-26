// @vitest-environment node
/**
 * Tests for BRC-100 Handler Validation Guards
 *
 * Covers the new validation logic added during remediation:
 * S-63: Payload size limits (signature, encrypt, decrypt)
 * S-67: Outputs array size limit in createAction
 * S-68: Minimum ciphertext size for decrypt
 * S-69: Tag length limit for getTaggedKeys
 * S-71: BSV max supply check for lockBSV
 * Q-53: Outpoint format validation for unlockBSV
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WalletKeys } from '../wallet/types'
import type { BRC100Request } from './types'

// ---------------------------------------------------------------------------
// Mocks — prevent real service calls; we only test early-rejection guards
// ---------------------------------------------------------------------------

vi.mock('@bsv/sdk', () => ({
  PrivateKey: { fromWif: vi.fn(() => ({ toPublicKey: () => ({ toString: () => '02' + 'a'.repeat(64), toAddress: () => '1Addr' }) })) },
  PublicKey: { fromString: vi.fn(() => ({})) },
}))

vi.mock('./signing', () => ({
  signData: vi.fn(async () => 'aabbccdd'),
  verifyDataSignature: vi.fn(async () => true),
}))

vi.mock('./cryptography', () => ({
  encryptECIES: vi.fn(async () => ({ ciphertext: [1, 2, 3], senderPublicKey: '02' + 'a'.repeat(64) })),
  decryptECIES: vi.fn(async () => 'decrypted'),
}))

vi.mock('./locks', () => ({
  createLockTransaction: vi.fn(async () => ({ ok: true, value: { txid: 'abc', unlockBlock: 100 } })),
}))

vi.mock('./formatting', () => ({
  buildAndBroadcastAction: vi.fn(async () => ({ ok: true, value: { txid: 'abc' } })),
}))

vi.mock('./outputs', () => ({
  resolvePublicKey: vi.fn(() => '02' + 'a'.repeat(64)),
  resolveListOutputs: vi.fn(async () => []),
  discoverByIdentityKey: vi.fn(async () => []),
  discoverByAttributes: vi.fn(async () => []),
}))

vi.mock('./utils', () => ({
  getBlockHeight: vi.fn(async () => 800000),
}))

vi.mock('../accounts', () => ({
  getActiveAccount: vi.fn(async () => ({ id: 1 })),
}))

vi.mock('./RequestManager', () => ({
  getRequestManager: vi.fn(() => ({
    get: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    getAll: vi.fn(() => []),
  })),
}))

vi.mock('../wallet', () => ({
  lockBSV: vi.fn(async () => ({ ok: true, value: { txid: 'abc', lockedUtxo: {} } })),
  unlockBSV: vi.fn(async () => ({ ok: true, value: 'txid123' })),
  getWifForOperation: vi.fn(async () => 'L1RrrnXkcKut5DEMwtDthjwRcTTwED36thyL1DebVrKuwvohjMNi'),
}))

vi.mock('../sync', () => ({
  BASKETS: { wrootz_locks: 'wrootz_locks' },
  getCurrentBlockHeight: vi.fn(async () => 800000),
}))

vi.mock('../logger', () => ({
  walletLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  brc100Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../database', () => ({
  getSpendableUTXOs: vi.fn(async () => ({ ok: true, value: [{ txid: 'abc', vout: 0, satoshis: 100000, lockingScript: '76a914...88ac' }] })),
  getLocks: vi.fn(async () => []),
  markLockUnlocked: vi.fn(async () => {}),
}))

vi.mock('../keyDerivation', () => ({
  deriveTaggedKey: vi.fn(() => ({
    publicKey: '02' + 'a'.repeat(64),
    address: '1TestAddress',
    derivationPath: "m/44'/0'/0'/0/0",
  })),
}))

vi.mock('../../domain/types', () => ({
  toWalletUtxo: vi.fn((u: Record<string, unknown>) => u),
}))

// ---------------------------------------------------------------------------
// Import the function under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import { executeApprovedRequest } from './handlers'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const mockKeys: WalletKeys = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  walletType: 'yours',
  walletWif: 'test-wif',
  ordWif: 'test-ord-wif',
  walletAddress: '1TestWalletAddress',
  ordAddress: '1TestOrdAddress',
  identityAddress: '1TestIdentityAddress',
  walletPubKey: '02' + 'a'.repeat(64),
  ordPubKey: '02' + 'b'.repeat(64),
  identityPubKey: '02' + 'c'.repeat(64),
}

function makeRequest(type: BRC100Request['type'], params: Record<string, unknown>): BRC100Request {
  return { id: 'test-request-1', type, params }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('S-63: createSignature payload size limit', () => {
  it('rejects data exceeding MAX_SIGNATURE_DATA_SIZE (10KB)', async () => {
    const oversizedData = Array.from({ length: 10 * 1024 + 1 }, () => 0)
    const request = makeRequest('createSignature', {
      data: oversizedData,
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('maximum size')
    expect(response.error!.message).toContain('10240')
  })

  it('accepts data exactly at MAX_SIGNATURE_DATA_SIZE', async () => {
    const exactData = Array.from({ length: 10 * 1024 }, () => 0)
    const request = makeRequest('createSignature', {
      data: exactData,
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    // Should NOT have a size-related error (may proceed or fail on other grounds)
    if (response.error) {
      expect(response.error.message).not.toContain('maximum size')
    }
  })
})

describe('S-63: encrypt payload size limit', () => {
  it('rejects plaintext exceeding MAX_ENCRYPT_PAYLOAD_SIZE (1MB)', async () => {
    const oversizedPlaintext = Array.from({ length: 1024 * 1024 + 1 }, () => 65) // 'A' bytes
    const request = makeRequest('encrypt', {
      plaintext: oversizedPlaintext,
      counterparty: '02' + 'a'.repeat(64),
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('maximum size')
    expect(response.error!.message).toContain('1048576')
  })
})

describe('S-63: decrypt payload size limit', () => {
  it('rejects ciphertext exceeding MAX_DECRYPT_PAYLOAD_SIZE (1MB)', async () => {
    const oversizedCiphertext = Array.from({ length: 1024 * 1024 + 1 }, () => 1)
    const request = makeRequest('decrypt', {
      ciphertext: oversizedCiphertext,
      counterparty: '02' + 'a'.repeat(64),
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('maximum size')
    expect(response.error!.message).toContain('1048576')
  })
})

describe('S-67: createAction outputs array size limit', () => {
  it('rejects outputs array exceeding 100 items', async () => {
    const oversizedOutputs = Array.from({ length: 101 }, (_, i) => ({
      lockingScript: '76a914' + i.toString(16).padStart(40, '0') + '88ac',
      satoshis: 1000,
    }))
    const request = makeRequest('createAction', {
      description: 'test action',
      outputs: oversizedOutputs,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('outputs array exceeds maximum size')
    expect(response.error!.message).toContain('100')
  })

  it('accepts outputs array of exactly 100 items', async () => {
    const outputs = Array.from({ length: 100 }, (_, i) => ({
      lockingScript: '76a914' + i.toString(16).padStart(40, '0') + '88ac',
      satoshis: 1000,
    }))
    const request = makeRequest('createAction', {
      description: 'test action',
      outputs,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    // Should NOT have an outputs-size error
    if (response.error) {
      expect(response.error.message).not.toContain('outputs array exceeds')
    }
  })
})

describe('S-68: decrypt minimum ciphertext size', () => {
  it('rejects ciphertext shorter than 28 bytes', async () => {
    const shortCiphertext = Array.from({ length: 27 }, () => 1)
    const request = makeRequest('decrypt', {
      ciphertext: shortCiphertext,
      counterparty: '02' + 'a'.repeat(64),
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('too short')
    expect(response.error!.message).toContain('28')
  })

  it('accepts ciphertext of exactly 28 bytes', async () => {
    const minCiphertext = Array.from({ length: 28 }, () => 1)
    const request = makeRequest('decrypt', {
      ciphertext: minCiphertext,
      counterparty: '02' + 'a'.repeat(64),
      protocolID: [1, 'test'],
      keyID: 'default',
    })

    const response = await executeApprovedRequest(request, mockKeys)

    // Should NOT have a "too short" error
    if (response.error) {
      expect(response.error.message).not.toContain('too short')
    }
  })
})

describe('S-69: getTaggedKeys tag length limit', () => {
  it('rejects tag exceeding 256 characters', async () => {
    const longTag = 'x'.repeat(257)
    const request = makeRequest('getTaggedKeys', { tag: longTag })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('maximum length')
    expect(response.error!.message).toContain('256')
  })

  it('accepts tag of exactly 256 characters', async () => {
    const exactTag = 'x'.repeat(256)
    const request = makeRequest('getTaggedKeys', { tag: exactTag })

    const response = await executeApprovedRequest(request, mockKeys)

    // Should NOT have a tag-length error
    if (response.error) {
      expect(response.error.message).not.toContain('maximum length')
    }
  })
})

describe('S-71: lockBSV max satoshis limit', () => {
  it('rejects satoshis exceeding 21M BTC (2.1e15 sats)', async () => {
    const request = makeRequest('lockBSV', {
      satoshis: 21_000_000_00_000_001,
      blocks: 10,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid satoshis parameter')
  })

  it('rejects non-integer satoshis', async () => {
    const request = makeRequest('lockBSV', {
      satoshis: 1000.5,
      blocks: 10,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid satoshis parameter')
  })

  it('rejects zero satoshis', async () => {
    const request = makeRequest('lockBSV', {
      satoshis: 0,
      blocks: 10,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid satoshis parameter')
  })

  it('rejects negative satoshis', async () => {
    const request = makeRequest('lockBSV', {
      satoshis: -100,
      blocks: 10,
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid satoshis parameter')
  })
})

describe('Q-53: unlockBSV outpoint format validation', () => {
  it('rejects outpoint with non-hex txid', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: ['ZZZZZZ' + 'a'.repeat(58) + '.0'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid outpoint format')
  })

  it('rejects outpoint with txid shorter than 64 chars', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: ['abcd.0'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid outpoint format')
  })

  it('rejects outpoint with missing vout', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: ['a'.repeat(64)],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid outpoint format')
  })

  it('rejects outpoint using colon separator instead of dot', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: ['a'.repeat(64) + ':0'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid outpoint format')
  })

  it('rejects outpoint with empty string', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: [''],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('Invalid outpoint format')
  })

  it('rejects outpoint with vout exceeding uint32 max', async () => {
    const request = makeRequest('unlockBSV', {
      outpoints: ['a'.repeat(64) + '.4294967296'],
    })

    const response = await executeApprovedRequest(request, mockKeys)

    expect(response.error).toBeDefined()
    expect(response.error!.code).toBe(-32602)
    expect(response.error!.message).toContain('uint32')
  })
})
