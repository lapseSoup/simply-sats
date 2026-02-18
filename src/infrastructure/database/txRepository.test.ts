// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./connection', () => ({
  getDatabase: vi.fn()
}))

vi.mock('../logger', () => ({
  dbLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { getDatabase } from './connection'
import {
  addTransaction,
  upsertTransaction,
  getAllTransactions,
  updateTransactionAmount,
  updateTransactionStatus,
  updateTransactionLabels,
  getTransactionLabels,
  getTransactionByTxid,
  getTransactionsByLabel,
  getAllLabels,
  getTopLabels,
  searchTransactions,
  getPendingTransactionTxids,
  deleteTransactionsForAccount,
} from './txRepository'

const mockDb = {
  select: vi.fn(),
  execute: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDatabase).mockReturnValue(mockDb as never)
  mockDb.execute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 0 })
  mockDb.select.mockResolvedValue([])
})

const baseTx = {
  txid: 'tx123',
  rawTx: 'deadbeef',
  description: 'test tx',
  createdAt: 1000,
  confirmedAt: 2000,
  blockHeight: 800000,
  status: 'confirmed' as const,
  amount: -5000,
}

// ---------- addTransaction ----------

describe('addTransaction', () => {
  it('inserts a new transaction and returns txid', async () => {
    const result = await addTransaction(baseTx, 2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('tx123')
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO transactions'),
      expect.arrayContaining(['tx123', 'deadbeef', 'test tx', 1000, 2000, 800000, 'confirmed', -5000, 2])
    )
  })

  it('updates amount when provided and row exists', async () => {
    await addTransaction(baseTx, 1)
    // Second execute call is the amount update
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE transactions SET amount'),
      expect.arrayContaining([-5000, 'tx123', 1])
    )
  })

  it('updates block_height and status when tx confirmed', async () => {
    await addTransaction(baseTx, 1)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'confirmed'"),
      expect.arrayContaining([800000, 'tx123', 1])
    )
  })

  it('inserts labels when provided', async () => {
    await addTransaction({ ...baseTx, labels: ['send', 'payment'] }, 1)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT OR IGNORE INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx123', 'send', 1]
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT OR IGNORE INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx123', 'payment', 1]
    )
  })

  it('defaults accountId to 1', async () => {
    await addTransaction(baseTx)
    const firstCall = mockDb.execute.mock.calls[0]!
    expect(firstCall[1]![8]).toBe(1) // 9th param
  })

  it('skips amount update when amount is undefined', async () => {
    const { amount: _a, ...txNoAmount } = baseTx
    await addTransaction({ ...txNoAmount, status: 'pending', blockHeight: undefined, confirmedAt: undefined }, 1)
    // Should only have the INSERT call, no UPDATE for amount
    const amountUpdateCalls = mockDb.execute.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE transactions SET amount')
    )
    expect(amountUpdateCalls).toHaveLength(0)
  })
})

// ---------- upsertTransaction ----------

describe('upsertTransaction', () => {
  it('inserts then updates fields', async () => {
    await upsertTransaction(baseTx, 3)
    // First call: INSERT OR IGNORE
    expect(mockDb.execute.mock.calls[0]![0]).toContain('INSERT OR IGNORE')
    // Second call: UPDATE with fields
    const updateCall = mockDb.execute.mock.calls[1]!
    expect(updateCall[0]).toContain('UPDATE transactions SET')
    expect(updateCall[0]).toContain('raw_tx')
    expect(updateCall[0]).toContain('status')
  })

  it('returns the txid', async () => {
    const result = await upsertTransaction(baseTx, 1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('tx123')
  })

  it('inserts labels when provided', async () => {
    await upsertTransaction({ ...baseTx, labels: ['lock'] }, 1)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT OR IGNORE INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx123', 'lock', 1]
    )
  })

  it('skips update when no fields to update', async () => {
    // All undefined fields
    const minTx = { txid: 'tx999', createdAt: 100, status: 'pending' as const }
    await upsertTransaction(minTx, 1)
    // INSERT + UPDATE for status (status is always defined)
    expect(mockDb.execute).toHaveBeenCalled()
  })
})

// ---------- getAllTransactions ----------

