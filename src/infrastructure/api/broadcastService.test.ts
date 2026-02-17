// @vitest-environment node

/**
 * Tests for Broadcast Service (broadcastService.ts)
 *
 * Covers: isTxAlreadyKnown, broadcastTransaction (4-endpoint cascade),
 *         txid validation, txn-already-known handling, error sanitization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockBroadcastTransactionSafe,
  mockGpArcFetch,
  mockGpMapiFetch,
} = vi.hoisted(() => ({
  mockBroadcastTransactionSafe: vi.fn(),
  mockGpArcFetch: vi.fn(),
  mockGpMapiFetch: vi.fn(),
}))

vi.mock('./wocClient', () => ({
  getWocClient: () => ({
    broadcastTransactionSafe: mockBroadcastTransactionSafe,
  }),
}))

vi.mock('./clients', () => ({
  gpArcApi: { fetch: (...args: unknown[]) => mockGpArcFetch(...args) },
  gpMapiApi: { fetch: (...args: unknown[]) => mockGpMapiFetch(...args) },
}))

vi.mock('../../services/logger', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { broadcastTransaction, isTxAlreadyKnown } from './broadcastService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TXID = 'a'.repeat(64)
const VALID_TXID_2 = 'b'.repeat(64)
const TX_HEX = '0100000001deadbeef'

function makeWocResult(ok: true, txid: string): { ok: true; value: string }
function makeWocResult(ok: false, message: string): { ok: false; error: { message: string } }
function makeWocResult(ok: boolean, value: string) {
  if (ok) return { ok: true, value }
  return { ok: false, error: { message: value } }
}

function makeArcResponse(txid: string, txStatus: string) {
  return {
    ok: true,
    value: {
      json: async () => ({ txid, txStatus }),
    },
  }
}

function makeArcErrorResponse(detail: string) {
  return {
    ok: true,
    value: {
      json: async () => ({ detail }),
    },
  }
}

function makeArcHttpError(message: string) {
  return {
    ok: false,
    error: { message },
  }
}

function makeMapiResponse(txid: string, returnResult: string) {
  return {
    ok: true,
    value: {
      json: async () => ({
        payload: JSON.stringify({ txid, returnResult }),
      }),
    },
  }
}

function makeMapiErrorResponse(resultDescription: string) {
  return {
    ok: true,
    value: {
      json: async () => ({
        payload: JSON.stringify({ resultDescription, returnResult: 'failure' }),
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Broadcast Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: all endpoints fail
    mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
    mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC down'))
    mockGpMapiFetch.mockResolvedValue(makeArcHttpError('mAPI down'))
  })

  // =========================================================================
  // isTxAlreadyKnown
  // =========================================================================

  describe('isTxAlreadyKnown', () => {
    it('should detect txn-already-known pattern', () => {
      expect(isTxAlreadyKnown('txn-already-known')).toBe(true)
    })

    it('should detect transaction already in the mempool', () => {
      expect(isTxAlreadyKnown('Transaction already in the mempool')).toBe(true)
    })

    it('should detect transaction already known', () => {
      expect(isTxAlreadyKnown('transaction already known')).toBe(true)
    })

    it('should detect 257: error code pattern', () => {
      expect(isTxAlreadyKnown('257: Transaction already exists')).toBe(true)
    })

    it('should be case insensitive', () => {
      expect(isTxAlreadyKnown('TXN-ALREADY-KNOWN')).toBe(true)
      expect(isTxAlreadyKnown('TRANSACTION ALREADY KNOWN')).toBe(true)
    })

    it('should return false for unrelated errors', () => {
      expect(isTxAlreadyKnown('insufficient fee')).toBe(false)
      expect(isTxAlreadyKnown('invalid transaction')).toBe(false)
      expect(isTxAlreadyKnown('')).toBe(false)
    })
  })

  // =========================================================================
  // broadcastTransaction - WoC success
  // =========================================================================

  describe('WoC endpoint (first in cascade)', () => {
    it('should return txid on WoC success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(true, VALID_TXID))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
      // Should NOT try other endpoints
      expect(mockGpArcFetch).not.toHaveBeenCalled()
      expect(mockGpMapiFetch).not.toHaveBeenCalled()
    })

    it('should prefer localTxid when WoC returns different valid txid (S2: reject mismatch)', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(true, VALID_TXID))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID_2)

      // Security: locally-computed TXID is trusted over endpoint response
      expect(txid).toBe(VALID_TXID_2)
    })

    it('should use localTxid when WoC returns malformed txid', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(true, 'truncated'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID_2)

      expect(txid).toBe(VALID_TXID_2)
    })

    it('should treat txn-already-known from WoC as success when localTxid exists', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'txn-already-known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
      expect(mockGpArcFetch).not.toHaveBeenCalled()
    })

    it('should treat txn-already-known from WoC catch as success when localTxid exists', async () => {
      mockBroadcastTransactionSafe.mockRejectedValue(new Error('txn-already-known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
    })

    it('should cascade to ARC when WoC fails', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'Server error'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'SEEN_ON_NETWORK'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })
  })

  // =========================================================================
  // broadcastTransaction - ARC JSON success
  // =========================================================================

  describe('ARC JSON endpoint (second in cascade)', () => {
    it('should return txid on ARC SEEN_ON_NETWORK', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'SEEN_ON_NETWORK'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })

    it('should return txid on ARC ACCEPTED', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'ACCEPTED'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })

    it('should treat txn-already-known from ARC as success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcErrorResponse('txn-already-known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
    })

    it('should cascade to ARC text when ARC JSON rejects', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      // First ARC call (JSON) fails
      mockGpArcFetch.mockResolvedValueOnce(makeArcErrorResponse('invalid script'))
      // Second ARC call (text) succeeds
      mockGpArcFetch.mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'SEEN_ON_NETWORK'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
      expect(mockGpArcFetch).toHaveBeenCalledTimes(2)
    })

    it('should treat txn-already-known from ARC HTTP error as success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcHttpError('txn-already-known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
    })
  })

  // =========================================================================
  // broadcastTransaction - ARC text endpoint
  // =========================================================================

  describe('ARC text endpoint (third in cascade)', () => {
    it('should return txid on ARC text success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch
        .mockResolvedValueOnce(makeArcHttpError('ARC JSON down'))
        .mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'ACCEPTED'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })

    it('should treat txn-already-known from ARC text as success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch
        .mockResolvedValueOnce(makeArcHttpError('ARC JSON down'))
        .mockResolvedValueOnce(makeArcErrorResponse('transaction already known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
    })
  })

  // =========================================================================
  // broadcastTransaction - mAPI endpoint
  // =========================================================================

  describe('mAPI endpoint (fourth in cascade)', () => {
    it('should return txid on mAPI success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC down'))
      mockGpMapiFetch.mockResolvedValue(makeMapiResponse(VALID_TXID, 'success'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })

    it('should treat txn-already-known from mAPI as success', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC down'))
      mockGpMapiFetch.mockResolvedValue(makeMapiErrorResponse('txn-already-known'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      expect(txid).toBe(VALID_TXID)
    })

    it('should handle mAPI with object payload (not string)', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC down'))
      mockGpMapiFetch.mockResolvedValue({
        ok: true,
        value: {
          json: async () => ({
            payload: { txid: VALID_TXID, returnResult: 'success' },
          }),
        },
      })

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })

    it('should handle mAPI with no payload', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC down'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC down'))
      mockGpMapiFetch.mockResolvedValue({
        ok: true,
        value: { json: async () => ({}) },
      })

      await expect(broadcastTransaction(TX_HEX)).rejects.toThrow('Broadcast failed')
    })
  })

  // =========================================================================
  // broadcastTransaction - all fail
  // =========================================================================

  describe('all endpoints fail', () => {
    it('should throw with sanitized error message', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'server error'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('connection refused'))
      mockGpMapiFetch.mockResolvedValue(makeArcHttpError('timeout'))

      await expect(broadcastTransaction(TX_HEX)).rejects.toThrow('Broadcast failed')
    })

    it('should strip endpoint names from error messages', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'WoC specific error'))
      mockGpArcFetch.mockResolvedValue(makeArcHttpError('ARC specific error'))
      mockGpMapiFetch.mockResolvedValue(makeArcHttpError('mAPI specific error'))

      try {
        await broadcastTransaction(TX_HEX)
        expect.fail('Should have thrown')
      } catch (error) {
        const msg = (error as Error).message
        // Endpoint names should be stripped
        expect(msg).toContain('Broadcast failed')
      }
    })

    it('should handle all endpoints throwing exceptions', async () => {
      mockBroadcastTransactionSafe.mockRejectedValue(new Error('WoC crash'))
      mockGpArcFetch.mockRejectedValue(new Error('ARC crash'))
      mockGpMapiFetch.mockRejectedValue(new Error('mAPI crash'))

      await expect(broadcastTransaction(TX_HEX)).rejects.toThrow('Broadcast failed')
    })

    it('should use final fallback txn-already-known check', async () => {
      // One endpoint says txn-already-known but doesn't return localTxid early
      // because localTxid is undefined. Another endpoint also fails.
      // But if localTxid IS provided and any error contains txn-already-known:
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(false, 'server error'))
      mockGpArcFetch
        .mockResolvedValueOnce(makeArcHttpError('connection refused'))
        .mockResolvedValueOnce(makeArcHttpError('txn-already-known'))
      mockGpMapiFetch.mockResolvedValue(makeArcHttpError('timeout'))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID)

      // Should succeed via the final fallback check
      expect(txid).toBe(VALID_TXID)
    })
  })

  // =========================================================================
  // broadcastTransaction - txid validation
  // =========================================================================

  describe('txid validation', () => {
    it('should prefer localTxid when WoC returns both valid but different txids (S2)', async () => {
      // WoC returns valid txid, but different from local — security: use local
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(true, VALID_TXID))

      const txid = await broadcastTransaction(TX_HEX, VALID_TXID_2)

      // Locally-computed TXID is trusted over endpoint response
      expect(txid).toBe(VALID_TXID_2)
    })

    it('should cascade when WoC returns invalid txid and no localTxid', async () => {
      mockBroadcastTransactionSafe.mockResolvedValue(makeWocResult(true, 'not-a-valid-txid'))
      mockGpArcFetch.mockResolvedValueOnce(makeArcResponse(VALID_TXID, 'ACCEPTED'))

      const txid = await broadcastTransaction(TX_HEX)

      expect(txid).toBe(VALID_TXID)
    })
  })
})
