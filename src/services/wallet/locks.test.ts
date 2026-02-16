// @vitest-environment node
/**
 * Tests for wallet lock operations (locks.ts)
 *
 * Covers: parseTimelockScript, lockBSV, unlockBSV,
 *         getCurrentBlockHeight, generateUnlockTxHex, detectLockedUtxos
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UTXO, LockedUTXO } from './types'

// ─── vi.hoisted helpers ────────────────────────────────────────────
const { mockDbState } = vi.hoisted(() => {
  return {
    mockDbState: {
      utxoRows: [] as { spending_status: string | null }[],
      lockRows: [] as { unlocked_at: number | null }[]
    }
  }
})

// ─── Mock @bsv/sdk ─────────────────────────────────────────────────
vi.mock('@bsv/sdk', () => {
  const mockPublicKeyHash = [0xab, 0xcd, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05,
    0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
    0x0e, 0x0f, 0x10, 0x11]
  const mockPublicKeyBytes = [0x02, ...mockPublicKeyHash]

  const mockPublicKey = {
    toAddress: () => '1MockAddress',
    toHash: () => mockPublicKeyHash,
    encode: (compressed: boolean) => compressed ? mockPublicKeyBytes : mockPublicKeyBytes,
    toString: () => '02abcdef0102030405060708090a0b0c0d0e0f1011'
  }

  const mockSignature = {
    toDER: () => [0x30, 0x44, 0x02, 0x20, ...new Array(32).fill(0x01), 0x02, 0x20, ...new Array(32).fill(0x02)]
  }

  const mockPrivateKey = {
    toPublicKey: () => mockPublicKey,
    sign: vi.fn(() => mockSignature)
  }

  // Must be a real function (not arrow) so it works with `new`
  function MockTransaction(this: Record<string, unknown>) {
    this.version = 1
    this.lockTime = 0
    this.outputs = [] as unknown[]
    this.addInput = vi.fn()
    this.addOutput = vi.fn((output: unknown) => {
      (this.outputs as unknown[]).push(output)
    })
    this.sign = vi.fn(async () => { /* no-op */ })
    this.toHex = vi.fn(() => 'deadbeef')
    this.id = vi.fn(() => 'mock-txid-abc123')
  }

  const mockLockingScript = {
    toBinary: () => new Uint8Array([0x01, 0x02, 0x03]),
    toHex: () => '010203',
    fromBinary: vi.fn(),
    fromHex: vi.fn()
  }

  const mockUnlockingScript = {
    fromBinary: vi.fn(() => ({ toBinary: () => [] }))
  }

  // P2PKH and Script must also be constructable with `new`
  function MockP2PKH() {
    return {
      lock: vi.fn(() => ({
        toHex: () => '76a914abcdef88ac',
        toBinary: () => [0x76, 0xa9, 0x14]
      })),
      unlock: vi.fn(() => ({
        sign: vi.fn(),
        estimateLength: vi.fn(async () => 107)
      }))
    }
  }

  function MockScript() {
    return {
      writeBin: vi.fn(),
      toBinary: () => [0x01, 0x02]
    }
  }

  return {
    PrivateKey: {
      fromWif: vi.fn(() => mockPrivateKey)
    },
    PublicKey: {
      fromString: vi.fn(() => mockPublicKey)
    },
    P2PKH: MockP2PKH,
    Transaction: MockTransaction,
    Script: MockScript,
    LockingScript: {
      fromBinary: vi.fn(() => mockLockingScript),
      fromHex: vi.fn(() => mockLockingScript)
    },
    UnlockingScript: {
      fromBinary: vi.fn(() => mockUnlockingScript)
    },
    TransactionSignature: {
      SIGHASH_ALL: 0x01,
      SIGHASH_FORKID: 0x40,
      format: vi.fn(() => [0x01, 0x02, 0x03])
    },
    Hash: {
      sha256: vi.fn(() => new Array(32).fill(0xaa))
    }
  }
})