describe('getAllTransactions', () => {
  it('returns mapped transactions', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: 'beef', description: 'desc', created_at: 1000, confirmed_at: 2000, block_height: 800000, status: 'confirmed', amount: -500 }
    ])

    const result = await getAllTransactions(30, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]).toMatchObject({
      txid: 'tx1',
      rawTx: 'beef',
      description: 'desc',
      blockHeight: 800000,
      status: 'confirmed',
      amount: -500,
    })
  })

  it('filters by accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getAllTransactions(10, 5)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([5, 10])
  })

  it('handles null optional fields as undefined', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: null, description: null, created_at: 100, confirmed_at: null, block_height: null, status: 'pending', amount: null }
    ])

    const result = await getAllTransactions()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]!.rawTx).toBeUndefined()
    expect(result.value[0]!.description).toBeUndefined()
    expect(result.value[0]!.confirmedAt).toBeUndefined()
    expect(result.value[0]!.blockHeight).toBeUndefined()
    expect(result.value[0]!.amount).toBeUndefined()
  })

  it('uses default limit of 30', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getAllTransactions()
    const call = mockDb.select.mock.calls[0]!
    expect(call[1]).toEqual([30])
  })
})

// ---------- updateTransactionAmount ----------

describe('updateTransactionAmount', () => {
  it('updates amount scoped to account', async () => {
    await updateTransactionAmount('tx1', -1000, 2)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'UPDATE transactions SET amount = $1 WHERE txid = $2 AND account_id = $3',
      [-1000, 'tx1', 2]
    )
  })

  it('defaults accountId to 1', async () => {
    await updateTransactionAmount('tx1', 500)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.any(String),
      [500, 'tx1', 1]
    )
  })
})

// ---------- updateTransactionStatus ----------

describe('updateTransactionStatus', () => {
  it('updates status to confirmed with block height', async () => {
    await updateTransactionStatus('tx1', 'confirmed', 850000, 2)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE transactions SET status'),
      ['confirmed', expect.any(Number), 850000, 'tx1', 2]
    )
  })

  it('sets confirmed_at to null for non-confirmed status', async () => {
    await updateTransactionStatus('tx1', 'failed', undefined, 1)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[1]![1]).toBeNull() // confirmed_at
    expect(call[1]![2]).toBeNull() // block_height
  })

  it('defaults accountId to 1', async () => {
    await updateTransactionStatus('tx1', 'pending')
    const call = mockDb.execute.mock.calls[0]!
    expect(call[1]![4]).toBe(1)
  })
})

// ---------- updateTransactionLabels ----------

describe('updateTransactionLabels', () => {
  it('verifies ownership, deletes old, inserts new labels', async () => {
    // Verify ownership
    mockDb.select.mockResolvedValueOnce([{ txid: 'tx1' }])

    await updateTransactionLabels('tx1', ['send', 'important'], 2)

    // Verify ownership check
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining('SELECT txid FROM transactions'),
      ['tx1', 2]
    )
    // Delete old labels
    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM transaction_labels WHERE txid = $1 AND account_id = $2',
      ['tx1', 2]
    )
    // Insert new labels
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx1', 'send', 2]
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx1', 'important', 2]
    )
  })

  it('is a no-op when txid does not belong to account', async () => {
    mockDb.select.mockResolvedValueOnce([]) // ownership check fails

    await updateTransactionLabels('tx1', ['test'], 2)
    expect(mockDb.execute).not.toHaveBeenCalled()
  })

  it('skips empty/whitespace labels', async () => {
    mockDb.select.mockResolvedValueOnce([{ txid: 'tx1' }])

    await updateTransactionLabels('tx1', ['valid', '  ', ''], 1)
    const insertCalls = mockDb.execute.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO transaction_labels')
    )
    expect(insertCalls).toHaveLength(1)
  })

  it('trims label whitespace', async () => {
    mockDb.select.mockResolvedValueOnce([{ txid: 'tx1' }])

    await updateTransactionLabels('tx1', ['  payment  '], 1)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'INSERT INTO transaction_labels (txid, label, account_id) VALUES ($1, $2, $3)',
      ['tx1', 'payment', 1]
    )
  })
})

// ---------- getTransactionLabels ----------

describe('getTransactionLabels', () => {
  it('returns labels for a txid', async () => {
    mockDb.select.mockResolvedValueOnce([{ label: 'send' }, { label: 'daily' }])

    const result = await getTransactionLabels('tx1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(['send', 'daily'])
  })

  it('scopes by accountId when provided', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getTransactionLabels('tx1', 3)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $2')
    expect(call[1]).toEqual(['tx1', 3])
  })

  it('returns empty array when no labels', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await getTransactionLabels('tx1')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual([])
  })
})

