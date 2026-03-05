/**
 * BeefService — Wraps and parses transactions in BEEF format (BRC-62/95).
 *
 * BEEF (Background Evaluation Extended Format) enables Simplified Payment
 * Validation (SPV) by bundling transactions with their merkle proofs.
 *
 * - BRC-62: BEEF standard format
 * - BRC-95: Atomic BEEF (single subject transaction)
 *
 * Uses the @bsv/sdk Beef and Transaction classes for serialization.
 *
 * @module services/brc/beef
 */

import { Beef, BEEF_V1, BEEF_V2, ATOMIC_BEEF, Transaction } from '@bsv/sdk'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum valid BEEF binary size: 4-byte version + 1-byte bumps count + 1-byte txs count */
const MIN_BEEF_SIZE = 6

// ---------------------------------------------------------------------------
// BeefService
// ---------------------------------------------------------------------------

export class BeefService {
  /**
   * Check if binary data is in BEEF format by inspecting magic bytes.
   *
   * Recognises BEEF V1, V2, and Atomic BEEF prefixes.
   */
  isBeef(data: Uint8Array): boolean {
    if (data.length < 4) return false

    // Read first 4 bytes as unsigned little-endian uint32.
    // The outer `>>> 0` ensures the result is unsigned (bitwise OR produces signed int32).
    const magic = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0

    return magic === BEEF_V1 || magic === BEEF_V2 || magic === ATOMIC_BEEF
  }

  /**
   * Wrap a raw transaction hex string in BEEF format (BRC-62).
   *
   * Creates a new Beef container, merges the transaction into it, and
   * serializes to binary. The resulting BEEF will contain the transaction
   * without a merkle proof (suitable for unconfirmed transactions).
   */
  wrapInBeef(rawTxHex: string): Uint8Array {
    if (!rawTxHex || rawTxHex.length === 0) {
      throw new Error('rawTxHex must be a non-empty hex string')
    }

    const tx = Transaction.fromHex(rawTxHex)
    const beef = new Beef()
    beef.mergeTransaction(tx)
    return new Uint8Array(beef.toBinary())
  }

  /**
   * Parse BEEF binary back to transaction data.
   *
   * Returns the txid and raw transaction hex of the last (subject)
   * transaction in the BEEF. For Atomic BEEF, this is the atomic
   * subject transaction.
   *
   * @throws If the data is not valid BEEF or contains no transactions.
   */
  parseBeef(data: Uint8Array): { txid: string; rawTx: string } {
    if (data.length < MIN_BEEF_SIZE) {
      throw new Error('Data too short to be valid BEEF')
    }

    const beef = Beef.fromBinary(data)

    if (beef.txs.length === 0) {
      throw new Error('BEEF contains no transactions')
    }

    // The last transaction is the subject (newest / most dependent)
    const lastTx = beef.txs[beef.txs.length - 1]
    const txid = lastTx.txid

    const rawTxBytes = lastTx.rawTx
    if (!rawTxBytes) {
      throw new Error('BEEF subject transaction has no raw data (txid-only)')
    }

    // Convert number[] to hex string
    const rawTx = rawTxBytes
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return { txid, rawTx }
  }

  /**
   * Create Atomic BEEF (BRC-95) for a single subject transaction.
   *
   * Atomic BEEF prefixes the BEEF data with a magic number and the
   * subject txid, making it self-describing for the recipient.
   */
  toAtomicBeef(rawTxHex: string): Uint8Array {
    if (!rawTxHex || rawTxHex.length === 0) {
      throw new Error('rawTxHex must be a non-empty hex string')
    }

    const tx = Transaction.fromHex(rawTxHex)
    const txid = tx.id('hex')
    const beef = new Beef()
    beef.mergeTransaction(tx)
    return new Uint8Array(beef.toBinaryAtomic(txid))
  }
}
