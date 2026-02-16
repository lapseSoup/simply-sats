// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('./connection', () => ({
  getDatabase: vi.fn(),
  withTransaction: vi.fn((fn: () => Promise<unknown>) => fn())
}))

vi.mock('../logger', () => ({
  dbLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { getDatabase } from './connection'
import {
  addUTXO,
  getSpendableUTXOs,
  getSpendableUTXOsByAddress,
  markUTXOSpent,
  getUtxoByOutpoint,
  getBalanceFromDB,
  getUTXOsByBasket,
  markUtxosPendingSpend,
  confirmUtxosSpent,
  rollbackPendingSpend,
  getPendingUtxos,
  toggleUtxoFrozen,
  repairUTXOs,
  clearUtxosForAccount,
  getAllUTXOs,
} from './utxoRepository'

const mockDb = {
  select: vi.fn(),
  execute: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDatabase).mockReturnValue(mockDb as never)
  // Default: ensureColumn probes succeed (columns exist)
  mockDb.select.mockResolvedValue([])
  mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 0 })
})

// ---------- addUTXO ----------

describe('addUTXO', () => {
  const baseUtxo = {
    txid: 'abc123',
    vout: 0,
    satoshis: 5000,
    lockingScript: '76a914...',
    address: '1Test',
    basket: 'derived',
    spendable: true,
    createdAt: Date.now(),
  }

  it('inserts a new UTXO when none exists', async () => {
    // ensureColumn probe returns success (columns exist)
    mockDb.select
      .mockResolvedValueOnce([]) // ensureAddressColumn probe
      .mockResolvedValueOnce([]) // no existing UTXO
      .mockResolvedValueOnce([{ id: 1, basket: 'derived', spendable: 1 }]) // verify

    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 42, rowsAffected: 1 })

    const id = await addUTXO(baseUtxo, 5)
    expect(id).toBe(42)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO utxos'),
      expect.arrayContaining(['abc123', 0, 5000])
    )
  })

  it('updates existing derived UTXO (case 1)', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ id: 10, basket: 'derived', address: '1Old', spendable: 0, spent_at: null }])

    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    const id = await addUTXO(baseUtxo, 3)
    expect(id).toBe(10)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE utxos SET'),
      expect.arrayContaining(['1Test', 1, 3, 10])
    )
  })

  it('upgrades to derived when new is derived and existing is not (case 2)', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ id: 20, basket: 'default', address: '1Old', spendable: 0, spent_at: null }])

    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    const id = await addUTXO({ ...baseUtxo, basket: 'derived' }, 2)
    expect(id).toBe(20)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("basket = $1"),
      expect.arrayContaining(['derived', '1Test', '76a914...', 1, 2, 20])
    )
  })

  it('updates existing UTXO with same basket (case 3)', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ id: 30, basket: 'default', address: '1Old', spendable: 1, spent_at: null }])

    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    const id = await addUTXO({ ...baseUtxo, basket: 'default' }, 7)
    expect(id).toBe(30)
  })

  it('defaults accountId to 1 when not provided', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([]) // no existing
      .mockResolvedValueOnce([{ id: 1, basket: 'derived', spendable: 1 }])

    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 50, rowsAffected: 1 })

    await addUTXO(baseUtxo)
    // The 9th param (accountId) should be 1
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO utxos'),
      expect.arrayContaining([1]) // accountId default
    )
  })

  it('inserts tags when provided', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([]) // no existing
      .mockResolvedValueOnce([{ id: 1, basket: 'derived', spendable: 1 }])

    mockDb.execute
      .mockResolvedValueOnce({ lastInsertId: 60, rowsAffected: 1 }) // INSERT utxo
      .mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 }) // tag 1
      .mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 }) // tag 2

    await addUTXO({ ...baseUtxo, tags: ['lock', 'important'] }, 1)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT INTO utxo_tags (utxo_id, tag) VALUES ($1, $2)',
      [60, 'lock']
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT INTO utxo_tags (utxo_id, tag) VALUES ($1, $2)',
      [60, 'important']
    )
  })

  it('silently ignores duplicate tag insertion errors', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([]) // no existing
      .mockResolvedValueOnce([{ id: 1, basket: 'derived', spendable: 1 }])

    mockDb.execute
      .mockResolvedValueOnce({ lastInsertId: 70, rowsAffected: 1 })
      .mockRejectedValueOnce(new Error('UNIQUE constraint failed'))

    // Should not throw
    await expect(addUTXO({ ...baseUtxo, tags: ['dup'] }, 1)).resolves.toBe(70)
  })
})

// ---------- getSpendableUTXOs ----------

