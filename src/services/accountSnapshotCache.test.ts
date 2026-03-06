import { describe, expect, it } from 'vitest'
import { AccountSnapshotCache, type AccountUISnapshot } from './accountSnapshotCache'

function makeSnapshot(id: number): AccountUISnapshot {
  return {
    balance: id * 100,
    ordBalance: id,
    utxos: [{ txid: `utxo-${id}`, vout: 0, satoshis: id, script: '51' }],
    ordinals: [{ origin: `ord-${id}`, txid: `tx-${id}`, vout: 0, satoshis: 1 }],
    txHistory: [{ tx_hash: `tx-${id}`, height: id }],
    locks: [{ txid: `lock-${id}`, vout: 0, satoshis: id, unlockBlock: 100 + id, lockingScript: '', publicKeyHex: '', createdAt: id }],
    basketBalances: {
      default: id * 10,
      ordinals: id,
      identity: 0,
      derived: 0,
      locks: id
    }
  }
}

describe('AccountSnapshotCache', () => {
  it('returns a clone of the stored snapshot', () => {
    const cache = new AccountSnapshotCache(3)
    cache.set(1, makeSnapshot(1))

    const snapshot = cache.get(1)
    expect(snapshot).not.toBeNull()

    snapshot!.txHistory.push({ tx_hash: 'mutated', height: 0 })
    snapshot!.basketBalances.default = 999

    const reread = cache.get(1)
    expect(reread!.txHistory).toHaveLength(1)
    expect(reread!.basketBalances.default).toBe(10)
  })

  it('evicts the least recently used snapshot when over capacity', () => {
    const cache = new AccountSnapshotCache(2)
    cache.set(1, makeSnapshot(1))
    cache.set(2, makeSnapshot(2))

    // Touch account 1 so account 2 becomes the LRU entry.
    expect(cache.get(1)?.balance).toBe(100)

    cache.set(3, makeSnapshot(3))

    expect(cache.get(1)?.balance).toBe(100)
    expect(cache.get(2)).toBeNull()
    expect(cache.get(3)?.balance).toBe(300)
  })
})
