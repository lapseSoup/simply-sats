// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('./connection', () => ({
  getDatabase: vi.fn()
}))

vi.mock('../../services/logger', () => ({
  dbLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { getDatabase } from './connection'
import {
  saveAddress,
  getAddressBook,
  getRecentAddresses,
  updateAddressLabel,
  deleteAddress,
  addressExists,
  ensureAddressBookTable,
} from './addressBookRepository'

const mockDb = {
  select: vi.fn(),
  execute: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDatabase).mockReturnValue(mockDb as never)
  mockDb.select.mockResolvedValue([])
  mockDb.execute.mockResolvedValue({ lastInsertId: 1, rowsAffected: 0 })
})

// ---------- saveAddress ----------

describe('saveAddress', () => {
  it('saves and returns the inserted row ID', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 42, rowsAffected: 1 })

    const result = await saveAddress('1TestAddr', 'My Label', 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(42)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO address_book'),
      expect.arrayContaining(['1TestAddr', 'My Label', expect.any(Number), 1])
    )
  })

  it('returns error when database throws', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('DB write failed'))

    const result = await saveAddress('1TestAddr', 'label', 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('DB write failed')
    expect(result.error.code).toBe('QUERY_FAILED')
  })
})

// ---------- getAddressBook ----------

describe('getAddressBook', () => {
  it('returns entries for the given account', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, address: '1Addr1', label: 'Alice', last_used_at: 1000, use_count: 3, account_id: 5 },
      { id: 2, address: '1Addr2', label: 'Bob', last_used_at: 900, use_count: 1, account_id: 5 },
    ])

    const result = await getAddressBook(5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(2)
    expect(result.value[0]).toMatchObject({
      id: 1,
      address: '1Addr1',
      label: 'Alice',
      lastUsedAt: 1000,
      useCount: 3,
      accountId: 5,
    })
    expect(result.value[1]).toMatchObject({
      address: '1Addr2',
      label: 'Bob',
    })
    // Verify the query includes account_id filter
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining('account_id = $1'),
      [5]
    )
  })

  it('returns error when database throws', async () => {
    mockDb.select.mockRejectedValueOnce(new Error('Select failed'))

    const result = await getAddressBook(1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Select failed')
    expect(result.error.code).toBe('QUERY_FAILED')
  })
})

// ---------- getRecentAddresses ----------

describe('getRecentAddresses', () => {
  it('respects the limit parameter', async () => {
    mockDb.select.mockResolvedValueOnce([
      { id: 1, address: '1Recent', label: 'Recent', last_used_at: 2000, use_count: 5, account_id: 1 },
    ])

    const result = await getRecentAddresses(1, 3)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $2'),
      [1, 3]
    )
  })
})

// ---------- updateAddressLabel ----------

describe('updateAddressLabel', () => {
  it('updates the label for the given address', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    const result = await updateAddressLabel('1Addr1', 'New Label', 1)
    expect(result.ok).toBe(true)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE address_book SET label'),
      ['New Label', '1Addr1', 1]
    )
  })
})

// ---------- deleteAddress ----------

describe('deleteAddress', () => {
  it('deletes the entry for the given address', async () => {
    mockDb.execute.mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 1 })

    const result = await deleteAddress('1Addr1', 1)
    expect(result.ok).toBe(true)
    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM address_book WHERE address = $1 AND account_id = $2',
      ['1Addr1', 1]
    )
  })
})

// ---------- addressExists ----------

describe('addressExists', () => {
  it('returns true when address exists', async () => {
    mockDb.select.mockResolvedValueOnce([{ id: 7 }])

    const result = await addressExists('1ExistingAddr')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(true)
    expect(mockDb.select).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM address_book WHERE address'),
      ['1ExistingAddr']
    )
  })

  it('returns false when address does not exist', async () => {
    mockDb.select.mockResolvedValueOnce([])

    const result = await addressExists('1NonExistentAddr')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe(false)
  })

  it('returns error on database failure (not false)', async () => {
    mockDb.select.mockRejectedValueOnce(new Error('Connection lost'))

    const result = await addressExists('1AnyAddr')
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Must return an error, NOT ok(false)
    expect(result.error.message).toContain('Connection lost')
    expect(result.error.code).toBe('QUERY_FAILED')
  })
})

// ---------- ensureAddressBookTable ----------

describe('ensureAddressBookTable', () => {
  it('creates table and indexes and returns ok', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 0 }) // CREATE TABLE
      .mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 0 }) // CREATE INDEX account
      .mockResolvedValueOnce({ lastInsertId: 0, rowsAffected: 0 }) // CREATE INDEX last_used

    const result = await ensureAddressBookTable()
    expect(result.ok).toBe(true)
    expect(mockDb.execute).toHaveBeenCalledTimes(3)
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS address_book')
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_address_book_account')
    )
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_address_book_last_used')
    )
  })

  it('returns error when table creation fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('Schema error'))

    const result = await ensureAddressBookTable()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('Schema error')
    expect(result.error.code).toBe('QUERY_FAILED')
  })
})