describe('getSpendableUTXOs', () => {
  it('returns mapped UTXOs without account filter', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([
        { id: 1, txid: 'tx1', vout: 0, satoshis: 1000, locking_script: 'ls1', address: '1A', basket: 'default', spendable: 1, created_at: 100, spent_at: null, spent_txid: null }
      ])

    const result = await getSpendableUTXOs()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ txid: 'tx1', satoshis: 1000, spendable: true })
  })

  it('filters by accountId when provided', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([])

    await getSpendableUTXOs(5)
    const selectCall = mockDb.select.mock.calls[1]!
    expect(selectCall[0]).toContain('account_id = $1')
    expect(selectCall[1]).toEqual([5])
  })

  it('returns empty array when no spendable UTXOs exist', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([])

    const result = await getSpendableUTXOs()
    expect(result).toEqual([])
  })

  it('handles null address gracefully', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([
        { id: 1, txid: 'tx1', vout: 0, satoshis: 500, locking_script: 'ls1', address: null, basket: 'default', spendable: 1, created_at: 100, spent_at: null, spent_txid: null }
      ])

    const result = await getSpendableUTXOs()
    expect(result[0]!.address).toBe('')
  })
})

// ---------- getSpendableUTXOsByAddress ----------

describe('getSpendableUTXOsByAddress', () => {
  it('queries with address filter', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([])

    await getSpendableUTXOsByAddress('1MyAddr')
    const call = mockDb.select.mock.calls[1]!
    expect(call[0]).toContain('address = $1')
    expect(call[1]).toEqual(['1MyAddr'])
  })
})

// ---------- markUTXOSpent ----------

describe('markUTXOSpent', () => {
  it('marks a UTXO as spent without accountId', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    await markUTXOSpent('txA', 0, 'spendTx1')
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE utxos SET spent_at'),
      expect.arrayContaining(['spendTx1', 'spent', 'txA', 0])
    )
  })

  it('scopes by accountId when provided', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    await markUTXOSpent('txB', 1, 'spendTx2', 3)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('account_id = $6')
    expect(call[1]).toContain(3)
  })
})

// ---------- getUtxoByOutpoint ----------

describe('getUtxoByOutpoint', () => {
  it('returns satoshis when found', async () => {
    mockDb.select.mockResolvedValueOnce([{ satoshis: 2500 }])

    const result = await getUtxoByOutpoint('txC', 0)
    expect(result).toEqual({ satoshis: 2500 })
  })

  it('returns null when not found', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await getUtxoByOutpoint('txD', 1)
    expect(result).toBeNull()
  })

  it('includes accountId in query when provided', async () => {
    mockDb.select.mockResolvedValueOnce([{ satoshis: 100 }])

    await getUtxoByOutpoint('txE', 0, 7)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $3')
    expect(call[1]).toEqual(['txE', 0, 7])
  })
})

// ---------- getBalanceFromDB ----------

describe('getBalanceFromDB', () => {
  it('returns total balance', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ total: 15000 }])

    const result = await getBalanceFromDB()
    expect(result).toBe(15000)
  })

  it('returns 0 when total is null', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ total: null }])

    const result = await getBalanceFromDB()
    expect(result).toBe(0)
  })

  it('filters by basket', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ total: 3000 }])

    const result = await getBalanceFromDB('derived')
    expect(result).toBe(3000)
    const call = mockDb.select.mock.calls[1]!
    expect(call[0]).toContain('basket = $1')
  })

  it('filters by basket and accountId', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([{ total: 1000 }])

    await getBalanceFromDB('default', 2)
    const call = mockDb.select.mock.calls[1]!
    expect(call[0]).toContain('basket = $1')
    expect(call[0]).toContain('account_id = $2')
    expect(call[1]).toEqual(['default', 2])
  })

  it('returns 0 when result set is empty', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([])

    const result = await getBalanceFromDB()
    expect(result).toBe(0)
  })
})

// ---------- getUTXOsByBasket ----------

describe('getUTXOsByBasket', () => {
  it('fetches UTXOs with tags', async () => {
    mockDb.select
      .mockResolvedValueOnce([
        { id: 1, txid: 'tx1', vout: 0, satoshis: 2000, locking_script: 'ls', address: '1A', basket: 'derived', spendable: 1, created_at: 100, spent_at: null, spent_txid: null }
      ])
      .mockResolvedValueOnce([{ tag: 'important' }]) // tags for utxo 1

    const result = await getUTXOsByBasket('derived')
    expect(result).toHaveLength(1)
    expect(result[0]!.tags).toEqual(['important'])
  })

  it('applies spendable filter when spendableOnly is true', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getUTXOsByBasket('default', true)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('spendable = 1')
    expect(call[0]).toContain('spent_at IS NULL')
  })

  it('skips spendable filter when spendableOnly is false', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getUTXOsByBasket('default', false)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).not.toContain('spendable = 1')
  })

  it('filters by accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getUTXOsByBasket('default', true, 4)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $2')
    expect(call[1]).toEqual(['default', 4])
  })
})

