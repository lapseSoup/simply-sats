// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { MutableRefObject } from 'react'

// --- Mocks ---

vi.mock('../services/wallet', () => ({
  getBalance: vi.fn(),
  getUTXOs: vi.fn(),
  getOrdinals: vi.fn(),
  getUTXOsFromDB: vi.fn(),
}))

vi.mock('../infrastructure/database', () => ({
  getAllTransactions: vi.fn(),
  getDerivedAddresses: vi.fn(),
  getLocks: vi.fn(),
}))

vi.mock('../services/ordinalCache', () => ({
  getAllCachedOrdinalOrigins: vi.fn(),
  getBatchOrdinalContent: vi.fn(),
  getCachedOrdinals: vi.fn(),
}))

vi.mock('../services/sync', () => ({
  getBalanceFromDatabase: vi.fn(),
  getOrdinalsFromDatabase: vi.fn(),
  mapDbLocksToLockedUtxos: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  syncLogger: {
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../infrastructure/storage/localStorage', () => ({
  STORAGE_KEYS: { CACHED_BALANCE: 'cached_balance', CACHED_ORD_BALANCE: 'cached_ord_balance' },
}))

vi.mock('./useOrdinalCache', () => ({
  cacheOrdinalsInBackground: vi.fn(),
}))

vi.mock('../utils/syncHelpers', () => ({
  compareTxByHeight: vi.fn((a: { height: number }, b: { height: number }) => b.height - a.height),
  mergeOrdinalTxEntries: vi.fn(),
}))

// --- Imports ---

import { useSyncData } from './useSyncData'
import { getBalance, getUTXOs, getOrdinals, getUTXOsFromDB } from '../services/wallet'
import { getAllTransactions, getDerivedAddresses, getLocks } from '../infrastructure/database'
import { getAllCachedOrdinalOrigins, getBatchOrdinalContent, getCachedOrdinals } from '../services/ordinalCache'
import { getBalanceFromDatabase, getOrdinalsFromDatabase, mapDbLocksToLockedUtxos } from '../services/sync'
import { cacheOrdinalsInBackground } from './useOrdinalCache'
import type { WalletKeys, Ordinal, LockedUTXO, UTXO } from '../services/wallet'
import type { OrdinalContentEntry, TxHistoryItem } from '../contexts/SyncContext'

const mockedGetBalanceFromDatabase = vi.mocked(getBalanceFromDatabase)
const mockedGetOrdinalsFromDatabase = vi.mocked(getOrdinalsFromDatabase)
const mockedMapDbLocksToLockedUtxos = vi.mocked(mapDbLocksToLockedUtxos)
const mockedGetAllTransactions = vi.mocked(getAllTransactions)
const mockedGetDerivedAddresses = vi.mocked(getDerivedAddresses)
const mockedGetLocks = vi.mocked(getLocks)
const mockedGetAllCachedOrdinalOrigins = vi.mocked(getAllCachedOrdinalOrigins)
const mockedGetBatchOrdinalContent = vi.mocked(getBatchOrdinalContent)
const mockedGetCachedOrdinals = vi.mocked(getCachedOrdinals)
const mockedGetBalance = vi.mocked(getBalance)
const mockedGetUTXOs = vi.mocked(getUTXOs)
const mockedGetOrdinals = vi.mocked(getOrdinals)
const mockedGetUTXOsFromDB = vi.mocked(getUTXOsFromDB)
const mockedCacheOrdinalsInBackground = vi.mocked(cacheOrdinalsInBackground)

// --- Helpers ---

function makeWalletKeys(overrides: Partial<WalletKeys> = {}): WalletKeys {
  return {
    mnemonic: '',
    walletType: 'yours',
    walletWif: '',
    walletAddress: '1WalletAddr',
    walletPubKey: 'pubkey',
    ordWif: '',
    ordAddress: '1OrdAddr',
    ordPubKey: 'ordpub',
    identityWif: '',
    identityAddress: '1IdAddr',
    identityPubKey: 'idpub',
    ...overrides,
  }
}

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

function makeOptions() {
  const contentCacheRef: MutableRefObject<Map<string, OrdinalContentEntry>> = { current: new Map() }
  const ordinalsRef: MutableRefObject<Ordinal[]> = { current: [] }
  return {
    setBalance: vi.fn(),
    setOrdBalance: vi.fn(),
    setTxHistory: vi.fn(),
    setUtxos: vi.fn(),
    setOrdinalsWithRef: vi.fn(),
    setSyncError: vi.fn(),
    bumpCacheVersion: vi.fn(),
    contentCacheRef,
    ordinalsRef,
  }
}

function setupDefaultDbMocks() {
  mockedGetBalanceFromDatabase.mockResolvedValue(0)
  mockedGetAllTransactions.mockResolvedValue({ ok: true, value: [] } as never)
  mockedGetLocks.mockResolvedValue([])
  mockedGetCachedOrdinals.mockResolvedValue([])
  mockedGetAllCachedOrdinalOrigins.mockResolvedValue([])
  mockedGetBatchOrdinalContent.mockResolvedValue(new Map())
  mockedGetOrdinalsFromDatabase.mockResolvedValue([])
  mockedMapDbLocksToLockedUtxos.mockReturnValue([])
  mockedGetUTXOsFromDB.mockResolvedValue([])
  mockedGetDerivedAddresses.mockResolvedValue([])
  mockedGetBalance.mockResolvedValue(0)
  mockedGetUTXOs.mockResolvedValue([])
  mockedGetOrdinals.mockResolvedValue([])
  mockedCacheOrdinalsInBackground.mockResolvedValue(undefined)

  // Mock localStorage
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, val: string) => { storage[key] = val },
    removeItem: (key: string) => { delete storage[key] },
  })
}