// ─── Mock domain/locks ──────────────────────────────────────────────
vi.mock('../../domain/locks', () => ({
  createTimelockScript: vi.fn(() => ({
    toBinary: () => new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    toHex: () => '01020304'
  })),
  parseTimelockScript: vi.fn((hex: string) => {
    if (hex === 'valid-timelock-script') {
      // Must match the full 20-byte hash from mockPublicKey.toHash()
      return { unlockBlock: 900000, publicKeyHash: 'abcdef0102030405060708090a0b0c0d0e0f1011' }
    }
    if (hex === 'valid-timelock-other-wallet') {
      return { unlockBlock: 900000, publicKeyHash: 'ffffffffffffffffffffffffffffffffffffffff' }
    }
    return null
  }),
  hex2Int: vi.fn((hex: string) => parseInt(hex, 16)),
  getTimelockScriptSize: vi.fn(() => 200)
}))

// ─── Mock ./transactions ────────────────────────────────────────────
vi.mock('./transactions', () => ({
  broadcastTransaction: vi.fn(async () => 'broadcast-txid-001'),
  executeBroadcast: vi.fn(async () => 'exec-broadcast-txid-001')
}))

// ─── Mock ./fees ────────────────────────────────────────────────────
vi.mock('./fees', () => ({
  calculateLockFee: vi.fn(() => 300),
  feeFromBytes: vi.fn(() => 200)
}))

// ─── Mock ./balance ─────────────────────────────────────────────────
vi.mock('./balance', () => ({
  getTransactionHistory: vi.fn(async () => []),
  getTransactionDetails: vi.fn(async () => null)
}))

// ─── Mock ../sync ───────────────────────────────────────────────────
vi.mock('../sync', () => ({
  recordSentTransaction: vi.fn(async () => { /* no-op */ }),
  confirmUtxosSpent: vi.fn(async () => { /* no-op */ })
}))

// ─── Mock ../database ───────────────────────────────────────────────
vi.mock('../database', () => ({
  markLockUnlockedByTxid: vi.fn(async () => { /* no-op */ }),
  getDatabase: vi.fn(() => ({
    select: vi.fn(async (query: string) => {
      if (query.includes('FROM locks') || query.includes('FROM locks l')) {
        return mockDbState.lockRows
      }
      // Default: utxo spending_status queries
      return mockDbState.utxoRows
    }),
    execute: vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 1 }))
  })),
  addUTXO: vi.fn(async () => 42),
  addLock: vi.fn(async () => 1)
}))

// ─── Mock wocClient ─────────────────────────────────────────────────
type SafeResult<T> = { success: true; data: T } | { success: false; error: { message: string; status?: number } }
const mockWocClient = {
  getBlockHeightSafe: vi.fn<() => Promise<SafeResult<number>>>(async () => ({ success: true, data: 870000 })),
  isOutputSpentSafe: vi.fn<() => Promise<SafeResult<string | null>>>(async () => ({ success: true, data: null })),
  getTransactionDetailsSafe: vi.fn<() => Promise<SafeResult<unknown>>>(async () => ({ success: false, error: { message: 'not found' } }))
}

vi.mock('../../infrastructure/api/wocClient', () => ({
  getWocClient: vi.fn(() => mockWocClient)
}))

// ─── Mock satoshi conversion ────────────────────────────────────────
vi.mock('../../utils/satoshiConversion', () => ({
  btcToSatoshis: vi.fn((btc: number) => Math.round(btc * 100_000_000))
}))

