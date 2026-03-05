// @vitest-environment node
/**
 * Tests for PeerCashService — BRC-109 Peer Cash Wallet (PCW-1) protocol.
 *
 * Covers note splitting, disjoint coin selection, outpoint reservation,
 * and deterministic receipt creation.
 *
 * All Tauri IPC calls are mocked — no desktop runtime needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock tauriInvoke before importing the service
// ---------------------------------------------------------------------------
const mockTauriInvoke = vi.fn()
vi.mock('../../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

// Import after mocks are set up
import { PeerCashService } from './pcw'
import { TauriProtoWallet } from './adapter'

describe('PeerCashService', () => {
  let pcw: PeerCashService

  beforeEach(() => {
    vi.clearAllMocks()
    pcw = new PeerCashService(new TauriProtoWallet())
  })

  // -------------------------------------------------------------------------
  // splitIntoNotes
  // -------------------------------------------------------------------------
  describe('splitIntoNotes', () => {
    it('splits amount into bounded denomination notes', () => {
      const notes = pcw.splitIntoNotes(15000)
      // 15000 = 1×10000 + 5×1000
      const total = notes.reduce((sum, n) => sum + n.satoshis, 0)
      expect(total).toBe(15000)
      notes.forEach((note) => {
        expect([100, 1000, 10000, 100000]).toContain(note.denomination)
      })
    })

    it('handles exact denomination amounts', () => {
      const notes = pcw.splitIntoNotes(1000)
      expect(notes).toHaveLength(1)
      expect(notes[0]!.denomination).toBe(1000)
    })

    it('handles amounts smaller than minimum denomination', () => {
      const notes = pcw.splitIntoNotes(50)
      expect(notes).toHaveLength(1)
      expect(notes[0]!.satoshis).toBe(50)
    })

    it('handles zero amount', () => {
      const notes = pcw.splitIntoNotes(0)
      expect(notes).toHaveLength(0)
    })

    it('handles large amounts with multiple denominations', () => {
      const notes = pcw.splitIntoNotes(111100)
      const total = notes.reduce((sum, n) => sum + n.satoshis, 0)
      expect(total).toBe(111100)
      // 1×100000 + 1×10000 + 1×1000 + 1×100
      expect(notes.filter((n) => n.denomination === 100000)).toHaveLength(1)
      expect(notes.filter((n) => n.denomination === 10000)).toHaveLength(1)
      expect(notes.filter((n) => n.denomination === 1000)).toHaveLength(1)
      expect(notes.filter((n) => n.denomination === 100)).toHaveLength(1)
    })

    it('handles amount with only small denominations needed', () => {
      const notes = pcw.splitIntoNotes(300)
      const total = notes.reduce((sum, n) => sum + n.satoshis, 0)
      expect(total).toBe(300)
      expect(notes).toHaveLength(3)
      notes.forEach((n) => expect(n.denomination).toBe(100))
    })
  })

  // -------------------------------------------------------------------------
  // disjointCoinSelection
  // -------------------------------------------------------------------------
  describe('disjointCoinSelection', () => {
    const utxos = [
      { txid: 'a', vout: 0, satoshis: 5000 },
      { txid: 'b', vout: 0, satoshis: 3000 },
      { txid: 'c', vout: 0, satoshis: 2000 },
      { txid: 'd', vout: 1, satoshis: 1000 },
    ]

    it('selects UTXOs not used in other concurrent payments', () => {
      const reserved = new Set(['a.0'])
      const selected = pcw.disjointCoinSelection(utxos, 4000, reserved)
      expect(selected.find((u) => u.txid === 'a')).toBeUndefined()
      const total = selected.reduce((sum, u) => sum + u.satoshis, 0)
      expect(total).toBeGreaterThanOrEqual(4000)
    })

    it('selects from largest to smallest for efficiency', () => {
      const selected = pcw.disjointCoinSelection(utxos, 4000, new Set())
      expect(selected[0]!.satoshis).toBe(5000)
    })

    it('throws when insufficient non-reserved UTXOs', () => {
      const reserved = new Set(['a.0', 'b.0', 'c.0'])
      expect(() => pcw.disjointCoinSelection(utxos, 5000, reserved)).toThrow(
        'Insufficient',
      )
    })

    it('selects multiple UTXOs when needed', () => {
      const selected = pcw.disjointCoinSelection(utxos, 7000, new Set())
      expect(selected.length).toBeGreaterThan(1)
      const total = selected.reduce((sum, u) => sum + u.satoshis, 0)
      expect(total).toBeGreaterThanOrEqual(7000)
    })
  })

  // -------------------------------------------------------------------------
  // reserveOutpoints / releaseOutpoints
  // -------------------------------------------------------------------------
  describe('reserveOutpoints / releaseOutpoints', () => {
    it('reserves and releases outpoints', () => {
      pcw.reserveOutpoints(['a.0', 'b.1'])
      // After reserving, these should be excluded from selection
      const utxos = [
        { txid: 'a', vout: 0, satoshis: 5000 },
        { txid: 'c', vout: 0, satoshis: 3000 },
      ]
      const selected = pcw.disjointCoinSelection(
        utxos,
        2000,
        pcw.getReservedOutpoints(),
      )
      expect(selected.find((u) => u.txid === 'a')).toBeUndefined()

      pcw.releaseOutpoints(['a.0'])
      const selected2 = pcw.disjointCoinSelection(
        utxos,
        2000,
        pcw.getReservedOutpoints(),
      )
      expect(selected2.find((u) => u.txid === 'a')).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  // createReceipt
  // -------------------------------------------------------------------------
  describe('createReceipt', () => {
    it('creates a receipt with hash and data', () => {
      const receipt = pcw.createReceipt({
        amount: 15000,
        peerIdentityKey: '03peer...',
        noteOutpoints: ['txid1.0', 'txid2.0'],
      })
      expect(receipt.hash).toBeDefined()
      expect(typeof receipt.hash).toBe('string')
      expect(receipt.hash.length).toBeGreaterThan(0)
      expect(receipt.data).toContain('15000')
      expect(receipt.data).toContain('03peer...')
    })

    it('sorts note outpoints for deterministic hashing', () => {
      const receipt1 = pcw.createReceipt({
        amount: 1000,
        peerIdentityKey: '03peer...',
        noteOutpoints: ['b.0', 'a.0'],
      })
      const receipt2 = pcw.createReceipt({
        amount: 1000,
        peerIdentityKey: '03peer...',
        noteOutpoints: ['a.0', 'b.0'],
      })
      // Same inputs in different order should produce same hash
      expect(receipt1.hash).toBe(receipt2.hash)
    })
  })
})