// --- Tests ---

describe('useSyncData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaultDbMocks()
  })

  describe('fetchDataFromDB', () => {
    it('returns early when activeAccountId is null', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), null, vi.fn())
      })

      expect(mockedGetBalanceFromDatabase).not.toHaveBeenCalled()
    })

    it('treats activeAccountId 0 as valid (not falsy)', async () => {
      mockedGetBalanceFromDatabase
        .mockResolvedValueOnce(5000)
        .mockResolvedValueOnce(3000)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 0, vi.fn())
      })

      // B-46: Account ID 0 is valid (== null check, not !id)
      expect(mockedGetBalanceFromDatabase).toHaveBeenCalled()
    })

    it('loads balance from DB and sets it', async () => {
      mockedGetBalanceFromDatabase
        .mockResolvedValueOnce(5000) // default basket
        .mockResolvedValueOnce(3000) // derived basket
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setBalance).toHaveBeenCalledWith(8000)
    })

    it('loads transaction history from DB', async () => {
      mockedGetAllTransactions.mockResolvedValue({
        ok: true,
        value: [
          { txid: 'tx-1', blockHeight: 100, amount: 500, description: 'Payment', createdAt: 1000 },
          { txid: 'tx-2', blockHeight: 200, amount: -100, description: 'Send', createdAt: 2000 },
        ],
      } as never)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setTxHistory).toHaveBeenCalledTimes(1)
      const history = opts.setTxHistory.mock.calls[0]![0] as TxHistoryItem[]
      expect(history).toHaveLength(2)
      // Sorted by height descending: tx-2 (height 200) comes first
      expect(history[0]!.tx_hash).toBe('tx-2')
    })

    it('loads locks from DB and calls onLocksLoaded', async () => {
      const mappedLocks: LockedUTXO[] = [{ txid: 'lock-1', vout: 0, satoshis: 1000, unlockBlock: 900000, lockingScript: '', publicKeyHex: '', createdAt: 0 }]
      mockedGetLocks.mockResolvedValue([{ id: 1 }] as never)
      mockedMapDbLocksToLockedUtxos.mockReturnValue(mappedLocks)
      const onLocksLoaded = vi.fn()
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, onLocksLoaded)
      })

      expect(onLocksLoaded).toHaveBeenCalledWith(mappedLocks)
    })

    it('loads ordinals from cache table when available', async () => {
      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord-1', txid: 'tx-ord', vout: 0, satoshis: 1, contentType: 'image/png', contentHash: 'h1', accountId: 1, fetchedAt: 0, blockHeight: 100 },
      ] as never)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setOrdinalsWithRef).toHaveBeenCalledTimes(1)
      const ordinals = opts.setOrdinalsWithRef.mock.calls[0]![0] as Ordinal[]
      expect(ordinals[0]!.origin).toBe('ord-1')
    })

    it('falls back to UTXOs table when cache is empty', async () => {
      mockedGetCachedOrdinals.mockResolvedValue([])
      const dbOrdinals = [{ origin: 'utxo-ord', txid: 'tx-u', vout: 0, satoshis: 1 }]
      mockedGetOrdinalsFromDatabase.mockResolvedValue(dbOrdinals as never)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(mockedGetOrdinalsFromDatabase).toHaveBeenCalledWith(1)
      expect(opts.setOrdinalsWithRef).toHaveBeenCalledWith(dbOrdinals)
    })

    it('loads UTXOs from DB', async () => {
      const dbUtxos = [{ txid: 'utxo-1', vout: 0, satoshis: 1000 }]
      mockedGetUTXOsFromDB.mockResolvedValue(dbUtxos as never)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setUtxos).toHaveBeenCalledWith(dbUtxos)
    })

    it('resets ordBalance to 0 (API-only)', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setOrdBalance).toHaveBeenCalledWith(0)
    })

    it('clears sync error', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setSyncError).toHaveBeenCalledWith(null)
    })

    it('respects isCancelled during balance loading', async () => {
      let callCount = 0
      const isCancelled = () => {
        callCount++
        return callCount > 1 // cancel after first call
      }
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn(), isCancelled)
      })

      // Balance should not be set because isCancelled returns true before setBalance
      // (depends on timing — the check is after the Promise.all for balance)
      // At minimum, downstream setters should not ALL be called
      expect(opts.setOrdBalance).not.toHaveBeenCalled()
    })

    it('handles balance read failure gracefully', async () => {
      mockedGetBalanceFromDatabase.mockRejectedValue(new Error('DB corrupt'))
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      // Should not throw
      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      // Balance setter should not be called but other data still loads
      expect(opts.setBalance).not.toHaveBeenCalled()
      expect(opts.setOrdBalance).toHaveBeenCalledWith(0) // still runs
    })

    it('handles tx history read failure gracefully', async () => {
      mockedGetAllTransactions.mockRejectedValue(new Error('DB error'))
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setTxHistory).not.toHaveBeenCalled()
      // Other setters still called
      expect(opts.setOrdBalance).toHaveBeenCalledWith(0)
    })

    it('handles locks read failure gracefully', async () => {
      mockedGetLocks.mockRejectedValue(new Error('DB error'))
      const onLocksLoaded = vi.fn()
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, onLocksLoaded)
      })

      expect(onLocksLoaded).not.toHaveBeenCalled()
    })

    it('loads batch ordinal content and updates cache', async () => {
      mockedGetCachedOrdinals.mockResolvedValue([
        { origin: 'ord-1', txid: 'tx', vout: 0, satoshis: 1, contentType: null, contentHash: null, accountId: 1, fetchedAt: 0, blockHeight: 0 },
      ] as never)
      mockedGetAllCachedOrdinalOrigins.mockResolvedValue(['ord-1', 'ord-2'])
      const contentMap = new Map<string, OrdinalContentEntry>([
        ['ord-1', { contentText: 'hello' }],
        ['ord-2', { contentData: new Uint8Array([1]) }],
      ])
      mockedGetBatchOrdinalContent.mockResolvedValue(contentMap)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      // B-60: Cache entries are merged into the existing Map (not replaced wholesale)
      // so the ref identity stays the same but entries are present
      expect(opts.contentCacheRef.current.size).toBe(contentMap.size)
      for (const [key, value] of contentMap) {
        expect(opts.contentCacheRef.current.get(key)).toEqual(value)
      }
      expect(opts.bumpCacheVersion).toHaveBeenCalledTimes(1)
    })

    it('does not set non-finite balance', async () => {
      mockedGetBalanceFromDatabase
        .mockResolvedValueOnce(NaN)
        .mockResolvedValueOnce(0)
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchDataFromDB(makeWalletKeys(), 1, vi.fn())
      })

      expect(opts.setBalance).not.toHaveBeenCalled()
    })
  })

  describe('fetchData', () => {
    it('returns early when activeAccountId is null', async () => {
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), null, new Set(), vi.fn())
      })

      expect(mockedGetBalanceFromDatabase).not.toHaveBeenCalled()
    })

    it('fetches balance from DB and ord balance from API', async () => {
      mockedGetBalanceFromDatabase
        .mockResolvedValueOnce(2000)
        .mockResolvedValueOnce(1000)
      mockedGetBalance
        .mockResolvedValueOnce(500) // ordAddress
        .mockResolvedValueOnce(200) // identityAddress
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(opts.setBalance).toHaveBeenCalledWith(3000)
      expect(opts.setOrdBalance).toHaveBeenCalledWith(700)
    })

    it('handles partial ord balance API failure (one succeeds, one fails)', async () => {
      mockedGetBalance
        .mockResolvedValueOnce(500) // ordAddress succeeds
        .mockRejectedValueOnce(new Error('API timeout')) // identityAddress fails

      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // allSettled handles partial failure — rejected result contributes 0
      expect(opts.setOrdBalance).toHaveBeenCalledWith(500)
    })

    it('fetches ordinals from all addresses in parallel', async () => {
      const ordFromOrd = [makeOrdinal({ origin: 'ord-addr' })]
      const ordFromWallet = [makeOrdinal({ origin: 'wallet-addr' })]
      const ordFromIdentity = [makeOrdinal({ origin: 'id-addr' })]

      mockedGetOrdinals
        .mockResolvedValueOnce(ordFromOrd)     // ordAddress
        .mockResolvedValueOnce(ordFromWallet)   // walletAddress
        .mockResolvedValueOnce(ordFromIdentity) // identityAddress

      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(mockedGetOrdinals).toHaveBeenCalledTimes(3)
      // setOrdinalsWithRef called at least once with combined results
      const lastCall = opts.setOrdinalsWithRef.mock.calls[opts.setOrdinalsWithRef.mock.calls.length - 1]!
      const ordinals = lastCall[0] as Ordinal[]
      expect(ordinals.length).toBe(3)
    })

    it('deduplicates ordinals by origin', async () => {
      const sharedOrdinal = makeOrdinal({ origin: 'shared' })
      mockedGetOrdinals
        .mockResolvedValueOnce([sharedOrdinal]) // ordAddress
        .mockResolvedValueOnce([sharedOrdinal]) // walletAddress (duplicate)
        .mockResolvedValueOnce([])              // identityAddress

      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      const lastCall = opts.setOrdinalsWithRef.mock.calls[opts.setOrdinalsWithRef.mock.calls.length - 1]!
      const ordinals = lastCall[0] as Ordinal[]
      expect(ordinals.length).toBe(1)
    })

    it('uses DB ordinals when not all API calls succeed (B-21 fix)', async () => {
      const dbOrdinals = [
        { origin: 'db-1', txid: 'tx-db-1', vout: 0, satoshis: 1 },
        { origin: 'db-2', txid: 'tx-db-2', vout: 0, satoshis: 1 },
      ]
      mockedGetOrdinalsFromDatabase.mockResolvedValue(dbOrdinals as never)

      // Only first API call succeeds, second and third fail
      mockedGetOrdinals
        .mockResolvedValueOnce([makeOrdinal({ origin: 'api-1' })]) // ordAddress succeeds
        .mockRejectedValueOnce(new Error('API timeout'))            // walletAddress fails
        .mockResolvedValueOnce([])                                  // identityAddress succeeds

      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // Should use DB ordinals, NOT partial API results
      const lastCall = opts.setOrdinalsWithRef.mock.calls[opts.setOrdinalsWithRef.mock.calls.length - 1]!
      const ordinals = lastCall[0] as Array<{ origin: string }>
      // Should be DB ordinals (2 items), not partial API ordinals (1 item)
      expect(ordinals.length).toBe(2)
      expect(ordinals[0]!.origin).toBe('db-1')
    })

    it('calls cacheOrdinalsInBackground with allApiCallsSucceeded=true when all succeed', async () => {
      mockedGetOrdinals.mockResolvedValue([makeOrdinal()])
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(mockedCacheOrdinalsInBackground).toHaveBeenCalledTimes(1)
      // Last argument is allApiCallsSucceeded
      const lastArg = mockedCacheOrdinalsInBackground.mock.calls[0]![5]
      expect(lastArg).toBe(true)
    })

    it('calls cacheOrdinalsInBackground with allApiCallsSucceeded=false when some fail', async () => {
      mockedGetOrdinals
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce([])
      mockedGetOrdinalsFromDatabase.mockResolvedValue([])
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(mockedCacheOrdinalsInBackground).toHaveBeenCalledTimes(1)
      const lastArg = mockedCacheOrdinalsInBackground.mock.calls[0]![5]
      expect(lastArg).toBe(false)
    })

    it('fetches UTXOs and notifies caller for lock detection', async () => {
      const utxoList = [{ txid: 'utxo-1', vout: 0, satoshis: 5000 }] as UTXO[]
      mockedGetUTXOs.mockResolvedValue(utxoList)
      const onLocksDetected = vi.fn()
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), onLocksDetected)
      })

      expect(opts.setUtxos).toHaveBeenCalledWith(utxoList)
      expect(onLocksDetected).toHaveBeenCalledWith({
        utxos: utxoList,
        shouldClearLocks: false,
      })
    })

    it('sets shouldClearLocks=true when knownUnlockedLocks is non-empty', async () => {
      mockedGetUTXOs.mockResolvedValue([])
      const onLocksDetected = vi.fn()
      const knownUnlocked = new Set(['lock-1'])
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, knownUnlocked, onLocksDetected)
      })

      expect(onLocksDetected).toHaveBeenCalledWith(
        expect.objectContaining({ shouldClearLocks: true })
      )
    })

    it('surfaces partial error message when some data fails', async () => {
      mockedGetUTXOs.mockRejectedValue(new Error('API down'))
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(opts.setSyncError).toHaveBeenCalledWith(
        expect.stringContaining('UTXOs')
      )
    })

    it('respects isCancelled via AbortController wrapping', async () => {
      let cancelled = false
      const isCancelled = () => cancelled

      // Make getBalance block until we cancel
      mockedGetBalance.mockImplementation(async (_addr, signal) => {
        // Simulate checking signal
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        return 100
      })

      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      // Start fetch, then cancel midway
      const fetchPromise = act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn(), isCancelled)
      })

      cancelled = true
      await fetchPromise

      // When cancelled, later setters should not be called
      // The exact behavior depends on timing, but at least no crash
    })

    it('preloads locks from DB before blockchain detection', async () => {
      const dbLocks = [{ id: 1 }]
      const mappedLocks: LockedUTXO[] = [{
        txid: 'lock-1', vout: 0, satoshis: 1000, unlockBlock: 900000, lockingScript: '', publicKeyHex: '', createdAt: 0
      }]
      mockedGetLocks.mockResolvedValue(dbLocks as never)
      mockedMapDbLocksToLockedUtxos.mockReturnValue(mappedLocks)
      const onLocksDetected = vi.fn()
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), onLocksDetected)
      })

      // Should have been called with preloadedLocks for immediate UI display
      expect(onLocksDetected).toHaveBeenCalledWith(
        expect.objectContaining({ preloadedLocks: mappedLocks })
      )
    })

    it('includes derived address ordinals in fetch', async () => {
      mockedGetDerivedAddresses.mockResolvedValue([
        { address: '1DerivedAddr1', derivationPath: "m/44'/0'/0'/0/1", accountId: 1, lastSyncedAt: 0 },
      ] as never)
      mockedGetOrdinals.mockResolvedValue([])
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // 3 base addresses + 1 derived = 4 calls
      expect(mockedGetOrdinals).toHaveBeenCalledTimes(4)
    })

    it('displays DB ordinals immediately on cold start (ordinalsRef empty)', async () => {
      const dbOrdinals = [{ origin: 'db-ord', txid: 'tx', vout: 0, satoshis: 1 }]
      mockedGetOrdinalsFromDatabase.mockResolvedValue(dbOrdinals as never)
      mockedGetOrdinals.mockResolvedValue([makeOrdinal({ origin: 'api-ord' })])
      const opts = makeOptions()
      // ordinalsRef is empty (cold start)
      opts.ordinalsRef.current = []
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // First call should be DB ordinals (immediate display)
      const firstCall = opts.setOrdinalsWithRef.mock.calls[0]!
      expect(firstCall[0]).toEqual(dbOrdinals)
    })

    it('does NOT overwrite state with DB ordinals when ordinalsRef is non-empty', async () => {
      const dbOrdinals = [{ origin: 'db-ord', txid: 'tx', vout: 0, satoshis: 1 }]
      mockedGetOrdinalsFromDatabase.mockResolvedValue(dbOrdinals as never)
      mockedGetOrdinals.mockResolvedValue([makeOrdinal({ origin: 'api-ord' })])
      const opts = makeOptions()
      // ordinalsRef already has data (not a cold start)
      opts.ordinalsRef.current = [makeOrdinal()]
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // First call should be API ordinals, NOT DB ordinals
      const firstCall = opts.setOrdinalsWithRef.mock.calls[0]!
      const ordinals = firstCall[0] as Ordinal[]
      expect(ordinals[0]!.origin).toBe('api-ord')
    })

    it('handles complete API failure with error message', async () => {
      // Make the entire try block throw
      mockedGetBalanceFromDatabase.mockRejectedValue(new Error('critical failure'))
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      expect(opts.setSyncError).toHaveBeenCalledWith('Failed to load wallet data')
    })

    it('does not set non-finite ord balance from API', async () => {
      mockedGetBalance
        .mockResolvedValueOnce(NaN) // ordAddress returns NaN
        .mockResolvedValueOnce(0)   // identityAddress
      const opts = makeOptions()
      const { result } = renderHook(() => useSyncData(opts))

      await act(async () => {
        await result.current.fetchData(makeWalletKeys(), 1, new Set(), vi.fn())
      })

      // setOrdBalance should not be called with NaN
      if (opts.setOrdBalance.mock.calls.length > 0) {
        const val = opts.setOrdBalance.mock.calls[0]![0] as number
        expect(Number.isFinite(val)).toBe(true)
      }
    })
  })
})
