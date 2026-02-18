// @vitest-environment node

/**
 * Tests for Transaction Service (transactions.ts)
 *
 * Covers: broadcastTransaction, executeBroadcast, sendBSV,
 *         sendBSVMultiKey, consolidateUtxos, getAllSpendableUTXOs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UTXO, ExtendedUTXO } from './types'

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const {
  mockInfraBroadcast,
  mockBuildP2PKHTx,
  mockBuildMultiKeyP2PKHTx,
  mockBuildConsolidationTx,
  mockP2pkhLockingScriptHex,
  mockSelectCoins,
  mockSelectCoinsMultiKey,
  mockIsValidBSVAddress,
  mockRecordSentTransaction,
  mockMarkUtxosPendingSpend,
  mockConfirmUtxosSpent,
  mockRollbackPendingSpend,
  mockGetSpendableUtxosFromDatabase,
  mockGetDerivedAddresses,
  mockWithTransaction,
  mockAddUTXO,
  mockResetInactivityTimer,
  mockAcquireSyncLock,
  mockReleaseLock,
} = vi.hoisted(() => {
  const releaseLock = vi.fn()
  return {
    mockInfraBroadcast: vi.fn(),
    mockBuildP2PKHTx: vi.fn(),
    mockBuildMultiKeyP2PKHTx: vi.fn(),
    mockBuildConsolidationTx: vi.fn(),
    mockP2pkhLockingScriptHex: vi.fn((addr: string) => `script_${addr}`),
    mockSelectCoins: vi.fn(),
    mockSelectCoinsMultiKey: vi.fn(),
    mockIsValidBSVAddress: vi.fn(),
    mockRecordSentTransaction: vi.fn(),
    mockMarkUtxosPendingSpend: vi.fn(),
    mockConfirmUtxosSpent: vi.fn(),
    mockRollbackPendingSpend: vi.fn(),
    mockGetSpendableUtxosFromDatabase: vi.fn(),
    mockGetDerivedAddresses: vi.fn(),
    mockWithTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    mockAddUTXO: vi.fn(),
    mockResetInactivityTimer: vi.fn(),
    mockAcquireSyncLock: vi.fn(async () => releaseLock),
    mockReleaseLock: releaseLock,
  }
})

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@bsv/sdk', () => {
  class MockTransaction {
    _hex: string
    _id: string
    constructor() {
      this._hex = 'deadbeef'
      this._id = 'mock-tx-id-from-obj'
    }
    toHex() { return this._hex }
    id(_encoding: string) { return this._id }
  }
  class MockPrivateKey {
    _wif: string
    constructor(wif?: string) { this._wif = wif ?? 'default-wif' }
    static fromWif(wif: string) { return new MockPrivateKey(wif) }
    toPublicKey() {
      return {
        toAddress: () => `addr_${this._wif}`
      }
    }
  }
  return {
    PrivateKey: MockPrivateKey,
    Transaction: MockTransaction,
  }
})

vi.mock('../../infrastructure/api/broadcastService', () => ({
  broadcastTransaction: (...args: unknown[]) => mockInfraBroadcast(...args),
}))

vi.mock('../../domain/wallet/validation', () => ({
  isValidBSVAddress: (...args: unknown[]) => mockIsValidBSVAddress(...args),
}))

vi.mock('../../domain/transaction/coinSelection', () => ({
  selectCoins: (...args: unknown[]) => mockSelectCoins(...args),
  selectCoinsMultiKey: (...args: unknown[]) => mockSelectCoinsMultiKey(...args),
}))

vi.mock('../../domain/transaction/builder', () => ({
  buildP2PKHTx: mockBuildP2PKHTx,
  buildMultiKeyP2PKHTx: mockBuildMultiKeyP2PKHTx,
  buildConsolidationTx: mockBuildConsolidationTx,
  p2pkhLockingScriptHex: mockP2pkhLockingScriptHex,
}))

vi.mock('../sync', () => ({
  recordSentTransaction: (...args: unknown[]) => mockRecordSentTransaction(...args),
  markUtxosPendingSpend: (...args: unknown[]) => mockMarkUtxosPendingSpend(...args),
  confirmUtxosSpent: (...args: unknown[]) => mockConfirmUtxosSpent(...args),
  rollbackPendingSpend: (...args: unknown[]) => mockRollbackPendingSpend(...args),
  getSpendableUtxosFromDatabase: (...args: unknown[]) => mockGetSpendableUtxosFromDatabase(...args),
  BASKETS: { DEFAULT: 'default', DERIVED: 'derived', ORDINALS: 'ordinals', IDENTITY: 'identity', LOCKS: 'locks' },
}))

vi.mock('../database', () => ({
  getDerivedAddresses: (...args: unknown[]) => mockGetDerivedAddresses(...args),
  withTransaction: (...args: unknown[]) => mockWithTransaction(...(args as [() => Promise<unknown>])),
  addUTXO: (...args: unknown[]) => mockAddUTXO(...args),
}))

vi.mock('../autoLock', () => ({
  resetInactivityTimer: (...args: unknown[]) => mockResetInactivityTimer(...args),
}))

vi.mock('../cancellation', () => ({
  acquireSyncLock: mockAcquireSyncLock,
}))

vi.mock('../logger', () => ({
  walletLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('./fees', () => ({
  getFeeRate: () => 0.5,
}))

// ---------------------------------------------------------------------------
// Import under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import {
  broadcastTransaction,
  executeBroadcast,
  sendBSV,
  sendBSVMultiKey,
  consolidateUtxos,
  getAllSpendableUTXOs,
} from './transactions'
import { Transaction } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeUtxo(overrides: Partial<UTXO> = {}): UTXO {
  return {
    txid: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
    vout: 0,
    satoshis: 10_000,
    script: '76a914...88ac',
    ...overrides,
  }
}

function makeExtendedUtxo(overrides: Partial<ExtendedUTXO> = {}): ExtendedUTXO {
  return {
    ...makeUtxo(),
    wif: 'L1testWif',
    address: '1TestAddress',
    ...overrides,
  }
}

const VALID_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const MOCK_TXID = 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00'

// Default BuiltTransaction returned by buildP2PKHTx / buildMultiKeyP2PKHTx
function makeBuiltTx(overrides: Record<string, unknown> = {}) {
  return {
    tx: null,
    rawTx: 'deadbeef',
    txid: 'pending-txid-123',
    fee: 200,
    change: 4800,
    changeAddress: '1ChangeAddr',
    numOutputs: 2,
    spentOutpoints: [{ txid: makeUtxo().txid, vout: 0 }],
    ...overrides,
  }
}

function makeBuiltConsolidationTx(overrides: Record<string, unknown> = {}) {
  return {
    tx: null,
    rawTx: 'deadbeef',
    txid: 'pending-consolidation-123',
    fee: 150,
    outputSats: 9850,
    address: '1WalletAddr',
    spentOutpoints: [{ txid: makeUtxo().txid, vout: 0 }],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transaction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Sensible defaults — individual tests override as needed
    mockIsValidBSVAddress.mockReturnValue(true)
    mockInfraBroadcast.mockResolvedValue(MOCK_TXID)
    mockMarkUtxosPendingSpend.mockResolvedValue(undefined)
    mockConfirmUtxosSpent.mockResolvedValue(undefined)
    mockRollbackPendingSpend.mockResolvedValue(undefined)
    mockRecordSentTransaction.mockResolvedValue(undefined)
    mockAddUTXO.mockResolvedValue(1)
    mockGetDerivedAddresses.mockResolvedValue([])
    mockGetSpendableUtxosFromDatabase.mockResolvedValue([])
    mockReleaseLock.mockReset()
    mockAcquireSyncLock.mockResolvedValue(mockReleaseLock)
  })

  // =========================================================================
  // broadcastTransaction
  // =========================================================================

  describe('broadcastTransaction', () => {
    it('should broadcast a hex string directly', async () => {
      mockInfraBroadcast.mockResolvedValue(MOCK_TXID)

      const txid = await broadcastTransaction('deadbeef')

      expect(mockInfraBroadcast).toHaveBeenCalledWith('deadbeef', undefined)
      expect(txid).toBe(MOCK_TXID)
    })

    it('should broadcast a Transaction object using toHex and id', async () => {
      mockInfraBroadcast.mockResolvedValue(MOCK_TXID)
      const tx = new Transaction()

      const txid = await broadcastTransaction(tx)

      // Transaction.toHex() returns 'deadbeef', id('hex') returns 'mock-tx-id-from-obj'
      expect(mockInfraBroadcast).toHaveBeenCalledWith('deadbeef', 'mock-tx-id-from-obj')
      expect(txid).toBe(MOCK_TXID)
    })

    it('should propagate broadcast errors', async () => {
      mockInfraBroadcast.mockRejectedValue(new Error('network error'))

      await expect(broadcastTransaction('deadbeef')).rejects.toThrow('network error')
    })
  })

  // =========================================================================
  // executeBroadcast
  // =========================================================================

  describe('executeBroadcast', () => {
    const outpoints = [{ txid: 'aaaa', vout: 0 }]

    it('should mark pending, broadcast, and return txid on success', async () => {
      mockInfraBroadcast.mockResolvedValue(MOCK_TXID)

      const txid = await executeBroadcast('deadbeef', 'pending-123', outpoints)

      expect(mockMarkUtxosPendingSpend).toHaveBeenCalledWith(outpoints, 'pending-123')
      expect(mockInfraBroadcast).toHaveBeenCalledWith('deadbeef', undefined)
      expect(txid).toBe(MOCK_TXID)
      // Should NOT rollback on success
      expect(mockRollbackPendingSpend).not.toHaveBeenCalled()
    })

    it('should throw if marking pending fails (before broadcast)', async () => {
      mockMarkUtxosPendingSpend.mockRejectedValue(new Error('DB lock'))

      await expect(
        executeBroadcast('deadbeef', 'pending-123', outpoints)
      ).rejects.toThrow('Failed to prepare transaction - UTXOs could not be locked')

      // Should never reach broadcast
      expect(mockInfraBroadcast).not.toHaveBeenCalled()
      expect(mockRollbackPendingSpend).not.toHaveBeenCalled()
    })

    it('should rollback pending status when broadcast fails', async () => {
      mockInfraBroadcast.mockRejectedValue(new Error('broadcast rejected'))

      await expect(
        executeBroadcast('deadbeef', 'pending-123', outpoints)
      ).rejects.toThrow('broadcast rejected')

      expect(mockMarkUtxosPendingSpend).toHaveBeenCalledWith(outpoints, 'pending-123')
      expect(mockRollbackPendingSpend).toHaveBeenCalledWith(outpoints)
    })

    it('should throw if broadcast returns empty txid', async () => {
      mockInfraBroadcast.mockResolvedValue('')

      await expect(
        executeBroadcast('deadbeef', 'pending-123', outpoints)
      ).rejects.toThrow('Broadcast returned empty transaction ID')

      // Rollback should have been triggered
      expect(mockRollbackPendingSpend).toHaveBeenCalledWith(outpoints)
    })

    it('should still throw broadcast error even if rollback fails', async () => {
      mockInfraBroadcast.mockRejectedValue(new Error('broadcast rejected'))
      mockRollbackPendingSpend.mockRejectedValue(new Error('rollback DB error'))

      await expect(
        executeBroadcast('deadbeef', 'pending-123', outpoints)
      ).rejects.toThrow('wallet state could not be fully restored')

      // Rollback was attempted
      expect(mockRollbackPendingSpend).toHaveBeenCalledWith(outpoints)
    })
  })

  // =========================================================================
  // sendBSV
  // =========================================================================

  describe('sendBSV', () => {
    const wif = 'L1testWif'
    const utxos: UTXO[] = [makeUtxo({ satoshis: 10_000 })]

    beforeEach(() => {
      mockSelectCoins.mockReturnValue({
        selected: utxos,
        total: 10_000,
        sufficient: true,
      })
      mockBuildP2PKHTx.mockResolvedValue(makeBuiltTx())
    })

    it('should send BSV successfully (happy path)', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 1)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value.txid).toBe(MOCK_TXID)
      expect(mockAcquireSyncLock).toHaveBeenCalled()
      expect(mockReleaseLock).toHaveBeenCalled()
      expect(mockIsValidBSVAddress).toHaveBeenCalledWith(VALID_ADDRESS)
      expect(mockSelectCoins).toHaveBeenCalledWith(utxos, 5000)
      expect(mockBuildP2PKHTx).toHaveBeenCalledWith({
        wif,
        toAddress: VALID_ADDRESS,
        satoshis: 5000,
        selectedUtxos: utxos,
        totalInput: 10_000,
        feeRate: 0.5,
      })
      expect(mockResetInactivityTimer).toHaveBeenCalled()
    })

    it('should return err on invalid BSV address', async () => {
      mockIsValidBSVAddress.mockReturnValue(false)

      const result = await sendBSV(wif, 'invalid-address', 5000, utxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid BSV address/)
      // Should not attempt coin selection or broadcast
      expect(mockSelectCoins).not.toHaveBeenCalled()
      expect(mockInfraBroadcast).not.toHaveBeenCalled()
    })

    it('should return err on zero amount', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, 0, utxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid amount/)
    })

    it('should return err on negative amount', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, -100, utxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid amount/)
    })

    it('should return err on NaN amount', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, NaN, utxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid amount/)
    })

    it('should return err on Infinity amount', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, Infinity, utxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid amount/)
    })

    it('should return err on insufficient funds', async () => {
      mockSelectCoins.mockReturnValue({
        selected: [],
        total: 0,
        sufficient: false,
      })

      const result = await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 1)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Insufficient funds/)
    })

    it('should release sync lock even when an error occurs', async () => {
      mockSelectCoins.mockReturnValue({
        selected: utxos,
        total: 10_000,
        sufficient: true,
      })
      mockBuildP2PKHTx.mockRejectedValue(new Error('build failed'))

      const result = await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 1)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/build failed/)
      // Lock must still be released
      expect(mockReleaseLock).toHaveBeenCalled()
    })

    it('should pass accountId to recordTransactionResult', async () => {
      const result = await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 42)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value.txid).toBe(MOCK_TXID)
      // recordSentTransaction is called inside recordTransactionResult -> withTransaction
      expect(mockRecordSentTransaction).toHaveBeenCalledWith(
        MOCK_TXID,
        'deadbeef',
        'Sent 5000 sats to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        ['send'],
        expect.any(Number),
        42,
      )
    })

    it('should record change UTXO when change > 0', async () => {
      mockBuildP2PKHTx.mockResolvedValue(makeBuiltTx({ change: 4800 }))

      await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 1)

      expect(mockAddUTXO).toHaveBeenCalledWith(
        expect.objectContaining({
          txid: MOCK_TXID,
          vout: 1, // numOutputs(2) - 1
          satoshis: 4800,
          address: '1ChangeAddr',
          basket: 'default',
          spendable: true,
        }),
        1,
      )
    })

    it('should NOT record change UTXO when change is 0', async () => {
      mockBuildP2PKHTx.mockResolvedValue(makeBuiltTx({ change: 0, numOutputs: 1 }))

      await sendBSV(wif, VALID_ADDRESS, 5000, utxos, 1)

      expect(mockAddUTXO).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // sendBSVMultiKey
  // =========================================================================

  describe('sendBSVMultiKey', () => {
    const changeWif = 'L1changeWif'
    const extUtxos: ExtendedUTXO[] = [
      makeExtendedUtxo({ satoshis: 6000, wif: 'L1wif1', address: '1Addr1' }),
      makeExtendedUtxo({ satoshis: 5000, vout: 1, wif: 'L2wif2', address: '1Addr2' }),
    ]

    beforeEach(() => {
      mockSelectCoinsMultiKey.mockReturnValue({
        selected: extUtxos,
        total: 11_000,
        sufficient: true,
      })
      mockBuildMultiKeyP2PKHTx.mockResolvedValue(makeBuiltTx())
    })

    it('should send BSV multi-key successfully (happy path)', async () => {
      const result = await sendBSVMultiKey(changeWif, VALID_ADDRESS, 8000, extUtxos, 1)

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Expected ok result')
      expect(result.value.txid).toBe(MOCK_TXID)
      expect(mockAcquireSyncLock).toHaveBeenCalled()
      expect(mockReleaseLock).toHaveBeenCalled()
      expect(mockSelectCoinsMultiKey).toHaveBeenCalledWith(extUtxos, 8000)
      expect(mockBuildMultiKeyP2PKHTx).toHaveBeenCalledWith({
        changeWif,
        toAddress: VALID_ADDRESS,
        satoshis: 8000,
        selectedUtxos: extUtxos,
        totalInput: 11_000,
        feeRate: 0.5,
      })
      expect(mockResetInactivityTimer).toHaveBeenCalled()
    })

    it('should return err on insufficient funds', async () => {
      mockSelectCoinsMultiKey.mockReturnValue({
        selected: [],
        total: 0,
        sufficient: false,
      })

      const result = await sendBSVMultiKey(changeWif, VALID_ADDRESS, 999_999, extUtxos, 1)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Insufficient funds/)
    })

    it('should return err on invalid address', async () => {
      mockIsValidBSVAddress.mockReturnValue(false)

      const result = await sendBSVMultiKey(changeWif, 'bad-addr', 5000, extUtxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid BSV address/)
    })

    it('should return err on zero amount', async () => {
      const result = await sendBSVMultiKey(changeWif, VALID_ADDRESS, 0, extUtxos)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/Invalid amount/)
    })

    it('should release sync lock on error', async () => {
      mockBuildMultiKeyP2PKHTx.mockRejectedValue(new Error('signing error'))

      const result = await sendBSVMultiKey(changeWif, VALID_ADDRESS, 5000, extUtxos, 1)

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Expected error result')
      expect(result.error.message).toMatch(/signing error/)
      expect(mockReleaseLock).toHaveBeenCalled()
    })

    it('should pass accountId through to recording', async () => {
      const result = await sendBSVMultiKey(changeWif, VALID_ADDRESS, 5000, extUtxos, 7)

      expect(result.ok).toBe(true)
      expect(mockRecordSentTransaction).toHaveBeenCalledWith(
        MOCK_TXID,
        'deadbeef',
        expect.stringContaining('Sent 5000 sats'),
        ['send'],
        expect.any(Number),
        7,
      )
    })
  })

  // =========================================================================
  // consolidateUtxos
  // =========================================================================

  describe('consolidateUtxos', () => {
    const wif = 'L1testWif'
    const utxoIds = [
      { txid: 'aa'.repeat(32), vout: 0, satoshis: 3000, script: '76a914...88ac' },
      { txid: 'bb'.repeat(32), vout: 1, satoshis: 4000, script: '76a914...88ac' },
      { txid: 'cc'.repeat(32), vout: 2, satoshis: 3000, script: '76a914...88ac' },
    ]

    beforeEach(() => {
      mockBuildConsolidationTx.mockResolvedValue(makeBuiltConsolidationTx())
    })

    it('should consolidate UTXOs successfully', async () => {
      const result = await consolidateUtxos(wif, utxoIds, 1)

      expect(result.txid).toBe(MOCK_TXID)
      expect(result.outputSats).toBe(9850)
      expect(result.fee).toBe(150)
      expect(mockAcquireSyncLock).toHaveBeenCalled()
      expect(mockReleaseLock).toHaveBeenCalled()
      expect(mockBuildConsolidationTx).toHaveBeenCalledWith({
        wif,
        utxos: utxoIds,
        feeRate: 0.5,
      })
      expect(mockResetInactivityTimer).toHaveBeenCalled()
    })

    it('should record the consolidated UTXO at vout 0', async () => {
      await consolidateUtxos(wif, utxoIds, 1)

      expect(mockAddUTXO).toHaveBeenCalledWith(
        expect.objectContaining({
          txid: MOCK_TXID,
          vout: 0,
          satoshis: 9850,
          address: '1WalletAddr',
          basket: 'default',
          spendable: true,
        }),
      )
    })

    it('should confirm spent outpoints after broadcast', async () => {
      await consolidateUtxos(wif, utxoIds, 1)

      const builtSpentOutpoints = makeBuiltConsolidationTx().spentOutpoints
      expect(mockConfirmUtxosSpent).toHaveBeenCalledWith(builtSpentOutpoints, MOCK_TXID)
    })

    it('should handle single UTXO consolidation', async () => {
      const singleUtxo = [{ txid: 'dd'.repeat(32), vout: 0, satoshis: 5000, script: '76a914...88ac' }]
      mockBuildConsolidationTx.mockResolvedValue(
        makeBuiltConsolidationTx({
          outputSats: 4850,
          fee: 150,
          spentOutpoints: [{ txid: 'dd'.repeat(32), vout: 0 }],
        })
      )

      const result = await consolidateUtxos(wif, singleUtxo, 1)

      expect(result.txid).toBe(MOCK_TXID)
      expect(result.outputSats).toBe(4850)
    })

    it('should release sync lock on build error', async () => {
      mockBuildConsolidationTx.mockRejectedValue(new Error('build failed'))

      await expect(
        consolidateUtxos(wif, utxoIds, 1)
      ).rejects.toThrow('build failed')

      expect(mockReleaseLock).toHaveBeenCalled()
    })

    it('should suppress duplicate key errors on addUTXO', async () => {
      mockAddUTXO.mockRejectedValue(new Error('UNIQUE constraint failed'))

      // Should NOT throw — duplicate is non-fatal
      const result = await consolidateUtxos(wif, utxoIds, 1)
      expect(result.txid).toBe(MOCK_TXID)
    })

    it('should throw on unexpected addUTXO error', async () => {
      mockAddUTXO.mockRejectedValue(new Error('disk full'))

      await expect(
        consolidateUtxos(wif, utxoIds, 1)
      ).rejects.toThrow(/failed to record locally/)
    })

    it('should throw with helpful message if recording fails post-broadcast', async () => {
      mockRecordSentTransaction.mockRejectedValue(new Error('DB write error'))

      await expect(
        consolidateUtxos(wif, utxoIds, 1)
      ).rejects.toThrow(/broadcast succeeded.*failed to record locally/)
    })
  })

  // =========================================================================
  // getAllSpendableUTXOs
  // =========================================================================

  describe('getAllSpendableUTXOs', () => {
    const walletWif = 'L1walletWif'

    it('should return empty array when no UTXOs exist', async () => {
      mockGetSpendableUtxosFromDatabase.mockResolvedValue([])
      mockGetDerivedAddresses.mockResolvedValue([])

      const result = await getAllSpendableUTXOs(walletWif)

      expect(result).toEqual([])
      expect(mockGetSpendableUtxosFromDatabase).toHaveBeenCalledWith('default')
      expect(mockGetSpendableUtxosFromDatabase).toHaveBeenCalledWith('derived')
    })

    it('should combine default and derived basket UTXOs', async () => {
      // Default basket UTXOs
      mockGetSpendableUtxosFromDatabase.mockImplementation(async (basket: string) => {
        if (basket === 'default') {
          return [
            { txid: 'tx1', vout: 0, satoshis: 5000, lockingScript: 'script_default' },
          ]
        }
        if (basket === 'derived') {
          return [
            { txid: 'tx2', vout: 1, satoshis: 3000, lockingScript: 'script_1DerivedAddr' },
          ]
        }
        return []
      })
      mockGetDerivedAddresses.mockResolvedValue([
        { address: '1DerivedAddr', privateKeyWif: 'L2derivedWif' },
      ])
      // p2pkhLockingScriptHex('1DerivedAddr') returns 'script_1DerivedAddr'

      const result = await getAllSpendableUTXOs(walletWif)

      expect(result).toHaveLength(2)
      // Sorted by satoshis ascending
      expect(result[0]!.satoshis).toBe(3000)
      expect(result[0]!.wif).toBe('L2derivedWif')
      expect(result[0]!.address).toBe('1DerivedAddr')
      expect(result[1]!.satoshis).toBe(5000)
      expect(result[1]!.wif).toBe(walletWif)
    })

    it('should skip derived UTXOs with no matching address entry', async () => {
      mockGetSpendableUtxosFromDatabase.mockImplementation(async (basket: string) => {
        if (basket === 'default') return []
        if (basket === 'derived') {
          return [
            { txid: 'tx3', vout: 0, satoshis: 2000, lockingScript: 'unknown_script' },
          ]
        }
        return []
      })
      mockGetDerivedAddresses.mockResolvedValue([
        { address: '1OtherAddr', privateKeyWif: 'L3otherWif' },
      ])

      const result = await getAllSpendableUTXOs(walletWif)

      // The derived UTXO has no matching locking script, so it is skipped
      expect(result).toHaveLength(0)
    })

    it('should sort results by satoshis ascending (smallest first)', async () => {
      mockGetSpendableUtxosFromDatabase.mockImplementation(async (basket: string) => {
        if (basket === 'default') {
          return [
            { txid: 'tx1', vout: 0, satoshis: 9000, lockingScript: 'a' },
            { txid: 'tx2', vout: 0, satoshis: 1000, lockingScript: 'b' },
            { txid: 'tx3', vout: 0, satoshis: 5000, lockingScript: 'c' },
          ]
        }
        return []
      })
      mockGetDerivedAddresses.mockResolvedValue([])

      const result = await getAllSpendableUTXOs(walletWif)

      expect(result.map(u => u.satoshis)).toEqual([1000, 5000, 9000])
    })
  })
})
