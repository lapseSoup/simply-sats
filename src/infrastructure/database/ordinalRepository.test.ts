// @vitest-environment node
/**
 * Tests for getBatchOrdinalContent in Ordinal Cache Repository
 *
 * Verifies chunked batch loading of ordinal content from the database,
 * including edge cases around chunk boundaries, content filtering, and errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------- Mocks ----------

vi.mock('./connection', () => ({
  getDatabase: vi.fn()
}))

vi.mock('../../services/logger', () => ({
  dbLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { getDatabase } from './connection'
import { getBatchOrdinalContent } from './ordinalRepository'

// ---------- Mock DB ----------

const mockDb = {
  select: vi.fn(),
  execute: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDatabase).mockReturnValue(mockDb as never)
  mockDb.select.mockResolvedValue([])
  mockDb.execute.mockResolvedValue({ lastInsertId: 0, rowsAffected: 0 })
})

// ---------- Helpers ----------

/** Generate an array of fake origin strings */
function makeOrigins(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `txid${i}_0`)
}

/** Build a DB row matching the shape returned by the SELECT in getBatchOrdinalContent */
function makeRow(
  origin: string,
  opts: {
    contentData?: string | null   // JSON number-array string, e.g. "[137,80]"
    contentText?: string | null
    contentType?: string | null
  } = {}
) {
  return {
    origin,
    content_data: opts.contentData ?? null,
    content_text: opts.contentText ?? null,
    content_type: opts.contentType ?? null
  }
}

// ---------- getBatchOrdinalContent ----------

