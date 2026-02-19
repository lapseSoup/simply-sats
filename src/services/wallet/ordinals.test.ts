// @vitest-environment node

/**
 * Tests for Ordinals Service (ordinals.ts)
 *
 * Covers: getOrdinals, getOrdinalDetails, scanHistoryForOrdinals, transferOrdinal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGpOrdinalsGet,
  mockGetUtxosSafe,
  mockCalculateTxFee,
  mockExecuteBroadcast,
  mockGetTransactionHistory,
  mockGetTransactionDetails,
  mockRecordSentTransaction,
  mockConfirmUtxosSpent,
  mockMapGpItemToOrdinal,
  mockFilterOneSatOrdinals,
  mockIsOrdinalInscriptionScript,
  mockExtractPkhFromInscriptionScript,
  mockPkhMatches,
  mockExtractContentTypeFromScript,
  mockIsOneSatOutput,
  mockFormatOrdinalOrigin,
} = vi.hoisted(() => ({
  mockGpOrdinalsGet: vi.fn(),
  mockGetUtxosSafe: vi.fn(),
  mockCalculateTxFee: vi.fn(),
  mockExecuteBroadcast: vi.fn(),
  mockGetTransactionHistory: vi.fn(),
  mockGetTransactionDetails: vi.fn(),
  mockRecordSentTransaction: vi.fn(),
  mockConfirmUtxosSpent: vi.fn(),
  mockMapGpItemToOrdinal: vi.fn(),
  mockFilterOneSatOrdinals: vi.fn(),
  mockIsOrdinalInscriptionScript: vi.fn(),
  mockExtractPkhFromInscriptionScript: vi.fn(),
  mockPkhMatches: vi.fn(),
  mockExtractContentTypeFromScript: vi.fn(),
  mockIsOneSatOutput: vi.fn(),
  mockFormatOrdinalOrigin: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../infrastructure/api/clients', () => ({
  gpOrdinalsApi: { get: (...args: unknown[]) => mockGpOrdinalsGet(...args) },
}))

vi.mock('../../infrastructure/api/wocClient', () => ({
  getWocClient: () => ({
    getUtxosSafe: mockGetUtxosSafe,
  }),
}))

vi.mock('./fees', () => ({
  calculateTxFee: (...args: unknown[]) => mockCalculateTxFee(...args),
}))

vi.mock('./transactions', () => ({
  executeBroadcast: (...args: unknown[]) => mockExecuteBroadcast(...args),
}))

vi.mock('./balance', () => ({
  getTransactionHistory: (...args: unknown[]) => mockGetTransactionHistory(...args),
  getTransactionDetails: (...args: unknown[]) => mockGetTransactionDetails(...args),
}))

vi.mock('../sync', () => ({
  recordSentTransaction: (...args: unknown[]) => mockRecordSentTransaction(...args),
  confirmUtxosSpent: (...args: unknown[]) => mockConfirmUtxosSpent(...args),
}))

vi.mock('../logger', () => ({
  walletLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../../domain/ordinals', () => ({
  mapGpItemToOrdinal: (...args: unknown[]) => mockMapGpItemToOrdinal(...args),
  filterOneSatOrdinals: (...args: unknown[]) => mockFilterOneSatOrdinals(...args),
  isOrdinalInscriptionScript: (...args: unknown[]) => mockIsOrdinalInscriptionScript(...args),
  extractPkhFromInscriptionScript: (...args: unknown[]) => mockExtractPkhFromInscriptionScript(...args),
  pkhMatches: (...args: unknown[]) => mockPkhMatches(...args),
  extractContentTypeFromScript: (...args: unknown[]) => mockExtractContentTypeFromScript(...args),
  isOneSatOutput: (...args: unknown[]) => mockIsOneSatOutput(...args),
  formatOrdinalOrigin: (...args: unknown[]) => mockFormatOrdinalOrigin(...args),
}))

// Mock @bsv/sdk — we need PrivateKey, PublicKey, P2PKH, Transaction
vi.mock('@bsv/sdk', () => {
  const mockSign = vi.fn().mockResolvedValue(undefined)
  class MockTransaction {
    _inputs: unknown[] = []
    _outputs: unknown[] = []
    addInput(input: unknown) { this._inputs.push(input) }
    addOutput(output: unknown) { this._outputs.push(output) }
    async sign() { return mockSign() }
    toHex() { return 'deadbeef' }
    id(_enc: string) { return 'mock-pending-txid' }
  }
  class MockPrivateKey {
    _wif: string
    constructor(wif?: string) { this._wif = wif ?? 'default-wif' }
    static fromWif(wif: string) { return new MockPrivateKey(wif) }
    toPublicKey() {
      return {
        toAddress: () => `addr_${this._wif}`,
      }
    }
  }
  class MockP2PKH {
    lock(_addr: string) { return { toHex: () => `lockscript` } }
    unlock(..._args: unknown[]) { return {} }
  }
  class MockScript {
    static fromHex(_hex: string) { return { toHex: () => _hex } }
  }
  return {
    PrivateKey: MockPrivateKey,
    Transaction: MockTransaction,
    P2PKH: MockP2PKH,
    Script: MockScript,
  }
})

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  getOrdinals,
  getOrdinalDetails,
  scanHistoryForOrdinals,
  transferOrdinal,
} from './ordinals'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_ADDRESS = '1TestOrdinalsAddr'
const MOCK_TXID = 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ordinals Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCalculateTxFee.mockReturnValue(200)
    mockFormatOrdinalOrigin.mockImplementation((txid: string, vout: number) => `${txid}_${vout}`)
  })

  // =========================================================================
  // getOrdinals
  // =========================================================================

  describe('getOrdinals', () => {
    it('should return ordinals from GorillaPool API', async () => {
      const gpItems = [
        { txid: 'tx1', vout: 0, satoshis: 1, origin: { data: { insc: {} } } },
      ]
      mockGpOrdinalsGet.mockResolvedValueOnce({ ok: true, value: gpItems })
      // second page empty
      mockGpOrdinalsGet.mockResolvedValueOnce({ ok: true, value: [] })
      mockFilterOneSatOrdinals.mockReturnValue(gpItems)
      mockMapGpItemToOrdinal.mockReturnValue({
        origin: 'tx1_0',
        txid: 'tx1',
        vout: 0,
        satoshis: 1,
        contentType: 'image/png',
      })

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toHaveLength(1)
      expect(result[0]!.origin).toBe('tx1_0')
      expect(mockGpOrdinalsGet).toHaveBeenCalled()
    })

    it('should paginate GorillaPool requests', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        txid: `tx${i}`, vout: 0, satoshis: 1,
      }))
      const page2 = [{ txid: 'tx100', vout: 0, satoshis: 1 }]

      mockGpOrdinalsGet
        .mockResolvedValueOnce({ ok: true, value: page1 })
        .mockResolvedValueOnce({ ok: true, value: page2 })
      mockFilterOneSatOrdinals.mockReturnValueOnce([...page1, ...page2])
      mockMapGpItemToOrdinal.mockReturnValue({
        origin: 'test_0',
        txid: 'test',
        vout: 0,
        satoshis: 1,
      })

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toHaveLength(101)
      // page1 (100 items) + page2 (1 item, less than 100 so stops)
      expect(mockGpOrdinalsGet).toHaveBeenCalledTimes(2)
    })

    it('should fallback to WhatsOnChain when GorillaPool fails', async () => {
      // GP fails for initial fetch
      mockGpOrdinalsGet.mockResolvedValueOnce({ ok: false, error: { message: 'GP down' } })
      mockGetUtxosSafe.mockResolvedValue({
        ok: true,
        value: [
          { txid: 'tx1', vout: 0, satoshis: 1 },
          { txid: 'tx2', vout: 0, satoshis: 5000 }, // Not an ordinal
        ],
      })
      // getOrdinalDetails for the 1-sat UTXO also fails (GP still down)
      mockGpOrdinalsGet.mockResolvedValueOnce({ ok: false, error: { message: 'GP down' } })

      const result = await getOrdinals(TEST_ADDRESS)

      // The 1-sat UTXO should be included even without metadata
      expect(result).toHaveLength(1)
      expect(result[0]!.satoshis).toBe(1)
    })

    it('should return empty array when both APIs fail', async () => {
      mockGpOrdinalsGet.mockResolvedValue({ ok: false, error: { message: 'GP down' } })
      mockGetUtxosSafe.mockResolvedValue({ ok: false, error: { message: 'WoC down' } })

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toEqual([])
    })

    it('should return empty array on unexpected error', async () => {
      mockGpOrdinalsGet.mockRejectedValue(new Error('Unexpected error'))

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toEqual([])
    })

    it('should return empty when GP returns empty array', async () => {
      mockGpOrdinalsGet.mockResolvedValue({ ok: true, value: [] })
      mockGetUtxosSafe.mockResolvedValue({ ok: true, value: [] })

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toEqual([])
    })

    it('should fallback when GP returns non-array', async () => {
      mockGpOrdinalsGet.mockResolvedValue({ ok: true, value: 'not-array' })
      mockGetUtxosSafe.mockResolvedValue({ ok: true, value: [] })

      const result = await getOrdinals(TEST_ADDRESS)

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // getOrdinalDetails
  // =========================================================================

  describe('getOrdinalDetails', () => {
    it('should return ordinal details from GorillaPool', async () => {
      const details = {
        origin: 'tx1_0',
        txid: 'tx1',
        vout: 0,
        data: { insc: { file: { type: 'image/png' } } },
      }
      mockGpOrdinalsGet.mockResolvedValue({ ok: true, value: details })

      const result = await getOrdinalDetails('tx1_0')

      expect(result).toEqual(details)
      expect(mockGpOrdinalsGet).toHaveBeenCalledWith('/api/inscriptions/tx1_0')
    })

    it('should return null when API fails', async () => {
      mockGpOrdinalsGet.mockResolvedValue({ ok: false, error: { message: 'not found' } })

      const result = await getOrdinalDetails('unknown_0')

      expect(result).toBeNull()
    })
  })

  // =========================================================================
  // scanHistoryForOrdinals
  // =========================================================================

  describe('scanHistoryForOrdinals', () => {
    it('should find ordinals in transaction history', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
      ])
      mockGetTransactionDetails.mockResolvedValue({
        vout: [
          { value: 0.00000001, scriptPubKey: { hex: 'inscriptionscript' } },
        ],
      })
      mockIsOneSatOutput.mockReturnValue(true)
      mockIsOrdinalInscriptionScript.mockReturnValue(true)
      mockExtractPkhFromInscriptionScript.mockReturnValue('pkh123')
      mockPkhMatches.mockReturnValue(true)
      // getOrdinalDetails — not spent
      mockGpOrdinalsGet.mockResolvedValue({
        ok: true,
        value: { origin: 'tx1_0', spend: '' },
      })
      mockExtractContentTypeFromScript.mockReturnValue('image/png')

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toHaveLength(1)
      expect(result[0]!.contentType).toBe('image/png')
    })

    it('should skip spent ordinals', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
      ])
      mockGetTransactionDetails.mockResolvedValue({
        vout: [
          { value: 0.00000001, scriptPubKey: { hex: 'inscriptionscript' } },
        ],
      })
      mockIsOneSatOutput.mockReturnValue(true)
      mockIsOrdinalInscriptionScript.mockReturnValue(true)
      mockExtractPkhFromInscriptionScript.mockReturnValue('pkh123')
      mockPkhMatches.mockReturnValue(true)
      // getOrdinalDetails — spent
      mockGpOrdinalsGet.mockResolvedValue({
        ok: true,
        value: { origin: 'tx1_0', spend: 'spending-txid' },
      })

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toHaveLength(0)
    })

    it('should return empty array when no transaction history', async () => {
      mockGetTransactionHistory.mockResolvedValue([])

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toEqual([])
    })

    it('should return empty array when history is null', async () => {
      mockGetTransactionHistory.mockResolvedValue(null)

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toEqual([])
    })

    it('should skip non-1-sat outputs', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
      ])
      mockGetTransactionDetails.mockResolvedValue({
        vout: [
          { value: 0.001, scriptPubKey: { hex: 'script' } },
        ],
      })
      mockIsOneSatOutput.mockReturnValue(false)

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toHaveLength(0)
    })

    it('should skip non-inscription scripts', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
      ])
      mockGetTransactionDetails.mockResolvedValue({
        vout: [
          { value: 0.00000001, scriptPubKey: { hex: 'regularscript' } },
        ],
      })
      mockIsOneSatOutput.mockReturnValue(true)
      mockIsOrdinalInscriptionScript.mockReturnValue(false)

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toHaveLength(0)
    })

    it('should skip when PKH does not match', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
      ])
      mockGetTransactionDetails.mockResolvedValue({
        vout: [
          { value: 0.00000001, scriptPubKey: { hex: 'inscriptionscript' } },
        ],
      })
      mockIsOneSatOutput.mockReturnValue(true)
      mockIsOrdinalInscriptionScript.mockReturnValue(true)
      mockExtractPkhFromInscriptionScript.mockReturnValue('other-pkh')
      mockPkhMatches.mockReturnValue(false)

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toHaveLength(0)
    })

    it('should handle errors in individual transaction processing gracefully', async () => {
      mockGetTransactionHistory.mockResolvedValue([
        { tx_hash: 'tx1', height: 800000 },
        { tx_hash: 'tx2', height: 800001 },
      ])
      // First tx throws error
      mockGetTransactionDetails
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          vout: [
            { value: 0.00000001, scriptPubKey: { hex: 'inscriptionscript' } },
          ],
        })
      mockIsOneSatOutput.mockReturnValue(true)
      mockIsOrdinalInscriptionScript.mockReturnValue(true)
      mockExtractPkhFromInscriptionScript.mockReturnValue('pkh123')
      mockPkhMatches.mockReturnValue(true)
      mockGpOrdinalsGet.mockResolvedValue({
        ok: true,
        value: { origin: 'tx2_0', spend: '' },
      })
      mockExtractContentTypeFromScript.mockReturnValue('text/plain')

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      // Second tx should still be processed
      expect(result).toHaveLength(1)
    })

    it('should handle top-level errors gracefully', async () => {
      mockGetTransactionHistory.mockRejectedValue(new Error('Fatal error'))

      const result = await scanHistoryForOrdinals(TEST_ADDRESS, 'pkh123')

      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // transferOrdinal
  // =========================================================================

  describe('transferOrdinal', () => {
    const ordWif = 'L1ordWif'
    const fundingWif = 'L2fundingWif'
    const toAddress = '1RecipientAddr'
    const ordinalUtxo = { txid: 'aa'.repeat(32), vout: 0, satoshis: 1, script: '76a914...88ac' }
    const fundingUtxos = [
      { txid: 'bb'.repeat(32), vout: 0, satoshis: 10000, script: '76a914...88ac' },
    ]

    beforeEach(() => {
      mockCalculateTxFee.mockReturnValue(200)
      mockExecuteBroadcast.mockResolvedValue(MOCK_TXID)
      mockRecordSentTransaction.mockResolvedValue(undefined)
      mockConfirmUtxosSpent.mockResolvedValue(undefined)
    })

    it('should transfer ordinal successfully', async () => {
      const txid = await transferOrdinal(ordWif, ordinalUtxo, toAddress, fundingWif, fundingUtxos)

      expect(txid).toBe(MOCK_TXID)
      expect(mockExecuteBroadcast).toHaveBeenCalled()
      expect(mockRecordSentTransaction).toHaveBeenCalledWith(
        MOCK_TXID,
        expect.any(String),
        expect.stringContaining('Transferred ordinal'),
        ['ordinal', 'transfer']
      )
      expect(mockConfirmUtxosSpent).toHaveBeenCalled()
    })

    it('should throw when insufficient funding UTXOs', async () => {
      mockCalculateTxFee.mockReturnValue(20000)

      await expect(
        transferOrdinal(ordWif, ordinalUtxo, toAddress, fundingWif, [
          { txid: 'bb'.repeat(32), vout: 0, satoshis: 100, script: '76a914...88ac' },
        ])
      ).rejects.toThrow('Insufficient funds for fee')
    })

    it('should handle tracking failure gracefully (broadcast still succeeds)', async () => {
      mockRecordSentTransaction.mockRejectedValue(new Error('DB error'))

      // Should still return txid even if tracking fails
      const txid = await transferOrdinal(ordWif, ordinalUtxo, toAddress, fundingWif, fundingUtxos)

      expect(txid).toBe(MOCK_TXID)
    })

    it('should select minimal funding UTXOs', async () => {
      const multipleUtxos = [
        { txid: 'b1'.repeat(32), vout: 0, satoshis: 5000, script: '76a914...88ac' },
        { txid: 'b2'.repeat(32), vout: 0, satoshis: 5000, script: '76a914...88ac' },
        { txid: 'b3'.repeat(32), vout: 0, satoshis: 5000, script: '76a914...88ac' },
      ]
      mockCalculateTxFee.mockReturnValue(150)

      const txid = await transferOrdinal(ordWif, ordinalUtxo, toAddress, fundingWif, multipleUtxos)

      expect(txid).toBe(MOCK_TXID)
    })
  })
})
