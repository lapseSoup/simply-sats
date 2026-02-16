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
  addLock,
  addLockIfNotExists,
  getLocks,
  markLockUnlocked,
  markLockUnlockedByTxid,
  updateLockBlock,
  getAllLocks,
} from './lockRepository'

const mockDb = {
  select: vi.fn(),
  execute: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDatabase).mockReturnValue(mockDb as never)
  mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 0 })
  mockDb.select.mockResolvedValue([])
})

const baseLock = {
  utxoId: 10,
  unlockBlock: 900000,
  lockBlock: 850000,
  ordinalOrigin: 'origin_abc',
  createdAt: Date.now(),
}

// ---------- addLock ----------

describe('addLock', () => {
  it('inserts a lock and returns the id', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 7, rowsAffected: 1 })

    const id = await addLock(baseLock, 3)
    expect(id).toBe(7)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO locks'),
      [10, 900000, 850000, 'origin_abc', baseLock.createdAt, 3]
    )
  })

  it('defaults accountId to 1', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 8, rowsAffected: 1 })

    await addLock(baseLock)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[1]![5]).toBe(1)
  })

  it('handles null optional fields', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 9, rowsAffected: 1 })

    const lockNoOptionals = { utxoId: 5, unlockBlock: 900000, createdAt: 100 }
    await addLock(lockNoOptionals, 1)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[1]![2]).toBeNull() // lockBlock
    expect(call[1]![3]).toBeNull() // ordinalOrigin
  })
})

// ---------- addLockIfNotExists ----------

describe('addLockIfNotExists', () => {
  it('returns existing lock id when lock already exists', async () => {
    mockDb.select.mockResolvedValueOnce([{ id: 42 }])

    const id = await addLockIfNotExists(baseLock, 2)
    expect(id).toBe(42)
    expect(mockDb.execute).not.toHaveBeenCalled()
  })

  it('inserts when no existing lock', async () => {
    mockDb.select.mockResolvedValueOnce([]) // no existing
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 15, rowsAffected: 1 })

    const id = await addLockIfNotExists(baseLock, 2)
    expect(id).toBe(15)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO locks'),
      expect.any(Array)
    )
  })

  it('queries by utxo_id for existence check', async () => {
    mockDb.select.mockResolvedValueOnce([{ id: 1 }])

    await addLockIfNotExists(baseLock)
    expect(mockDb.select).toHaveBeenCalledWith(
      'SELECT id FROM locks WHERE utxo_id = $1',
      [10]
    )
  })
})

// ---------- getLocks ----------

describe('getLocks', () => {
  const mockRow = {
    id: 1,
    utxo_id: 10,
    unlock_block: 900000,
    lock_block: 850000,
    ordinal_origin: 'origin_abc',
    created_at: 1000,
    unlocked_at: null,
    account_id: 2,
    txid: 'tx1',
    vout: 0,
    satoshis: 5000,
    locking_script: 'ls1',
    basket: 'locks',
    address: '1Addr',
  }

  it('returns locks with UTXO data', async () => {
    mockDb.select.mockResolvedValueOnce([mockRow])

    const result = await getLocks(910000, 2)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 1,
      utxoId: 10,
      unlockBlock: 900000,
      lockBlock: 850000,
    })
    expect(result[0]!.utxo).toMatchObject({
      txid: 'tx1',
      satoshis: 5000,
      spendable: true, // currentHeight (910000) >= unlockBlock (900000)
    })
  })

  it('marks UTXO as not spendable when height < unlockBlock', async () => {
    mockDb.select.mockResolvedValueOnce([mockRow])

    const result = await getLocks(800000, 2)
    expect(result[0]!.utxo.spendable).toBe(false)
  })

  it('filters by accountId when provided', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getLocks(900000, 5)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('l.account_id = $1')
    expect(call[1]).toEqual([5])
  })

  it('returns all unlocked locks when accountId not provided', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getLocks(900000)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).not.toContain('l.account_id')
    expect(call[1]).toEqual([])
  })

  it('maps null optional fields to undefined', async () => {
    mockDb.select.mockResolvedValueOnce([
      { ...mockRow, lock_block: null, ordinal_origin: null, address: null }
    ])

    const result = await getLocks(910000)
    expect(result[0]!.lockBlock).toBeUndefined()
    expect(result[0]!.ordinalOrigin).toBeUndefined()
    expect(result[0]!.utxo.address).toBeUndefined()
  })

  it('returns empty array when no locks', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await getLocks(900000)
    expect(result).toEqual([])
  })
})

// ---------- markLockUnlocked ----------

describe('markLockUnlocked', () => {
  it('sets unlocked_at by lock id', async () => {
    await markLockUnlocked(5)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'UPDATE locks SET unlocked_at = $1 WHERE id = $2',
      [expect.any(Number), 5]
    )
  })
})

// ---------- markLockUnlockedByTxid ----------

describe('markLockUnlockedByTxid', () => {
  it('unlocks by txid and vout without accountId', async () => {
    await markLockUnlockedByTxid('tx1', 0)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE locks SET unlocked_at'),
      [expect.any(Number), 'tx1', 0]
    )
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).not.toContain('account_id')
  })

  it('scopes by accountId when provided', async () => {
    await markLockUnlockedByTxid('tx1', 0, 3)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('account_id = $4')
    expect(call[1]).toEqual([expect.any(Number), 'tx1', 0, 3])
  })

  it('only unlocks locks that are not already unlocked', async () => {
    await markLockUnlockedByTxid('tx1', 0)
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('unlocked_at IS NULL')
  })
})

// ---------- updateLockBlock ----------

describe('updateLockBlock', () => {
  it('backfills lock_block for null entries', async () => {
    await updateLockBlock('tx1', 0, 850000)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE locks SET lock_block = $1'),
      [850000, 'tx1', 0]
    )
    const call = mockDb.execute.mock.calls[0]!
    expect(call[0]).toContain('lock_block IS NULL')
  })
})

// ---------- getAllLocks ----------

describe('getAllLocks', () => {
  it('returns all locks mapped to domain type', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, utxo_id: 10, unlock_block: 900000, lock_block: 850000, ordinal_origin: 'org1', created_at: 100, unlocked_at: null, account_id: 1 }
    ])

    const result = await getAllLocks()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 1,
      utxoId: 10,
      unlockBlock: 900000,
      lockBlock: 850000,
      ordinalOrigin: 'org1',
    })
  })

  it('filters by accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getAllLocks(4)
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).toContain('account_id = $1')
    expect(call[1]).toEqual([4])
  })

  it('returns all locks when no accountId', async () => {
    mockDb.select.mockResolvedValueOnce([])

    await getAllLocks()
    const call = mockDb.select.mock.calls[0]!
    expect(call[0]).not.toContain('account_id')
  })

  it('maps null fields to undefined', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, utxo_id: 10, unlock_block: 900000, lock_block: null, ordinal_origin: null, created_at: 100, unlocked_at: null, account_id: 1 }
    ])

    const result = await getAllLocks()
    expect(result[0]!.lockBlock).toBeUndefined()
    expect(result[0]!.ordinalOrigin).toBeUndefined()
    expect(result[0]!.unlockedAt).toBeUndefined()
  })
})