// ─── Mock logger ────────────────────────────────────────────────────
vi.mock('../logger', () => ({
  walletLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// ─── Import modules under test (after mocks) ───────────────────────
import {
  parseTimelockScript,
  lockBSV,
  unlockBSV,
  getCurrentBlockHeight,
  generateUnlockTxHex,
  detectLockedUtxos
} from './locks'
import { broadcastTransaction, executeBroadcast } from './transactions'
import { calculateLockFee, feeFromBytes } from './fees'
import { getTransactionHistory, getTransactionDetails } from './balance'
import { recordSentTransaction, confirmUtxosSpent } from '../sync'
import { markLockUnlockedByTxid, addUTXO, addLock } from '../database'

// ─── Fixtures ───────────────────────────────────────────────────────
const TEST_WIF = 'L1RMEbBkMJ3JKzn3e3cE9Fm4XLKP5Pmjbsci7dqASiJVTCTxhsWi'

function createTestUTXO(overrides?: Partial<UTXO>): UTXO {
  return {
    txid: 'aaa111bbb222ccc333ddd444eee555fff666777888999000aaa111bbb222ccc3',
    vout: 0,
    satoshis: 100_000,
    script: '76a914abcdef88ac',
    ...overrides
  }
}

function createTestLockedUTXO(overrides?: Partial<LockedUTXO>): LockedUTXO {
  return {
    txid: 'lock-txid-aaa111bbb222ccc333ddd444eee555fff666777888999000ab',
    vout: 0,
    satoshis: 50_000,
    lockingScript: 'aabbccdd'.repeat(25), // 200 hex chars = 100 bytes
    unlockBlock: 900_000,
    publicKeyHex: '02abcdef0102030405060708090a0b0c0d0e0f1011',
    createdAt: Date.now(),
    ...overrides
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('locks service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbState.utxoRows = []
    mockDbState.lockRows = []
    mockWocClient.getBlockHeightSafe.mockResolvedValue({ success: true, data: 870000 })
    mockWocClient.isOutputSpentSafe.mockResolvedValue({ success: true, data: null })
  })

  // ── parseTimelockScript ──────────────────────────────────────────

  describe('parseTimelockScript', () => {
    it('should return parsed data for a valid timelock script', () => {
      const result = parseTimelockScript('valid-timelock-script')
      expect(result).not.toBeNull()
      expect(result!.unlockBlock).toBe(900000)
      expect(result!.publicKeyHash).toBe('abcdef0102030405060708090a0b0c0d0e0f1011')
    })

    it('should return null for an invalid/non-timelock script', () => {
      const result = parseTimelockScript('not-a-timelock')
      expect(result).toBeNull()
    })

    it('should return null for empty string', () => {
      const result = parseTimelockScript('')
      expect(result).toBeNull()
    })
  })

  // ── lockBSV ──────────────────────────────────────────────────────

  describe('lockBSV', () => {
    it('should lock satoshis successfully and return txid + lockedUtxo', async () => {
      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      const result = await lockBSV(TEST_WIF, 10_000, 900_000, utxos)

      expect(result.txid).toBe('exec-broadcast-txid-001')
      expect(result.lockedUtxo).toBeDefined()
      expect(result.lockedUtxo.satoshis).toBe(10_000)
      expect(result.lockedUtxo.unlockBlock).toBe(900_000)
      expect(result.lockedUtxo.vout).toBe(0)

      // Verify executeBroadcast was called
      expect(executeBroadcast).toHaveBeenCalledOnce()

      // Verify sync tracking was called
      expect(recordSentTransaction).toHaveBeenCalledOnce()
      expect(confirmUtxosSpent).toHaveBeenCalledOnce()
    })

    it('should throw "Insufficient funds" when total input < satoshis', async () => {
      const utxos = [createTestUTXO({ satoshis: 500 })]

      await expect(lockBSV(TEST_WIF, 10_000, 900_000, utxos))
        .rejects.toThrow('Insufficient funds')
    })

    it('should throw when funds cover amount but not fees', async () => {
      // calculateLockFee returns 300, so need 10_000 + 300 = 10_300 total
      // Provide exactly 10_000 — not enough for fee
      const utxos = [createTestUTXO({ satoshis: 10_000 })]

      await expect(lockBSV(TEST_WIF, 10_000, 900_000, utxos))
        .rejects.toThrow('Insufficient funds')
    })

    it('should select multiple UTXOs to cover amount + fee', async () => {
      const utxos = [
        createTestUTXO({ satoshis: 3_000, txid: 'tx1' + 'a'.repeat(60) }),
        createTestUTXO({ satoshis: 4_000, txid: 'tx2' + 'b'.repeat(60) }),
        createTestUTXO({ satoshis: 5_000, txid: 'tx3' + 'c'.repeat(60) })
      ]

      // Lock 5_000 sats, fee = 300 => need 5_500 (threshold is satoshis + 500)
      // First two UTXOs = 7_000 >= 5_500, so it should stop there
      const result = await lockBSV(TEST_WIF, 5_000, 900_000, utxos)
      expect(result.txid).toBe('exec-broadcast-txid-001')
    })

    it('should handle broadcast failure by propagating error', async () => {
      vi.mocked(executeBroadcast).mockRejectedValueOnce(new Error('Broadcast failed'))

      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      await expect(lockBSV(TEST_WIF, 10_000, 900_000, utxos))
        .rejects.toThrow('Broadcast failed')
    })

    it('should add change UTXO to database when change > 0', async () => {
      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      await lockBSV(TEST_WIF, 10_000, 900_000, utxos)

      // addUTXO should be called twice: once for lock output, once for change
      // (Lock change UTXO + lock UTXO itself)
      expect(addUTXO).toHaveBeenCalledTimes(2)
    })

    it('should add lock record to database', async () => {
      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      await lockBSV(TEST_WIF, 10_000, 900_000, utxos)

      expect(addLock).toHaveBeenCalledOnce()
      expect(addLock).toHaveBeenCalledWith(
        expect.objectContaining({
          unlockBlock: 900_000
        }),
        undefined // accountId
      )
    })

    it('should pass ordinalOrigin and accountId when provided', async () => {
      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      await lockBSV(TEST_WIF, 10_000, 900_000, utxos, 'origin-abc', 870_000, 5)

      expect(addLock).toHaveBeenCalledWith(
        expect.objectContaining({
          unlockBlock: 900_000,
          lockBlock: 870_000,
          ordinalOrigin: 'origin-abc'
        }),
        5
      )

      expect(recordSentTransaction).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        ['lock'],
        expect.any(Number),
        5
      )
    })

    it('should still succeed when post-broadcast tracking fails', async () => {
      vi.mocked(recordSentTransaction).mockRejectedValueOnce(new Error('DB write failed'))

      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      // Should NOT throw — tracking failure is logged and swallowed
      const result = await lockBSV(TEST_WIF, 10_000, 900_000, utxos)
      expect(result.txid).toBe('exec-broadcast-txid-001')
    })

    it('should use the correct fee calculation', async () => {
      const utxos = [createTestUTXO({ satoshis: 100_000 })]

      await lockBSV(TEST_WIF, 10_000, 900_000, utxos)

      expect(calculateLockFee).toHaveBeenCalledWith(
        1, // numInputs
        expect.any(Number) // timelockScriptSize
      )
    })
  })

  // ── unlockBSV ────────────────────────────────────────────────────

  describe('unlockBSV', () => {
    it('should unlock successfully when block height is reached', async () => {
      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 870_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_001)

      expect(txid).toBe('broadcast-txid-001')
      expect(broadcastTransaction).toHaveBeenCalledOnce()
      expect(recordSentTransaction).toHaveBeenCalledOnce()
      expect(markLockUnlockedByTxid).toHaveBeenCalledWith(
        lockedUtxo.txid,
        lockedUtxo.vout,
        undefined
      )
    })

    it('should throw when block height not reached', async () => {
      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 900_000 })

      await expect(unlockBSV(TEST_WIF, lockedUtxo, 870_000))
        .rejects.toThrow('Cannot unlock yet. Current block: 870000, Unlock block: 900000')
    })

    it('should throw when UTXO is already pending in another transaction', async () => {
      mockDbState.utxoRows = [{ spending_status: 'pending' }]

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      await expect(unlockBSV(TEST_WIF, lockedUtxo, 870_000))
        .rejects.toThrow('This lock is already being processed in another transaction')
    })

    it('should proceed when UTXO spending_status is null (not pending)', async () => {
      mockDbState.utxoRows = [{ spending_status: null }]

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_000)
      expect(txid).toBe('broadcast-txid-001')
    })

    it('should proceed when UTXO is not found in database at all', async () => {
      mockDbState.utxoRows = [] // Empty — UTXO not in DB

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_000)
      expect(txid).toBe('broadcast-txid-001')
    })

    it('should throw when output sats would be <= 0 (fee exceeds locked amount)', async () => {
      // feeFromBytes returns 200, so if satoshis <= 200 we get outputSats <= 0
      const lockedUtxo = createTestLockedUTXO({ satoshis: 100 })

      await expect(unlockBSV(TEST_WIF, lockedUtxo, 900_001))
        .rejects.toThrow('Insufficient funds to cover unlock fee')
    })

    it('should handle broadcast failure with already-spent recovery', async () => {
      vi.mocked(broadcastTransaction).mockRejectedValueOnce(new Error('txn-already-known'))
      mockWocClient.isOutputSpentSafe.mockResolvedValueOnce({
        success: true,
        data: 'spending-txid-xyz' // Already spent
      })

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_000)
      expect(txid).toBe('spending-txid-xyz')
      expect(markLockUnlockedByTxid).toHaveBeenCalled()
    })

    it('should re-throw broadcast error when UTXO is genuinely unspent', async () => {
      const broadcastError = new Error('Network error')
      vi.mocked(broadcastTransaction).mockRejectedValueOnce(broadcastError)
      mockWocClient.isOutputSpentSafe.mockResolvedValueOnce({
        success: true,
        data: null // Not spent
      })

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      await expect(unlockBSV(TEST_WIF, lockedUtxo, 870_000))
        .rejects.toThrow('Network error')
    })

    it('should re-throw broadcast error when spent-check API fails', async () => {
      const broadcastError = new Error('Broadcast error')
      vi.mocked(broadcastTransaction).mockRejectedValueOnce(broadcastError)
      mockWocClient.isOutputSpentSafe.mockResolvedValueOnce({
        success: false,
        error: { message: 'API error', status: 500 }
      })

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      await expect(unlockBSV(TEST_WIF, lockedUtxo, 870_000))
        .rejects.toThrow('Broadcast error')
    })

    it('should pass accountId to markLockUnlockedByTxid', async () => {
      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      await unlockBSV(TEST_WIF, lockedUtxo, 870_000, 7)

      expect(markLockUnlockedByTxid).toHaveBeenCalledWith(
        lockedUtxo.txid,
        lockedUtxo.vout,
        7
      )
    })

    it('should still return txid when post-broadcast record fails', async () => {
      vi.mocked(recordSentTransaction).mockRejectedValueOnce(new Error('DB error'))

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_000)
      expect(txid).toBe('broadcast-txid-001')
    })

    it('should still return txid when mark-unlock database call fails', async () => {
      vi.mocked(markLockUnlockedByTxid).mockRejectedValueOnce(new Error('DB error'))

      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      const txid = await unlockBSV(TEST_WIF, lockedUtxo, 870_000)
      expect(txid).toBe('broadcast-txid-001')
    })

    it('should use feeFromBytes for fee calculation', async () => {
      const lockedUtxo = createTestLockedUTXO({ unlockBlock: 800_000 })

      await unlockBSV(TEST_WIF, lockedUtxo, 870_000)

      expect(feeFromBytes).toHaveBeenCalledWith(expect.any(Number))
    })
  })

  // ── getCurrentBlockHeight ────────────────────────────────────────

  describe('getCurrentBlockHeight', () => {
    it('should return block height on success', async () => {
      mockWocClient.getBlockHeightSafe.mockResolvedValueOnce({
        success: true,
        data: 870_123
      })

      const height = await getCurrentBlockHeight()
      expect(height).toBe(870_123)
    })

    it('should throw when API returns error', async () => {
      mockWocClient.getBlockHeightSafe.mockResolvedValueOnce({
        success: false,
        error: { message: 'Network timeout', status: 500 }
      })

      await expect(getCurrentBlockHeight()).rejects.toThrow('Network timeout')
    })
  })

  // ── generateUnlockTxHex ──────────────────────────────────────────

  describe('generateUnlockTxHex', () => {
    it('should generate transaction hex, txid, and outputSats', async () => {
      const lockedUtxo = createTestLockedUTXO({ satoshis: 50_000 })

      const result = await generateUnlockTxHex(TEST_WIF, lockedUtxo)

      expect(result.txHex).toBe('deadbeef')
      expect(result.txid).toBe('mock-txid-abc123')
      // outputSats = 50_000 - 200 (feeFromBytes) = 49_800
      expect(result.outputSats).toBe(49_800)
    })

    it('should throw when locked amount cannot cover fee', async () => {
      const lockedUtxo = createTestLockedUTXO({ satoshis: 50 })

      await expect(generateUnlockTxHex(TEST_WIF, lockedUtxo))
        .rejects.toThrow('Insufficient funds to cover unlock fee')
    })

    it('should not broadcast or record anything (dry run)', async () => {
      const lockedUtxo = createTestLockedUTXO({ satoshis: 50_000 })

      await generateUnlockTxHex(TEST_WIF, lockedUtxo)

      expect(broadcastTransaction).not.toHaveBeenCalled()
      expect(executeBroadcast).not.toHaveBeenCalled()
      expect(recordSentTransaction).not.toHaveBeenCalled()
    })
  })

  // ── detectLockedUtxos ────────────────────────────────────────────

  describe('detectLockedUtxos', () => {
    const walletAddress = '1MockAddress'
    const publicKeyHex = '02abcdef0102030405060708090a0b0c0d0e0f1011'

    it('should return empty array when no transaction history exists', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([])

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toEqual([])
    })

    it('should return empty array when history is null/undefined', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce(null as unknown as [])

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toEqual([])
    })

    it('should detect active locks in transaction history', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-with-lock', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-with-lock',
        hash: 'tx-with-lock',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001, // 10,000 sats
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-script',
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      })

      // isOutputSpentSafe returns null (unspent) by default from beforeEach
      // parseTimelockScript returns match for 'valid-timelock-script'

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)

      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-with-lock')
      expect(result[0]!.vout).toBe(0)
      expect(result[0]!.satoshis).toBe(10_000)
      expect(result[0]!.unlockBlock).toBe(900_000)
      expect(result[0]!.publicKeyHex).toBe(publicKeyHex)
      expect(result[0]!.lockBlock).toBe(870_000)
    })

    it('should skip locks with non-matching public key hash (other wallet)', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-other-wallet', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-other-wallet',
        hash: 'tx-other-wallet',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-other-wallet', // Different PKH
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toHaveLength(0)
    })

    it('should skip already-spent locks', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-spent-lock', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-spent-lock',
        hash: 'tx-spent-lock',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-script',
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      })

      // Mark UTXO as spent
      mockWocClient.isOutputSpentSafe.mockResolvedValueOnce({
        success: true,
        data: 'spending-tx-123' // Spent
      })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toHaveLength(0)
    })

    it('should skip locks in knownUnlockedLocks set', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-known-unlocked', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-known-unlocked',
        hash: 'tx-known-unlocked',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-script',
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      })

      const knownUnlocked = new Set(['tx-known-unlocked:0'])

      const result = await detectLockedUtxos(walletAddress, publicKeyHex, knownUnlocked)
      expect(result).toHaveLength(0)
    })

    it('should skip outputs with no scriptPubKey hex', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-no-script', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-no-script',
        hash: 'tx-no-script',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: '', // Empty hex
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toHaveLength(0)
    })

    it('should deduplicate locks appearing in both mempool and confirmed history', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-dup', height: 870_000 },
        { tx_hash: 'tx-dup', height: 0 } // Same txid in mempool
      ])

      const txDetails = {
        txid: 'tx-dup',
        hash: 'tx-dup',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-script',
            type: 'nonstandard'
          }
        }],
        time: 1700000000,
        blockheight: 870_000
      }

      vi.mocked(getTransactionDetails)
        .mockResolvedValueOnce(txDetails)
        .mockResolvedValueOnce(txDetails)

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      // Should only have 1 entry despite 2 history items with same txid
      expect(result).toHaveLength(1)
    })

    it('should handle errors in individual tx processing gracefully', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-error', height: 870_000 },
        { tx_hash: 'tx-good', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails)
        .mockRejectedValueOnce(new Error('API error for tx-error'))
        .mockResolvedValueOnce({
          txid: 'tx-good',
          hash: 'tx-good',
          version: 1,
          size: 250,
          locktime: 0,
          vin: [],
          vout: [{
            value: 0.0001,
            n: 0,
            scriptPubKey: {
              asm: '',
              hex: 'valid-timelock-script',
              type: 'nonstandard'
            }
          }],
          time: 1700000000,
          blockheight: 870_000
        })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      // Should still detect the second tx lock
      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-good')
    })

    it('should return empty array when getTransactionHistory throws', async () => {
      vi.mocked(getTransactionHistory).mockRejectedValueOnce(new Error('API down'))

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      expect(result).toEqual([])
    })

    it('should use Date.now() as createdAt fallback when tx has no time', async () => {
      const beforeTime = Date.now()

      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-no-time', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-no-time',
        hash: 'tx-no-time',
        version: 1,
        size: 250,
        locktime: 0,
        vin: [],
        vout: [{
          value: 0.0001,
          n: 0,
          scriptPubKey: {
            asm: '',
            hex: 'valid-timelock-script',
            type: 'nonstandard'
          }
        }],
        // No time or blockheight
        blockheight: undefined
      })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)

      expect(result).toHaveLength(1)
      expect(result[0]!.createdAt).toBeGreaterThanOrEqual(beforeTime)
      expect(result[0]!.lockBlock).toBeUndefined()
    })

    it('should check multiple outputs in a transaction', async () => {
      vi.mocked(getTransactionHistory).mockResolvedValueOnce([
        { tx_hash: 'tx-multi-output', height: 870_000 }
      ])

      vi.mocked(getTransactionDetails).mockResolvedValueOnce({
        txid: 'tx-multi-output',
        hash: 'tx-multi-output',
        version: 1,
        size: 400,
        locktime: 0,
        vin: [],
        vout: [
          {
            value: 0.0001,
            n: 0,
            scriptPubKey: { asm: '', hex: 'valid-timelock-script', type: 'nonstandard' }
          },
          {
            value: 0,
            n: 1,
            scriptPubKey: { asm: '', hex: '006a', type: 'nulldata' } // OP_RETURN
          },
          {
            value: 0.005,
            n: 2,
            scriptPubKey: { asm: '', hex: '76a914abcdef88ac', type: 'pubkeyhash' } // Change
          }
        ],
        time: 1700000000,
        blockheight: 870_000
      })

      const result = await detectLockedUtxos(walletAddress, publicKeyHex)
      // Only output 0 matches the timelock pattern
      expect(result).toHaveLength(1)
      expect(result[0]!.vout).toBe(0)
    })
  })
})
