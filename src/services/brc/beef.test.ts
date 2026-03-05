// @vitest-environment node
/**
 * Tests for BeefService — BRC-62/95 BEEF transaction format.
 *
 * Uses @bsv/sdk Transaction to create minimal test transactions.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Transaction, LockingScript, BEEF_V2, ATOMIC_BEEF } from '@bsv/sdk'
import { BeefService } from './beef'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid transaction with an OP_RETURN output. */
function createMinimalTx(): Transaction {
  const tx = new Transaction()
  tx.addOutput({
    lockingScript: LockingScript.fromHex('006a'), // OP_0 OP_RETURN
    satoshis: 0,
  })
  return tx
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeefService', () => {
  let service: BeefService

  beforeEach(() => {
    service = new BeefService()
  })

  // =========================================================================
  // isBeef
  // =========================================================================

  describe('isBeef', () => {
    it('returns true for BEEF V2 data', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const beefData = service.wrapInBeef(rawHex)
      expect(service.isBeef(beefData)).toBe(true)
    })

    it('returns true for Atomic BEEF data', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const atomicData = service.toAtomicBeef(rawHex)
      expect(service.isBeef(atomicData)).toBe(true)
    })

    it('returns false for raw transaction data', () => {
      const tx = createMinimalTx()
      const rawBytes = tx.toUint8Array()
      expect(service.isBeef(rawBytes)).toBe(false)
    })

    it('returns false for data shorter than 4 bytes', () => {
      expect(service.isBeef(new Uint8Array([0x01, 0x02, 0x03]))).toBe(false)
    })

    it('returns false for empty data', () => {
      expect(service.isBeef(new Uint8Array(0))).toBe(false)
    })

    it('returns false for arbitrary data', () => {
      expect(service.isBeef(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(false)
    })

    it('recognises BEEF V2 magic bytes directly', () => {
      // BEEF_V2 = 4022206466 = 0x0200BEEF in LE = [0x02, 0x00, 0xBE, 0xEF] wait...
      // Actually BEEF_V2 in LE means the bytes are stored as the uint32 LE representation
      // Let's just verify via the actual constant
      const buf = new Uint8Array(4)
      const view = new DataView(buf.buffer)
      view.setUint32(0, BEEF_V2, true) // little-endian
      expect(service.isBeef(buf)).toBe(true)
    })

    it('recognises ATOMIC_BEEF magic bytes directly', () => {
      const buf = new Uint8Array(4)
      const view = new DataView(buf.buffer)
      view.setUint32(0, ATOMIC_BEEF, true) // little-endian
      expect(service.isBeef(buf)).toBe(true)
    })
  })

  // =========================================================================
  // wrapInBeef
  // =========================================================================

  describe('wrapInBeef', () => {
    it('produces valid BEEF binary from raw tx hex', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const beefData = service.wrapInBeef(rawHex)

      expect(beefData).toBeInstanceOf(Uint8Array)
      expect(beefData.length).toBeGreaterThan(6) // version + bumps count + txs count + tx data
      expect(service.isBeef(beefData)).toBe(true)
    })

    it('throws on empty hex string', () => {
      expect(() => service.wrapInBeef('')).toThrow('rawTxHex must be a non-empty hex string')
    })
  })

  // =========================================================================
  // parseBeef
  // =========================================================================

  describe('parseBeef', () => {
    it('round-trips with wrapInBeef', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const expectedTxid = tx.id('hex')

      const beefData = service.wrapInBeef(rawHex)
      const parsed = service.parseBeef(beefData)

      expect(parsed.txid).toBe(expectedTxid)
      expect(parsed.rawTx).toBe(rawHex)
    })

    it('parses Atomic BEEF correctly', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const expectedTxid = tx.id('hex')

      const atomicData = service.toAtomicBeef(rawHex)
      const parsed = service.parseBeef(atomicData)

      expect(parsed.txid).toBe(expectedTxid)
      expect(parsed.rawTx).toBe(rawHex)
    })

    it('throws on data too short', () => {
      expect(() => service.parseBeef(new Uint8Array([1, 2, 3]))).toThrow(
        'Data too short to be valid BEEF',
      )
    })

    it('throws on invalid BEEF data', () => {
      const invalid = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00])
      expect(() => service.parseBeef(invalid)).toThrow()
    })
  })

  // =========================================================================
  // toAtomicBeef
  // =========================================================================

  describe('toAtomicBeef', () => {
    it('produces Atomic BEEF binary with correct prefix', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const atomicData = service.toAtomicBeef(rawHex)

      expect(atomicData).toBeInstanceOf(Uint8Array)
      expect(service.isBeef(atomicData)).toBe(true)

      // Verify Atomic BEEF magic bytes (first 4 bytes = ATOMIC_BEEF LE)
      const view = new DataView(atomicData.buffer, atomicData.byteOffset, atomicData.byteLength)
      const magic = view.getUint32(0, true)
      expect(magic).toBe(ATOMIC_BEEF)
    })

    it('embeds the subject txid after the magic bytes', () => {
      const tx = createMinimalTx()
      const rawHex = tx.toHex()
      const txid = tx.id('hex')
      const atomicData = service.toAtomicBeef(rawHex)

      // Bytes 4..36 are the txid in reversed byte order
      const txidBytes = atomicData.slice(4, 36)
      // Reverse and convert to hex to get the txid
      const reversedHex = Array.from(txidBytes)
        .reverse()
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      expect(reversedHex).toBe(txid)
    })

    it('throws on empty hex string', () => {
      expect(() => service.toAtomicBeef('')).toThrow('rawTxHex must be a non-empty hex string')
    })
  })

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles a transaction with multiple outputs', () => {
      const tx = new Transaction()
      tx.addOutput({
        lockingScript: LockingScript.fromHex('006a'),
        satoshis: 0,
      })
      tx.addOutput({
        lockingScript: LockingScript.fromHex('006a04deadbeef'),
        satoshis: 0,
      })

      const rawHex = tx.toHex()
      const beefData = service.wrapInBeef(rawHex)
      const parsed = service.parseBeef(beefData)

      expect(parsed.txid).toBe(tx.id('hex'))
      expect(parsed.rawTx).toBe(rawHex)
    })
  })
})
