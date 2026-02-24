// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject, Dispatch, SetStateAction } from 'react'

vi.mock('../services/ordinalCache', () => ({
  upsertOrdinalCache: vi.fn(),
  batchUpsertOrdinalCache: vi.fn(),
  markOrdinalTransferred: vi.fn(),
  getCachedOrdinalContent: vi.fn(),
  upsertOrdinalContent: vi.fn(),
  hasOrdinalContent: vi.fn(),
  getCachedOrdinals: vi.fn(),
  ensureOrdinalCacheRowForTransferred: vi.fn(),
}))
vi.mock('../services/wallet/ordinalContent', () => ({
  fetchOrdinalContent: vi.fn(),
}))
vi.mock('../services/logger', () => ({
  syncLogger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}))

import { cacheOrdinalsInBackground, useOrdinalCache } from './useOrdinalCache'
import {
  upsertOrdinalCache,
  batchUpsertOrdinalCache,
  markOrdinalTransferred,
  hasOrdinalContent,
  getCachedOrdinals,
  getCachedOrdinalContent,
  upsertOrdinalContent,
  ensureOrdinalCacheRowForTransferred,
} from '../services/ordinalCache'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import type { Ordinal } from '../services/wallet'
import type { OrdinalContentEntry } from '../contexts/SyncContext'

const mockedUpsertOrdinalCache = vi.mocked(upsertOrdinalCache)
const mockedBatchUpsertOrdinalCache = vi.mocked(batchUpsertOrdinalCache)
const mockedMarkOrdinalTransferred = vi.mocked(markOrdinalTransferred)
const mockedHasOrdinalContent = vi.mocked(hasOrdinalContent)
const mockedGetCachedOrdinals = vi.mocked(getCachedOrdinals)
const mockedGetCachedOrdinalContent = vi.mocked(getCachedOrdinalContent)
const mockedFetchOrdinalContent = vi.mocked(fetchOrdinalContent)
const mockedUpsertOrdinalContent = vi.mocked(upsertOrdinalContent)
const mockedEnsureOrdinalCacheRowForTransferred = vi.mocked(ensureOrdinalCacheRowForTransferred)

function makeOrdinal(overrides: Partial<Ordinal> = {}): Ordinal {
  return {
    origin: 'origin-1',
    txid: 'txid-1',
    vout: 0,
    satoshis: 1,
    contentType: 'image/png',
    content: 'hash-1',
    blockHeight: 800000,
    ...overrides,
  }
}

function makeContentCacheRef(): MutableRefObject<Map<string, OrdinalContentEntry>> {
  return { current: new Map() }
}

