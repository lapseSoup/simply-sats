/**
 * PeerCashService — BRC-109 Peer Cash Wallet (PCW-1) protocol support.
 *
 * Provides note splitting into bounded denominations, disjoint coin selection
 * for concurrent payments, outpoint reservation, and deterministic receipt
 * creation for the Peer Cash Wallet protocol.
 *
 * Behind the BRC_PCW feature flag (off by default — experimental).
 *
 * @module services/brc/pcw
 */

import type { TauriProtoWallet } from './adapter'
import { BRC } from '../../config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Note {
  satoshis: number
  denomination: number
}

export interface CoinInput {
  txid: string
  vout: number
  satoshis: number
}

export interface Receipt {
  hash: string
  data: string
}

// ---------------------------------------------------------------------------
// PeerCashService
// ---------------------------------------------------------------------------

export class PeerCashService {
  private _wallet: TauriProtoWallet
  private denominations: number[]
  private reservedOutpoints = new Set<string>()

  constructor(wallet: TauriProtoWallet) {
    this._wallet = wallet
    this.denominations = [...BRC.PCW_NOTE_DENOMINATIONS].sort((a, b) => b - a)
  }

  /** Split an amount into bounded-denomination notes (greedy, largest-first). */
  splitIntoNotes(satoshis: number): Note[] {
    if (satoshis <= 0) return []
    const notes: Note[] = []
    let remaining = satoshis

    for (const denom of this.denominations) {
      while (remaining >= denom) {
        notes.push({ satoshis: denom, denomination: denom })
        remaining -= denom
      }
    }
    // Handle remainder smaller than minimum denomination
    if (remaining > 0) {
      notes.push({ satoshis: remaining, denomination: remaining })
    }
    return notes
  }

  /** Select UTXOs not reserved by other concurrent payments (largest-first). */
  disjointCoinSelection(
    utxos: CoinInput[],
    targetSatoshis: number,
    reserved: Set<string>,
  ): CoinInput[] {
    const available = utxos.filter(
      (u) => !reserved.has(`${u.txid}.${u.vout}`),
    )
    available.sort((a, b) => b.satoshis - a.satoshis)

    const selected: CoinInput[] = []
    let total = 0
    for (const utxo of available) {
      if (total >= targetSatoshis) break
      selected.push(utxo)
      total += utxo.satoshis
    }

    if (total < targetSatoshis) {
      throw new Error(
        `Insufficient non-reserved UTXOs: need ${targetSatoshis}, have ${total}`,
      )
    }
    return selected
  }

  /** Reserve outpoints for a concurrent payment. */
  reserveOutpoints(outpoints: string[]): void {
    outpoints.forEach((op) => this.reservedOutpoints.add(op))
  }

  /** Release reserved outpoints after payment completes or fails. */
  releaseOutpoints(outpoints: string[]): void {
    outpoints.forEach((op) => this.reservedOutpoints.delete(op))
  }

  /** Get a copy of the current set of reserved outpoints. */
  getReservedOutpoints(): Set<string> {
    return new Set(this.reservedOutpoints)
  }

  /**
   * Create a deterministic payment receipt.
   *
   * Note outpoints are sorted before serialisation so that identical inputs
   * in any order always produce the same hash.
   *
   * Uses a simple DJB2-style hash for synchronous operation — production
   * would use crypto.subtle.digest('SHA-256', ...).
   */
  createReceipt(args: {
    amount: number
    peerIdentityKey: string
    noteOutpoints: string[]
  }): Receipt {
    // Canonical JSON with sorted outpoints for deterministic hashing
    const receiptData = JSON.stringify({
      amount: args.amount,
      notes: [...args.noteOutpoints].sort(),
      peer: args.peerIdentityKey,
    })

    // DJB2-style hash — sufficient for receipt IDs in dev/test
    let hash = 5381
    for (let i = 0; i < receiptData.length; i++) {
      hash = ((hash << 5) + hash + receiptData.charCodeAt(i)) | 0
    }
    const hashHex = (hash >>> 0).toString(16).padStart(8, '0')

    return {
      hash: hashHex,
      data: receiptData,
    }
  }
}
