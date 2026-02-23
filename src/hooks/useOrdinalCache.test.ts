// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from 'vitest'
import type { MutableRefObject, Dispatch, SetStateAction } from 'react'

vi.mock('../services/ordinalCache', () => ({
  upsertOrdinalCache: vi.fn(),
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

import { cacheOrdinalsInBackground } from './useOrdinalCache'
import {
  upsertOrdinalCache,
  markOrdinalTransferred,
  hasOrdinalContent,
  getCachedOrdinals,
  upsertOrdinalContent,
} from '../services/ordinalCache'
import { fetchOrdinalContent } from '../services/wallet/ordinalContent'
import type { Ordinal } from '../services/wallet'
import type { OrdinalContentEntry } from '../contexts/SyncContext'

const mockedUpsertOrdinalCache = vi.mocked(upsertOrdinalCache)
const mockedMarkOrdinalTransferred = vi.mocked(markOrdinalTransferred)
const mockedHasOrdinalContent = vi.mocked(hasOrdinalContent)
const mockedGetCachedOrdinals = vi.mocked(getCachedOrdinals)
const mockedFetchOrdinalContent = vi.mocked(fetchOrdinalContent)
const mockedUpsertOrdinalContent = vi.mocked(upsertOrdinalContent)

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
    mockedMarkOrdinalTransferred.mockResolvedValue(undefined as never)
    mockedUpsertOrdinalContent.mockResolvedValue(undefined as never)
  })

  it('returns early if activeAccountId is null', async () => {
    const ordinals = [makeOrdinal()]
    await cacheOrdinalsInBackground(ordinals, null, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedUpsertOrdinalCache).not.toHaveBeenCalled()
  })

  it('returns early if activeAccountId is 0 (falsy)', async () => {
    const ordinals = [makeOrdinal()]
    await cacheOrdinalsInBackground(ordinals, 0 as never, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedUpsertOrdinalCache).not.toHaveBeenCalled()
  })

  it('calls upsertOrdinalCache for each ordinal', async () => {
    const ordinals = [
      makeOrdinal({ origin: 'a', txid: 'tx-a' }),
      makeOrdinal({ origin: 'b', txid: 'tx-b' }),
      makeOrdinal({ origin: 'c', txid: 'tx-c' }),
    ]

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)

    expect(mockedUpsertOrdinalCache).toHaveBeenCalledTimes(3)
    // Verify the first call shape
    const firstCall = mockedUpsertOrdinalCache.mock.calls[0]![0]
    expect(firstCall.origin).toBe('a')
    expect(firstCall.txid).toBe('tx-a')
    expect(firstCall.accountId).toBe(1)
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

  it('respects isCancelled at the metadata caching phase', async () => {
    let callCount = 0
    const isCancelled = () => {
      callCount++
      // Cancel after first ordinal is cached (2nd check: before 2nd ordinal iteration)
      return callCount > 2
    }

    const ordinals = [
      makeOrdinal({ origin: 'a' }),
      makeOrdinal({ origin: 'b' }),
      makeOrdinal({ origin: 'c' }),
    ]

    await cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, isCancelled, true)

    // Should have cached the first ordinal but then isCancelled returns true
    expect(mockedUpsertOrdinalCache.mock.calls.length).toBeLessThan(3)
  })

  it('respects isCancelled before the transfer marking phase', async () => {
    const ordinals = [makeOrdinal({ origin: 'a' })]
    let checkCount = 0
    const isCancelled = () => {
      checkCount++
      // First check (before loop): false, loop iteration checks: false,
      // after loop / before transfer phase: true
      return checkCount >= 3
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
    mockedUpsertOrdinalCache.mockRejectedValue(new Error('DB write failed'))

    // Should not throw — the outer try/catch should swallow
    await expect(
      cacheOrdinalsInBackground(ordinals, 1, contentCacheRef, setOrdinalContentCache, () => false, true)
    ).resolves.toBeUndefined()
  })
})