describe('cacheOrdinalsInBackground', () => {
  let contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
  let setOrdinalContentCacheMock: ReturnType<typeof vi.fn>
  let setOrdinalContentCache: Dispatch<SetStateAction<Map<string, OrdinalContentEntry>>>

  beforeEach(() => {
    vi.clearAllMocks()
    contentCacheRef = makeContentCacheRef()
    setOrdinalContentCacheMock = vi.fn()
    setOrdinalContentCache = setOrdinalContentCacheMock as Dispatch<SetStateAction<Map<string, OrdinalContentEntry>>>
    // Default mocks — no content in DB, no cached ordinals
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedGetCachedOrdinals.mockResolvedValue([])
    mockedFetchOrdinalContent.mockResolvedValue(null)
    mockedUpsertOrdinalCache.mockResolvedValue(undefined as never)
    mockedBatchUpsertOrdinalCache.mockResolvedValue(undefined as never)
    mockedMarkOrdinalTransferred.mockResolvedValue(undefined as never)
    mockedUpsertOrdinalContent.mockResolvedValue(undefined as never)
  })

  it('returns early if activeAccountId is null', async () => {
    const ordinals = [makeOrdinal()]
    await cacheOrdinalsInBackground(ordinals, null, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedBatchUpsertOrdinalCache).not.toHaveBeenCalled()
  })

  it('returns early if activeAccountId is 0 (falsy)', async () => {
    const ordinals = [makeOrdinal()]
    await cacheOrdinalsInBackground(ordinals, 0 as never, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedBatchUpsertOrdinalCache).not.toHaveBeenCalled()
  })

  it('calls batchUpsertOrdinalCache with all ordinals', async () => {
    const ordinals = [
      makeOrdinal({ origin: 'a', txid: 'tx-a' }),
      makeOrdinal({ origin: 'b', txid: 'tx-b' }),
      makeOrdinal({ origin: 'c', txid: 'tx-c' }),
    ]

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedBatchUpsertOrdinalCache).toHaveBeenCalledTimes(1)
    // Verify the batch call shape
    const batchArg = mockedBatchUpsertOrdinalCache.mock.calls[0]?.[0]
    expect(batchArg).toBeDefined()
    expect(batchArg).toHaveLength(3)
    expect(batchArg?.[0]?.origin).toBe('a')
    expect(batchArg?.[0]?.txid).toBe('tx-a')
    expect(batchArg?.[0]?.accountId).toBe(1)
    expect(batchArg?.[1]?.origin).toBe('b')
    expect(batchArg?.[2]?.origin).toBe('c')
  })

  it('marks transferred ordinals when all API calls succeeded', async () => {
    const currentOrdinals = [makeOrdinal({ origin: 'still-owned' })]

    // Simulate a cached row that is no longer in the current ordinals list
    mockedGetCachedOrdinals.mockResolvedValue([
      { origin: 'still-owned', txid: 'tx-1', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 100 },
      { origin: 'transferred-away', txid: 'tx-2', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 200 },
    ] as never)

    await cacheOrdinalsInBackground(currentOrdinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedMarkOrdinalTransferred).toHaveBeenCalledTimes(1)
    expect(mockedMarkOrdinalTransferred).toHaveBeenCalledWith('transferred-away')
  })

  it('does NOT mark transferred ordinals when some API calls failed', async () => {
    const currentOrdinals = [makeOrdinal({ origin: 'partial' })]

    mockedGetCachedOrdinals.mockResolvedValue([
      { origin: 'partial', txid: 'tx-1', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 100 },
      { origin: 'should-not-mark', txid: 'tx-2', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 200 },
    ] as never)

    await cacheOrdinalsInBackground(currentOrdinals, 1, contentCacheRef, setOrdinalContentCache, () => false, false)

    expect(mockedMarkOrdinalTransferred).not.toHaveBeenCalled()
    expect(mockedGetCachedOrdinals).not.toHaveBeenCalled()
  })

  it('respects isCancelled before the metadata caching phase', async () => {
    // Cancel immediately on first check (before batch upsert)
    const isCancelled = () => true

    const ordinals = [
      makeOrdinal({ origin: 'a' }),
      makeOrdinal({ origin: 'b' }),
      makeOrdinal({ origin: 'c' }),
    ]

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, isCancelled, true)

    // Batch upsert should not be called since isCancelled returned true
    expect(mockedBatchUpsertOrdinalCache).not.toHaveBeenCalled()
  })

  it('respects isCancelled before the transfer marking phase', async () => {
    const ordinals = [makeOrdinal({ origin: 'a' })]
    let checkCount = 0
    const isCancelled = () => {
      checkCount++
      // First check (before batch upsert): false,
      // second check (before transfer marking): true
      return checkCount >= 2
    }

    mockedGetCachedOrdinals.mockResolvedValue([
      { origin: 'transferred', txid: 'tx-2', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 200 },
    ] as never)

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, isCancelled, true)

    // Transfer marking should not happen because isCancelled returned true before it
    expect(mockedGetCachedOrdinals).not.toHaveBeenCalled()
  })

  it('fetches content for up to 10 ordinals missing from cache', async () => {
    // Create 15 ordinals, none in contentCacheRef, none in DB
    const ordinals = Array.from({ length: 15 }, (_, i) =>
      makeOrdinal({ origin: `origin-${i}`, txid: `txid-${i}` })
    )

    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([1, 2, 3]),
      contentText: undefined,
      contentType: 'image/png',
    })

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    // Should fetch at most 10
    expect(mockedFetchOrdinalContent).toHaveBeenCalledTimes(10)
  })

  it('skips content fetch for ordinals already in contentCacheRef', async () => {
    const ordinals = [
      makeOrdinal({ origin: 'cached-in-memory' }),
      makeOrdinal({ origin: 'not-cached' }),
    ]

    // Pre-populate contentCacheRef with the first ordinal
    contentCacheRef.current.set('cached-in-memory', { contentText: 'hello' })
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([1]),
      contentText: undefined,
      contentType: 'image/png',
    })

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    // hasOrdinalContent should only be called for 'not-cached' (skips 'cached-in-memory')
    expect(mockedHasOrdinalContent).toHaveBeenCalledTimes(1)
    expect(mockedHasOrdinalContent).toHaveBeenCalledWith('not-cached')
    expect(mockedFetchOrdinalContent).toHaveBeenCalledTimes(1)
  })

  it('skips content fetch for ordinals already in DB', async () => {
    const ordinals = [
      makeOrdinal({ origin: 'in-db' }),
      makeOrdinal({ origin: 'not-in-db' }),
    ]

    mockedHasOrdinalContent
      .mockResolvedValueOnce(true)   // 'in-db' has content in DB
      .mockResolvedValueOnce(false)  // 'not-in-db' does not

    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([1]),
      contentText: undefined,
      contentType: 'image/png',
    })

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    // Only fetches for 'not-in-db'
    expect(mockedFetchOrdinalContent).toHaveBeenCalledTimes(1)
    expect(mockedFetchOrdinalContent).toHaveBeenCalledWith('not-in-db', 'image/png')
  })

  it('updates contentCacheRef and calls setOrdinalContentCache when content is fetched', async () => {
    const ordinals = [makeOrdinal({ origin: 'fetch-me' })]

    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([42]),
      contentText: 'test',
      contentType: 'text/plain',
    })

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    // Content should be saved in contentCacheRef
    expect(contentCacheRef.current.has('fetch-me')).toBe(true)
    expect(contentCacheRef.current.get('fetch-me')?.contentText).toBe('test')

    // upsertOrdinalContent should be called with the content
    expect(mockedUpsertOrdinalContent).toHaveBeenCalledWith('fetch-me', new Uint8Array([42]), 'test', 'text/plain')

    // setOrdinalContentCache should be called to trigger re-render
    expect(setOrdinalContentCache).toHaveBeenCalledTimes(1)
    const newMap = setOrdinalContentCacheMock.mock.calls[0]![0] as Map<string, OrdinalContentEntry>
    expect(newMap).toBeInstanceOf(Map)
    expect(newMap.has('fetch-me')).toBe(true)
  })

  it('does not call setOrdinalContentCache when no content was fetched', async () => {
    const ordinals = [makeOrdinal({ origin: 'no-content' })]

    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue(null) // API returns nothing

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(setOrdinalContentCache).not.toHaveBeenCalled()
  })

  it('does not throw when an internal operation fails (outer catch)', async () => {
    const ordinals = [makeOrdinal()]
    mockedBatchUpsertOrdinalCache.mockRejectedValue(new Error('DB write failed'))

    // Should not throw — the outer try/catch should swallow
    await expect(
      cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)
    ).resolves.toBeUndefined()
  })
})

