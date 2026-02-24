// @vitest-environment node

/**
 * Tests for BRC-100 Actions (actions.ts)
 *
 * Covers: handleBRC100Request (getPublicKey, getHeight, listOutputs, getNetwork,
 *         getVersion, isAuthenticated, unknown method), rejectRequest
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockResolvePublicKey,
  mockResolveListOutputs,
  mockGetBlockHeight,
  mockIsInscriptionTransaction,
  mockSignData,
  mockVerifyDataSignature,
  mockConvertToLockingScript,
  mockGetBalanceFromDB,
  mockRecordActionRequest,
  mockUpdateActionResult,
  mockGetSpendableUTXOs,
  mockAddUTXO,
  mockMarkUTXOSpent,
  mockAddLock,
  mockGetLocks,
  mockMarkLockUnlocked,
  mockAddTransaction,
  mockGetCurrentBlockHeight,
} = vi.hoisted(() => ({
  mockResolvePublicKey: vi.fn(),
  mockResolveListOutputs: vi.fn(),
  mockGetBlockHeight: vi.fn(),
  mockIsInscriptionTransaction: vi.fn(),
  mockSignData: vi.fn(),
  mockVerifyDataSignature: vi.fn(),
  mockConvertToLockingScript: vi.fn(),
  mockGetBalanceFromDB: vi.fn(),
  mockRecordActionRequest: vi.fn(),
  mockUpdateActionResult: vi.fn(),
  mockGetSpendableUTXOs: vi.fn(),
  mockAddUTXO: vi.fn(),
  mockMarkUTXOSpent: vi.fn(),
  mockAddLock: vi.fn(),
  mockGetLocks: vi.fn(),
  mockMarkLockUnlocked: vi.fn(),
  mockAddTransaction: vi.fn(),
  mockGetCurrentBlockHeight: vi.fn(),
}))

vi.mock('../logger', () => ({
  brc100Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./outputs', () => ({
  resolvePublicKey: (...args: unknown[]) => mockResolvePublicKey(...args),
  resolveListOutputs: (...args: unknown[]) => mockResolveListOutputs(...args),
}))

vi.mock('./utils', () => ({
  getBlockHeight: (...args: unknown[]) => mockGetBlockHeight(...args),
  isInscriptionTransaction: (...args: unknown[]) => mockIsInscriptionTransaction(...args),
}))

vi.mock('./signing', () => ({
  signData: (...args: unknown[]) => mockSignData(...args),
  verifyDataSignature: (...args: unknown[]) => mockVerifyDataSignature(...args),
}))

vi.mock('./script', () => ({
  convertToLockingScript: (...args: unknown[]) => mockConvertToLockingScript(...args),
}))

vi.mock('./locks', () => ({
  createLockTransaction: vi.fn(),
}))

vi.mock('./cryptography', () => ({
  encryptECIES: vi.fn().mockResolvedValue({ ciphertext: 'abcdef', senderPublicKey: '02' + 'c'.repeat(64) }),
  decryptECIES: vi.fn().mockResolvedValue('decrypted text'),
}))

// Mock RequestManager as a simple in-memory store
const requestStore = new Map<string, { request: unknown; resolve: (v: unknown) => void; reject: (e: Error) => void }>()

vi.mock('./RequestManager', () => ({
  getRequestManager: () => ({
    get: (id: string) => requestStore.get(id),
    add: (id: string, request: unknown, resolve: (v: unknown) => void, reject: (e: Error) => void) => {
      requestStore.set(id, { request, resolve, reject })
    },
    remove: (id: string) => requestStore.delete(id),
    getAll: () => Array.from(requestStore.values()).map(v => v.request),
    getRequestHandler: () => null,
  }),
}))

vi.mock('./types', () => ({
  getParams: (request: { params: unknown }) => request.params || {},
}))

vi.mock('../wallet', () => ({
  getUTXOs: vi.fn().mockResolvedValue([]),
  calculateTxFee: vi.fn().mockReturnValue(200),
  lockBSV: vi.fn(),
  unlockBSV: vi.fn(),
  getWifForOperation: vi.fn().mockResolvedValue('L1testWif'),
}))

vi.mock('../database', () => ({
  getSpendableUTXOs: (...args: unknown[]) => mockGetSpendableUTXOs(...args),
  addUTXO: (...args: unknown[]) => mockAddUTXO(...args),
  markUTXOSpent: (...args: unknown[]) => mockMarkUTXOSpent(...args),
  addLock: (...args: unknown[]) => mockAddLock(...args),
  getLocks: (...args: unknown[]) => mockGetLocks(...args),
  markLockUnlocked: (...args: unknown[]) => mockMarkLockUnlocked(...args),
  addTransaction: (...args: unknown[]) => mockAddTransaction(...args),
  getBalanceFromDB: (...args: unknown[]) => mockGetBalanceFromDB(...args),
  recordActionRequest: (...args: unknown[]) => mockRecordActionRequest(...args),
  updateActionResult: (...args: unknown[]) => mockUpdateActionResult(...args),
}))

vi.mock('../sync', () => ({
  BASKETS: { DEFAULT: 'default', ORDINALS: 'ordinals', IDENTITY: 'identity', LOCKS: 'locks' },
  getCurrentBlockHeight: (...args: unknown[]) => mockGetCurrentBlockHeight(...args),
}))

vi.mock('../overlay', () => ({
  broadcastWithOverlay: vi.fn(),
  TOPICS: { DEFAULT: 'tm_default', ORDINALS: 'tm_ordinals', WROOTZ_LOCKS: 'tm_wrootz_locks' },
}))

vi.mock('../inscription', () => ({
  parseInscription: vi.fn(),
  isInscriptionScript: vi.fn().mockReturnValue(false),
}))

vi.mock('../keyDerivation', () => ({
  deriveTaggedKey: vi.fn(),
}))

vi.mock('@bsv/sdk', () => ({
  PrivateKey: class {
    static fromWif() { return { toPublicKey: () => ({ toAddress: () => '1TestAddr' }) } }
  },
  P2PKH: class {
    lock() { return { toHex: () => 'lockscript' } }
    unlock() { return {} }
  },
  Transaction: class {
    addInput() {}
    addOutput() {}
    async sign() {}
    toHex() { return 'rawtx' }
    id() { return 'txid123' }
    lockTime = 0
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { handleBRC100Request, rejectRequest } from './actions'
import type { WalletKeys } from '../wallet'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockKeys: WalletKeys = {
  mnemonic: 'test mnemonic',
  walletType: 'yours',
  walletWif: 'L1walletWif',
  walletAddress: '1WalletAddr',
  walletPubKey: '02' + 'a'.repeat(64),
  ordWif: 'L1ordWif',
  ordAddress: '1OrdAddr',
  ordPubKey: '02' + 'b'.repeat(64),
  identityWif: 'L1identityWif',
  identityAddress: '1IdentityAddr',
  identityPubKey: '02' + 'c'.repeat(64),
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BRC-100 Actions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    requestStore.clear()
    mockRecordActionRequest.mockResolvedValue(undefined)
    mockUpdateActionResult.mockResolvedValue(undefined)
    mockAddUTXO.mockResolvedValue({ ok: true, value: 1 })
  })

  // =========================================================================
  // handleBRC100Request - getPublicKey
  // =========================================================================

  describe('handleBRC100Request - getPublicKey', () => {
    it('should return public key', async () => {
      mockResolvePublicKey.mockReturnValue('02' + 'a'.repeat(64))

      const response = await handleBRC100Request(
        { id: 'req1', type: 'getPublicKey', params: {} },
        mockKeys,
        true
      )

      expect(response.id).toBe('req1')
      expect(response.result).toEqual({ publicKey: '02' + 'a'.repeat(64) })
      expect(response.error).toBeUndefined()
    })
  })

  // =========================================================================
  // handleBRC100Request - getHeight
  // =========================================================================

  describe('handleBRC100Request - getHeight', () => {
    it('should return current block height', async () => {
      mockGetBlockHeight.mockResolvedValue(800000)

      const response = await handleBRC100Request(
        { id: 'req2', type: 'getHeight', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({ height: 800000 })
    })
  })

  // =========================================================================
  // handleBRC100Request - listOutputs
  // =========================================================================

  describe('handleBRC100Request - listOutputs', () => {
    it('should return outputs from resolver', async () => {
      mockResolveListOutputs.mockResolvedValue({
        outputs: [{ satoshis: 5000, spendable: true }],
        totalOutputs: 1,
      })

      const response = await handleBRC100Request(
        { id: 'req3', type: 'listOutputs', params: { basket: 'default' } },
        mockKeys,
        true
      )

      expect(response.result).toEqual({
        outputs: [{ satoshis: 5000, spendable: true }],
        totalOutputs: 1,
      })
    })

    it('should fallback to database balance on resolver error', async () => {
      mockResolveListOutputs.mockRejectedValue(new Error('Resolver failed'))
      mockGetBalanceFromDB.mockResolvedValue({ ok: true, value: 10000 })

      const response = await handleBRC100Request(
        { id: 'req3b', type: 'listOutputs', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({
        outputs: [{ satoshis: 10000, spendable: true }],
        totalOutputs: 1,
      })
    })

    it('should return empty outputs when both resolver and DB fail', async () => {
      mockResolveListOutputs.mockRejectedValue(new Error('Resolver failed'))
      mockGetBalanceFromDB.mockResolvedValue({ ok: false, error: { message: 'DB failed' } })

      const response = await handleBRC100Request(
        { id: 'req3c', type: 'listOutputs', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({ outputs: [], totalOutputs: 0 })
    })
  })

  // =========================================================================
  // handleBRC100Request - getNetwork
  // =========================================================================

  describe('handleBRC100Request - getNetwork', () => {
    it('should return mainnet', async () => {
      const response = await handleBRC100Request(
        { id: 'req4', type: 'getNetwork', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({ network: 'mainnet' })
    })
  })

  // =========================================================================
  // handleBRC100Request - getVersion
  // =========================================================================

  describe('handleBRC100Request - getVersion', () => {
    it('should return version', async () => {
      const response = await handleBRC100Request(
        { id: 'req5', type: 'getVersion', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({ version: '0.1.0' })
    })
  })

  // =========================================================================
  // handleBRC100Request - isAuthenticated
  // =========================================================================

  describe('handleBRC100Request - isAuthenticated', () => {
    it('should return authenticated true', async () => {
      const response = await handleBRC100Request(
        { id: 'req6', type: 'isAuthenticated', params: {} },
        mockKeys,
        true
      )

      expect(response.result).toEqual({ authenticated: true })
    })
  })

  // =========================================================================
  // handleBRC100Request - unknown method
  // =========================================================================

  describe('handleBRC100Request - unknown method', () => {
    it('should return method not found error', async () => {
      const response = await handleBRC100Request(
        { id: 'req7', type: 'unknownMethod' as never, params: {} },
        mockKeys,
        true
      )

      expect(response.error).toEqual({ code: -32601, message: 'Method not found' })
    })
  })

  // =========================================================================
  // handleBRC100Request - createSignature (auto-approve)
  // =========================================================================

  describe('handleBRC100Request - createSignature (auto-approve)', () => {
    it('should sign data when auto-approved', async () => {
      mockSignData.mockResolvedValue('deadbeef')
      mockVerifyDataSignature.mockResolvedValue(true)

      const response = await handleBRC100Request(
        {
          id: 'req8',
          type: 'createSignature',
          params: { data: Array.from(Buffer.from('hello world')) },
        },
        mockKeys,
        true
      )

      expect(response.result).toHaveProperty('signature')
      expect(mockSignData).toHaveBeenCalled()
      expect(mockVerifyDataSignature).toHaveBeenCalled()
    })

    it('should return error when self-verification fails', async () => {
      mockSignData.mockResolvedValue('deadbeef')
      mockVerifyDataSignature.mockResolvedValue(false)

      const response = await handleBRC100Request(
        {
          id: 'req8b',
          type: 'createSignature',
          params: { data: Array.from(Buffer.from('hello world')) },
        },
        mockKeys,
        true
      )

      expect(response.error).toBeDefined()
      expect(response.error!.message).toContain('Self-verification')
    })

    it('should reject non-byte-array data', async () => {
      const response = await handleBRC100Request(
        {
          id: 'req8c',
          type: 'createSignature',
          params: { data: 'hello world' },
        },
        mockKeys,
        true
      )

      expect(response.error).toBeDefined()
      expect(response.error!.message).toContain('data must be an array of bytes')
    })
  })

  // =========================================================================
  // handleBRC100Request - createSignature (requires approval)
  // =========================================================================

  describe('handleBRC100Request - createSignature (requires approval)', () => {
    it('should queue request when not auto-approved', async () => {
      // This returns a promise that never resolves (pending approval)
      const responsePromise = handleBRC100Request(
        {
          id: 'req9',
          type: 'createSignature',
          params: { data: Array.from(Buffer.from('hello')) },
        },
        mockKeys,
        false // not auto-approved
      )

      // Verify request was queued
      expect(requestStore.has('req9')).toBe(true)

      // Resolve it manually
      const pending = requestStore.get('req9')!
      pending.resolve({ id: 'req9', result: { signature: [1, 2, 3] } })

      const response = await responsePromise
      expect(response).toEqual({ id: 'req9', result: { signature: [1, 2, 3] } })
    })
  })

  // =========================================================================
  // handleBRC100Request - createAction (always requires approval)
  // =========================================================================

  describe('handleBRC100Request - createAction', () => {
    it('should queue createAction request even when auto-approve is true', async () => {
      const responsePromise = handleBRC100Request(
        {
          id: 'req10',
          type: 'createAction',
          params: { outputs: [], description: 'Test action' },
        },
        mockKeys,
        true // auto-approve, but createAction always queues
      )

      expect(requestStore.has('req10')).toBe(true)

      // Resolve manually
      const pending = requestStore.get('req10')!
      pending.resolve({ id: 'req10', result: { txid: 'abc123' } })

      const response = await responsePromise
      expect(response.result).toEqual({ txid: 'abc123' })
    })
  })

  // =========================================================================
  // handleBRC100Request - error handling
  // =========================================================================

  describe('handleBRC100Request - error handling', () => {
    it('should catch and return errors from handlers', async () => {
      mockResolvePublicKey.mockImplementation(() => {
        throw new Error('Key derivation failed')
      })

      const response = await handleBRC100Request(
        { id: 'req11', type: 'getPublicKey', params: {} },
        mockKeys,
        true
      )

      expect(response.error).toBeDefined()
      expect(response.error!.code).toBe(-32000)
      expect(response.error!.message).toBe('Key derivation failed')
    })
  })

  // =========================================================================
  // rejectRequest
  // =========================================================================

  describe('rejectRequest', () => {
    it('should reject a pending request', async () => {
      let resolvedResponse: unknown = null
      const promise = new Promise<void>((resolve) => {
        requestStore.set('req-to-reject', {
          request: { id: 'req-to-reject', type: 'createAction', params: {} },
          resolve: (response: unknown) => {
            resolvedResponse = response
            resolve()
          },
          reject: vi.fn(),
        })
      })

      await rejectRequest('req-to-reject')
      await promise

      expect(resolvedResponse).toEqual({
        id: 'req-to-reject',
        error: { code: -32003, message: 'User rejected request' },
      })
      expect(requestStore.has('req-to-reject')).toBe(false)
    })

    it('should do nothing for non-existent request', async () => {
      await expect(rejectRequest('non-existent')).resolves.toBeUndefined()
    })

    it('should record rejection in audit log', async () => {
      requestStore.set('req-audit', {
        request: { id: 'req-audit', type: 'createAction', params: { description: 'Test' } },
        resolve: vi.fn(),
        reject: vi.fn(),
      })

      await rejectRequest('req-audit')

      expect(mockRecordActionRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-audit',
          approved: false,
          error: 'User rejected request',
        })
      )
    })
  })
})
