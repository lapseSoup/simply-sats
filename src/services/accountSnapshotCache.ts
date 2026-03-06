import type { LockedUTXO, Ordinal, TxHistoryItem, UTXO } from '../domain/types'

export interface AccountSnapshotBalances {
  default: number
  ordinals: number
  identity: number
  derived: number
  locks: number
}

export interface AccountUISnapshot {
  balance: number
  ordBalance: number
  utxos: UTXO[]
  ordinals: Ordinal[]
  txHistory: TxHistoryItem[]
  locks: LockedUTXO[]
  basketBalances: AccountSnapshotBalances
}

function cloneSnapshot(snapshot: AccountUISnapshot): AccountUISnapshot {
  return {
    balance: snapshot.balance,
    ordBalance: snapshot.ordBalance,
    utxos: [...snapshot.utxos],
    ordinals: [...snapshot.ordinals],
    txHistory: [...snapshot.txHistory],
    locks: [...snapshot.locks],
    basketBalances: { ...snapshot.basketBalances }
  }
}

export class AccountSnapshotCache {
  private readonly snapshots = new Map<number, AccountUISnapshot>()
  private readonly maxEntries: number

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries
  }

  get(accountId: number): AccountUISnapshot | null {
    const snapshot = this.snapshots.get(accountId)
    if (!snapshot) return null

    this.snapshots.delete(accountId)
    this.snapshots.set(accountId, snapshot)

    return cloneSnapshot(snapshot)
  }

  set(accountId: number, snapshot: AccountUISnapshot): void {
    if (this.snapshots.has(accountId)) {
      this.snapshots.delete(accountId)
    }

    this.snapshots.set(accountId, cloneSnapshot(snapshot))

    while (this.snapshots.size > this.maxEntries) {
      const oldestAccountId = this.snapshots.keys().next().value
      if (typeof oldestAccountId !== 'number') break
      this.snapshots.delete(oldestAccountId)
    }
  }
}