describe('useOrdinalCache — fetchOrdinalContentIfMissing', () => {
  let contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>>
  let setOrdinalContentCacheMock: ReturnType<typeof vi.fn>
  let setOrdinalContentCache: Dispatch<SetStateAction<Map<string, OrdinalContentEntry>>>

  beforeEach(() => {
    vi.clearAllMocks()
    contentCacheRef = makeContentCacheRef()
    setOrdinalContentCacheMock = vi.fn()
    setOrdinalContentCache = setOrdinalContentCacheMock as Dispatch<SetStateAction<Map<string, OrdinalContentEntry>>>
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedGetCachedOrdinalContent.mockResolvedValue(null)
    mockedFetchOrdinalContent.mockResolvedValue(null)
    mockedUpsertOrdinalContent.mockResolvedValue(undefined as never)
    mockedEnsureOrdinalCacheRowForTransferred.mockResolvedValue(undefined as never)
  })

  it('returns immediately when origin is already in memory cache', async () => {
    contentCacheRef.current.set('origin-1', { contentText: 'already cached' })
    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('origin-1')
    })

    // Should not even check DB
    expect(mockedHasOrdinalContent).not.toHaveBeenCalled()
    expect(mockedFetchOrdinalContent).not.toHaveBeenCalled()
  })

  it('loads content from DB when it exists there (DB-first path)', async () => {
    mockedHasOrdinalContent.mockResolvedValue(true)
    mockedGetCachedOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([1, 2, 3]),
      contentText: 'from-db',
      contentType: 'text/plain',
    })

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('db-origin')
    })

    // Should NOT fetch from API
    expect(mockedFetchOrdinalContent).not.toHaveBeenCalled()
    // Should update in-memory cache
    expect(contentCacheRef.current.has('db-origin')).toBe(true)
    expect(contentCacheRef.current.get('db-origin')?.contentText).toBe('from-db')
    // Should trigger re-render
    expect(setOrdinalContentCacheMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT update cache when DB returns empty content (no contentData/contentText)', async () => {
    mockedHasOrdinalContent.mockResolvedValue(true)
    mockedGetCachedOrdinalContent.mockResolvedValue({
      contentData: undefined,
      contentText: undefined,
    })

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('empty-origin')
    })

    // Should not update cache since content is empty
    expect(contentCacheRef.current.has('empty-origin')).toBe(false)
    expect(setOrdinalContentCacheMock).not.toHaveBeenCalled()
  })

  it('fetches from API when content is not in DB', async () => {
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([42]),
      contentText: 'api-text',
      contentType: 'text/html',
    })

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('api-origin', 'text/html', 1)
    })

    expect(mockedFetchOrdinalContent).toHaveBeenCalledWith('api-origin', 'text/html')
    expect(mockedEnsureOrdinalCacheRowForTransferred).toHaveBeenCalledWith('api-origin', 1)
    expect(mockedUpsertOrdinalContent).toHaveBeenCalledWith('api-origin', new Uint8Array([42]), 'api-text', 'text/html')
    expect(contentCacheRef.current.has('api-origin')).toBe(true)
    expect(setOrdinalContentCacheMock).toHaveBeenCalledTimes(1)
  })

  it('does not crash when API returns null', async () => {
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue(null)

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('no-content', 'image/png')
    })

    expect(mockedUpsertOrdinalContent).not.toHaveBeenCalled()
    expect(contentCacheRef.current.has('no-content')).toBe(false)
    expect(setOrdinalContentCacheMock).not.toHaveBeenCalled()
  })

  it('does not crash when API throws an error', async () => {
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockRejectedValue(new Error('Network timeout'))

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    // Should not throw
    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('fail-origin')
    })

    expect(contentCacheRef.current.has('fail-origin')).toBe(false)
    expect(setOrdinalContentCacheMock).not.toHaveBeenCalled()
  })

  it('does not crash when hasOrdinalContent throws', async () => {
    mockedHasOrdinalContent.mockRejectedValue(new Error('DB read error'))

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('db-error-origin')
    })

    expect(contentCacheRef.current.has('db-error-origin')).toBe(false)
  })

  it('does not crash when getCachedOrdinalContent returns null', async () => {
    mockedHasOrdinalContent.mockResolvedValue(true)
    mockedGetCachedOrdinalContent.mockResolvedValue(null)

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('null-content-origin')
    })

    // Should not update cache
    expect(contentCacheRef.current.has('null-content-origin')).toBe(false)
    expect(setOrdinalContentCacheMock).not.toHaveBeenCalled()
  })

  it('passes contentType to fetchOrdinalContent when provided', async () => {
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue(null)

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('typed-origin', 'application/json')
    })

    expect(mockedFetchOrdinalContent).toHaveBeenCalledWith('typed-origin', 'application/json')
  })

  it('ensures cache row for transferred ordinals with correct accountId', async () => {
    mockedHasOrdinalContent.mockResolvedValue(false)
    mockedFetchOrdinalContent.mockResolvedValue({
      contentData: new Uint8Array([1]),
      contentText: undefined,
      contentType: 'image/png',
    })

    const { result } = renderHook(() => useOrdinalCache({ contentCacheRef, setOrdinalContentCache }))

    await act(async () => {
      await result.current.fetchOrdinalContentIfMissing('transferred-origin', 'image/png', 42)
    })

    expect(mockedEnsureOrdinalCacheRowForTransferred).toHaveBeenCalledWith('transferred-origin', 42)
  })
})