describe('getBatchOrdinalContent', () => {
  it('returns empty Map for empty origins array', async () => {
    const result = await getBatchOrdinalContent([])

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    // Should never call the database
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it('handles origins array smaller than chunk size (5 items)', async () => {
    const origins = makeOrigins(5)
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid0_0', { contentData: '[1,2,3]', contentType: 'image/png' }),
      makeRow('txid2_0', { contentText: '{"hello":"world"}', contentType: 'application/json' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(2)
    expect(result.has('txid0_0')).toBe(true)
    expect(result.has('txid2_0')).toBe(true)

    // Verify contentData was parsed from JSON string to Uint8Array
    const entry0 = result.get('txid0_0')!
    expect(entry0.contentData).toBeInstanceOf(Uint8Array)
    expect(Array.from(entry0.contentData!)).toEqual([1, 2, 3])
    expect(entry0.contentType).toBe('image/png')

    // Verify text-only entry
    const entry2 = result.get('txid2_0')!
    expect(entry2.contentText).toBe('{"hello":"world"}')
    expect(entry2.contentData).toBeUndefined()
    expect(entry2.contentType).toBe('application/json')

    // Only one DB call (all fit in one chunk)
    expect(mockDb.select).toHaveBeenCalledTimes(1)
    // Verify the SQL uses the correct number of placeholders
    const sql = mockDb.select.mock.calls[0]![0] as string
    expect(sql).toContain('$1')
    expect(sql).toContain('$5')
    expect(sql).not.toContain('$6')
  })

  it('handles origins array at exact chunk boundary (200 items)', async () => {
    const origins = makeOrigins(200)
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid0_0', { contentText: 'test' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(1)
    // Exactly one chunk — one DB call
    expect(mockDb.select).toHaveBeenCalledTimes(1)
    // All 200 placeholders
    const sql = mockDb.select.mock.calls[0]![0] as string
    expect(sql).toContain('$200')
    expect(sql).not.toContain('$201')
  })

  it('handles origins array exceeding chunk size (201 items — two chunks)', async () => {
    const origins = makeOrigins(201)

    // First chunk (200 origins) returns one row
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid50_0', { contentData: '[10,20]', contentType: 'image/jpeg' })
    ])
    // Second chunk (1 origin) returns one row
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid200_0', { contentText: 'hello', contentType: 'text/plain' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(2)
    expect(result.has('txid50_0')).toBe(true)
    expect(result.has('txid200_0')).toBe(true)

    // Two DB calls — one per chunk
    expect(mockDb.select).toHaveBeenCalledTimes(2)

    // First call: 200 placeholders
    const sql1 = mockDb.select.mock.calls[0]![0] as string
    expect(sql1).toContain('$200')
    expect(sql1).not.toContain('$201')

    // Second call: 1 placeholder
    const sql2 = mockDb.select.mock.calls[1]![0] as string
    expect(sql2).toContain('$1')
    expect(sql2).not.toContain('$2')

    // Second call params should be the 201st origin
    const params2 = mockDb.select.mock.calls[1]![1] as string[]
    expect(params2).toEqual(['txid200_0'])
  })

  it('includes rows with content_data but no content_text', async () => {
    const origins = ['origin_a_0']
    mockDb.select.mockResolvedValueOnce([
      makeRow('origin_a_0', { contentData: '[255,0,128]', contentType: 'image/png' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(1)
    const entry = result.get('origin_a_0')!
    expect(entry.contentData).toBeInstanceOf(Uint8Array)
    expect(Array.from(entry.contentData!)).toEqual([255, 0, 128])
    expect(entry.contentText).toBeUndefined()
    expect(entry.contentType).toBe('image/png')
  })

  it('includes rows with content_text but no content_data', async () => {
    const origins = ['origin_b_0']
    mockDb.select.mockResolvedValueOnce([
      makeRow('origin_b_0', { contentText: 'some inscription text', contentType: 'text/plain' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(1)
    const entry = result.get('origin_b_0')!
    expect(entry.contentData).toBeUndefined()
    expect(entry.contentText).toBe('some inscription text')
    expect(entry.contentType).toBe('text/plain')
  })

  it('excludes rows with neither content_data nor content_text', async () => {
    const origins = ['origin_c_0', 'origin_d_0']
    mockDb.select.mockResolvedValueOnce([
      // Row with no content at all — should be excluded
      makeRow('origin_c_0', { contentData: null, contentText: null, contentType: 'image/png' }),
      // Row with content — should be included
      makeRow('origin_d_0', { contentText: 'has text', contentType: 'text/plain' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(1)
    expect(result.has('origin_c_0')).toBe(false)
    expect(result.has('origin_d_0')).toBe(true)
  })

  it('excludes rows where content_data fails to parse (invalid JSON string)', async () => {
    const origins = ['origin_e_0']
    mockDb.select.mockResolvedValueOnce([
      // content_data is a string but not valid JSON — parseContentData returns undefined
      makeRow('origin_e_0', { contentData: 'not-valid-json', contentText: null })
    ])

    const result = await getBatchOrdinalContent(origins)

    // Neither contentData (parse failed) nor contentText — excluded
    expect(result.size).toBe(0)
  })

  it('returns empty Map and logs warning on database error', async () => {
    const { dbLogger } = await import('../../services/logger')
    const origins = makeOrigins(3)
    mockDb.select.mockRejectedValueOnce(new Error('SQLITE_BUSY'))

    const result = await getBatchOrdinalContent(origins)

    expect(result).toBeInstanceOf(Map)
    expect(result.size).toBe(0)
    expect(dbLogger.warn).toHaveBeenCalledWith(
      'getBatchOrdinalContent failed',
      expect.objectContaining({
        error: expect.stringContaining('SQLITE_BUSY'),
        originCount: 3
      })
    )
  })

  it('handles large arrays requiring multiple chunks (450 items — 3 chunks)', async () => {
    const origins = makeOrigins(450)

    // Chunk 1 (200 origins)
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid0_0', { contentText: 'chunk1' })
    ])
    // Chunk 2 (200 origins)
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid250_0', { contentData: '[1]', contentType: 'image/gif' })
    ])
    // Chunk 3 (50 origins)
    mockDb.select.mockResolvedValueOnce([
      makeRow('txid400_0', { contentText: 'chunk3', contentType: 'text/html' })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(3)
    expect(mockDb.select).toHaveBeenCalledTimes(3)

    // Verify third chunk has 50 placeholders
    const sql3 = mockDb.select.mock.calls[2]![0] as string
    expect(sql3).toContain('$50')
    expect(sql3).not.toContain('$51')
  })

  it('converts null content_type to undefined in result entries', async () => {
    const origins = ['origin_f_0']
    mockDb.select.mockResolvedValueOnce([
      makeRow('origin_f_0', { contentText: 'text here', contentType: null })
    ])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(1)
    const entry = result.get('origin_f_0')!
    expect(entry.contentType).toBeUndefined()
    expect(entry.contentText).toBe('text here')
  })

  it('handles DB returning no matching rows for requested origins', async () => {
    const origins = makeOrigins(10)
    mockDb.select.mockResolvedValueOnce([])

    const result = await getBatchOrdinalContent(origins)

    expect(result.size).toBe(0)
    expect(mockDb.select).toHaveBeenCalledTimes(1)
  })
})