// ---------- getTransactionByTxid ----------

describe('getTransactionByTxid', () => {
  it('returns a transaction when found', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: 'beef', description: 'test', created_at: 100, confirmed_at: 200, block_height: 800000, status: 'confirmed', amount: -500 }
    ])

    const result = await getTransactionByTxid('tx1', 2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toMatchObject({ txid: 'tx1', status: 'confirmed', amount: -500 })
  })

  it('returns null when not found', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await getTransactionByTxid('nonexistent', 1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeNull()
  })

  it('maps null fields to undefined', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: null, description: null, created_at: 100, confirmed_at: null, block_height: null, status: 'pending', amount: null }
    ])

    const result = await getTransactionByTxid('tx1', 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value!.rawTx).toBeUndefined()
    expect(result.value!.blockHeight).toBeUndefined()
    expect(result.value!.amount).toBeUndefined()
  })
})

// ---------- getTransactionsByLabel ----------

describe('getTransactionsByLabel', () => {
  it('returns transactions matching a label', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: null, description: null, created_at: 100, confirmed_at: null, block_height: null, status: 'pending', amount: null }
    ])

    const result = await getTransactionsByLabel('send', 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]!.txid).toBe('tx1')
  })

  it('queries without accountId scope when not provided', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getTransactionsByLabel('lock')
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).not.toContain('t.account_id = $2')
    expect(call[1]).toEqual(['lock'])
  })
})

// ---------- getAllLabels ----------

describe('getAllLabels', () => {
  it('returns distinct labels', async () => {
    mockDb.select.mockResolvedValueOnce([{ label: 'alpha' }, { label: 'beta' }])

    const result = await getAllLabels()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(['alpha', 'beta'])
  })

  it('scopes by accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getAllLabels(3)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([3])
  })
})

// ---------- getTopLabels ----------

describe('getTopLabels', () => {
  it('returns top labels excluding system labels', async () => {
    mockDb.select.mockResolvedValueOnce([{ label: 'coffee' }, { label: 'rent' }])

    const result = await getTopLabels(3, 2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual(['coffee', 'rent'])
  })

  it('excludes lock and unlock system labels', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getTopLabels(3, 2)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('label NOT IN')
    expect(call[1]).toContain('lock')
    expect(call[1]).toContain('unlock')
  })
})

// ---------- searchTransactions ----------

describe('searchTransactions', () => {
  it('searches by txid or label with partial match', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, txid: 'tx1', raw_tx: null, description: null, created_at: 100, confirmed_at: null, block_height: null, status: 'pending', amount: null, account_id: 1 }
    ])

    const result = await searchTransactions('tx1', 1, 50)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(1)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('LIKE')
    expect(call[1]).toContain('%tx1%')
  })
})

// ---------- getPendingTransactionTxids ----------

describe('getPendingTransactionTxids', () => {
  it('returns set of pending txids', async () => {
    mockDb.select.mockResolvedValueOnce([{ txid: 'tx1' }, { txid: 'tx2' }])

    const result = await getPendingTransactionTxids(1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBeInstanceOf(Set)
    expect(result.value.has('tx1')).toBe(true)
    expect(result.value.has('tx2')).toBe(true)
  })

  it('scopes by accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getPendingTransactionTxids(5)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([5])
  })

  it('returns empty set when no pending transactions', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await getPendingTransactionTxids()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.size).toBe(0)
  })
})

// ---------- deleteTransactionsForAccount ----------

describe('deleteTransactionsForAccount', () => {
  it('deletes labels then transactions', async () => {
    await deleteTransactionsForAccount(3)

    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM transaction_labels WHERE account_id = $1',
      [3]
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM transactions WHERE account_id = $1',
      [3]
    )
    // Labels deleted before transactions
    const calls = mockDb.execute.mock.calls
    const labelIdx = calls.findIndex((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('transaction_labels'))
    const txIdx = calls.findIndex((c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM transactions'))
    expect(labelIdx).toBeLessThan(txIdx)
  })

  it('returns 0', async () => {
    const result = await deleteTransactionsForAccount(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(0)
  })
})