// ---------- markUtxosPendingSpend ----------

describe('markUtxosPendingSpend', () => {
  it('marks multiple UTXOs as pending', async () => {
    mockDb.select.mockResolvedValueOnce([]) // ensureColumn probe
    mockDb.execute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 })

    await markUtxosPendingSpend(
      [{ txid: 'tx1', vout: 0 }, { txid: 'tx2', vout: 1 }],
      'pendingTx'
    )
    // One execute per utxo
    expect(mockDb.execute).toHaveBeenCalledTimes(2)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("spending_status = 'pending'"),
      expect.arrayContaining(['pendingTx', 'tx1', 0])
    )
  })
})

// ---------- confirmUtxosSpent ----------

describe('confirmUtxosSpent', () => {
  it('confirms UTXOs as spent', async () => {
    mockDb.execute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 })

    await confirmUtxosSpent([{ txid: 'tx1', vout: 0 }], 'spendTx')
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("spending_status = 'spent'"),
      expect.arrayContaining(['spendTx', 'tx1', 0])
    )
  })
})

// ---------- rollbackPendingSpend ----------

describe('rollbackPendingSpend', () => {
  it('resets pending UTXOs to unspent', async () => {
    mockDb.execute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 1 })

    await rollbackPendingSpend([{ txid: 'tx1', vout: 0 }])
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("spending_status = 'unspent'"),
      expect.arrayContaining(['tx1', 0])
    )
  })
})

// ---------- getPendingUtxos ----------

describe('getPendingUtxos', () => {
  it('returns stuck pending UTXOs past timeout', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, satoshis: 1000, pending_spending_txid: 'pt1', pending_since: 100 }
      ])

    const result = await getPendingUtxos(300000)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ txid: 'tx1', pendingTxid: 'pt1' })
  })

  it('returns empty array when no stuck UTXOs', async () => {
    mockDb.select
      .mockResolvedValueOnce([]) // ensureColumn probe
      .mockResolvedValueOnce([])

    const result = await getPendingUtxos()
    expect(result).toEqual([])
  })
})

// ---------- toggleUtxoFrozen ----------

describe('toggleUtxoFrozen', () => {
  it('sets spendable=0 when frozen=true', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    await toggleUtxoFrozen('tx1', 0, true)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('spendable = $1'),
      expect.arrayContaining([0, 'tx1', 0])
    )
  })

  it('sets spendable=1 when frozen=false', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    await toggleUtxoFrozen('tx1', 0, false)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('spendable = $1'),
      expect.arrayContaining([1, 'tx1', 0])
    )
  })

  it('scopes by accountId when provided', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    await toggleUtxoFrozen('tx1', 0, true, 5)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('account_id = $4')
    expect(call[1]).toContain(5)
  })
})

// ---------- repairUTXOs ----------

describe('repairUTXOs', () => {
  it('returns count of repaired UTXOs', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 3 })

    const fixed = await repairUTXOs()
    expect(fixed).toBe(3)
  })

  it('scopes repair to accountId', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 0 })

    await repairUTXOs(2)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([2])
  })

  it('returns 0 when nothing to repair', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 0 })

    const fixed = await repairUTXOs()
    expect(fixed).toBe(0)
  })
})

// ---------- clearUtxosForAccount ----------

describe('clearUtxosForAccount', () => {
  it('deletes all UTXOs for specified account', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 5 })

    await clearUtxosForAccount(3)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM utxos WHERE account_id = $1',
      [3]
    )
  })
})

// ---------- getAllUTXOs ----------

describe('getAllUTXOs', () => {
  it('returns all UTXOs with tags', async () => {
    mockDb.select
      .mockResolvedValueOnce([
        { id: 1, txid: 'tx1', vout: 0, satoshis: 1000, locking_script: 'ls', address: '1A', basket: 'default', spendable: 1, created_at: 100, spent_at: null, spent_txid: null }
      ])
      .mockResolvedValueOnce([{ tag: 'test' }])

    const result = await getAllUTXOs()
    expect(result).toHaveLength(1)
    expect(result[0]!.tags).toEqual(['test'])
  })

  it('filters by accountId when provided', async () => {
    mockDb.select
      .mockResolvedValueOnce([])

    await getAllUTXOs(2)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([2])
  })

  it('handles UTXOs with null optional fields', async () => {
    mockDb.select
      .mockResolvedValueOnce([
        { id: 1, txid: 'tx1', vout: 0, satoshis: 500, locking_script: 'ls', address: null, basket: 'default', spendable: 0, created_at: 100, spent_at: null, spent_txid: null }
      ])
      .mockResolvedValueOnce([]) // no tags

    const result = await getAllUTXOs()
    expect(result[0]!.address).toBeUndefined()
    expect(result[0]!.spendable).toBe(false)
    expect(result[0]!.tags).toEqual([])
  })
})
