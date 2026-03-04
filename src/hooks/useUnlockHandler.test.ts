// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUnlockHandler } from './useUnlockHandler'
import type { LockedUTXO } from '../services/wallet'
import type { NetworkInfo } from '../contexts/NetworkContext'

// --- Helpers ---

function makeLock(overrides: Partial<LockedUTXO> = {}): LockedUTXO {
  return {
    txid: 'lock-txid-1',
    vout: 0,
    satoshis: 10000,
    unlockBlock: 800000,
    lockingScript: '76a914...',
    publicKeyHex: '02abc...',
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeNetworkInfo(blockHeight: number): NetworkInfo {
  return {
    blockHeight,
    overlayHealthy: true,
    overlayNodeCount: 1,
  }
}

function makeOptions(overrides: Partial<Parameters<typeof useUnlockHandler>[0]> = {}) {
  return {
    locks: [] as LockedUTXO[],
    networkInfo: makeNetworkInfo(850000) as NetworkInfo | null,
    unlockConfirm: null as LockedUTXO | 'all' | null,
    handleUnlock: vi.fn().mockResolvedValue({ ok: true, value: { txid: 'unlock-txid' } }),
    showToast: vi.fn(),
    setUnlocking: vi.fn(),
    cancelUnlock: vi.fn(),
    ...overrides,
  }
}

// --- Tests ---

describe('useUnlockHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── unlockableLocks computation ──────────────────────────────────

  it('returns empty unlockableLocks when no locks exist', () => {
    const opts = makeOptions({ locks: [] })
    const { result } = renderHook(() => useUnlockHandler(opts))

    expect(result.current.unlockableLocks).toEqual([])
  })

  it('filters locks based on current block height', () => {
    const unlockable = makeLock({ txid: 'ready', unlockBlock: 800000 })
    const notReady = makeLock({ txid: 'not-ready', unlockBlock: 900000 })

    const opts = makeOptions({
      locks: [unlockable, notReady],
      networkInfo: makeNetworkInfo(850000),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    expect(result.current.unlockableLocks).toHaveLength(1)
    expect(result.current.unlockableLocks[0]!.txid).toBe('ready')
  })

  it('includes locks at exactly the unlock block height', () => {
    const exactBlock = makeLock({ txid: 'exact', unlockBlock: 850000 })

    const opts = makeOptions({
      locks: [exactBlock],
      networkInfo: makeNetworkInfo(850000),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    expect(result.current.unlockableLocks).toHaveLength(1)
    expect(result.current.unlockableLocks[0]!.txid).toBe('exact')
  })

  it('treats null networkInfo as block height 0 (no locks unlockable)', () => {
    const lock = makeLock({ unlockBlock: 1 })

    const opts = makeOptions({
      locks: [lock],
      networkInfo: null,
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    expect(result.current.unlockableLocks).toHaveLength(0)
  })

  it('updates unlockableLocks when locks or networkInfo change', () => {
    const lock1 = makeLock({ txid: 'lock-1', unlockBlock: 800000 })
    const lock2 = makeLock({ txid: 'lock-2', unlockBlock: 860000 })

    const opts = makeOptions({
      locks: [lock1, lock2],
      networkInfo: makeNetworkInfo(850000),
    })
    const { result, rerender } = renderHook(
      (props) => useUnlockHandler(props),
      { initialProps: opts }
    )

    // Initially only lock1 is unlockable
    expect(result.current.unlockableLocks).toHaveLength(1)

    // Network advances — both become unlockable
    rerender({ ...opts, networkInfo: makeNetworkInfo(860000) })
    expect(result.current.unlockableLocks).toHaveLength(2)
  })

  // ── handleConfirmUnlock — single lock ──────────────────────────────

  it('unlocks a single lock successfully', async () => {
    const lock = makeLock({ satoshis: 5000 })
    const opts = makeOptions({
      locks: [lock],
      unlockConfirm: lock,
      handleUnlock: vi.fn().mockResolvedValue({ ok: true, value: { txid: 'unlock-tx' } }),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    expect(opts.handleUnlock).toHaveBeenCalledWith(lock)
    expect(opts.setUnlocking).toHaveBeenCalledWith(lock.txid)
    expect(opts.setUnlocking).toHaveBeenLastCalledWith(null)
    expect(opts.showToast).toHaveBeenCalledWith('Unlocked 5,000 sats!')
    expect(opts.cancelUnlock).toHaveBeenCalledTimes(1)
  })

  it('shows error toast when single lock unlock fails', async () => {
    const lock = makeLock()
    const opts = makeOptions({
      locks: [lock],
      unlockConfirm: lock,
      handleUnlock: vi.fn().mockResolvedValue({ ok: false, error: 'Insufficient fee' }),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    expect(opts.showToast).toHaveBeenCalledWith('Insufficient fee', 'error')
    expect(opts.setUnlocking).toHaveBeenLastCalledWith(null)
    // B-45: Should still close modal since there's only 1 lock and 0 succeeded
    // Actually: failed=1, succeeded=0, so cancelUnlock is NOT called
    // (succeeded > 0 || failed === 0) is false when succeeded=0, failed=1
  })

  // ── handleConfirmUnlock — batch unlock ('all') ─────────────────────

  it('unlocks all unlockable locks when unlockConfirm is "all"', async () => {
    const lock1 = makeLock({ txid: 'lock-1', satoshis: 1000, unlockBlock: 800000 })
    const lock2 = makeLock({ txid: 'lock-2', satoshis: 2000, unlockBlock: 800000 })
    const lockedLock = makeLock({ txid: 'lock-3', satoshis: 3000, unlockBlock: 900000 })

    const opts = makeOptions({
      locks: [lock1, lock2, lockedLock],
      unlockConfirm: 'all',
      networkInfo: makeNetworkInfo(850000),
      handleUnlock: vi.fn().mockResolvedValue({ ok: true, value: { txid: 'tx' } }),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    // Should only unlock the 2 unlockable locks, not the still-locked one
    expect(opts.handleUnlock).toHaveBeenCalledTimes(2)
    expect(opts.handleUnlock).toHaveBeenCalledWith(lock1)
    expect(opts.handleUnlock).toHaveBeenCalledWith(lock2)
    expect(opts.cancelUnlock).toHaveBeenCalledTimes(1)
  })

  it('short-circuits batch unlock on first failure (B-45)', async () => {
    const lock1 = makeLock({ txid: 'lock-1', unlockBlock: 800000 })
    const lock2 = makeLock({ txid: 'lock-2', unlockBlock: 800000 })
    const lock3 = makeLock({ txid: 'lock-3', unlockBlock: 800000 })

    const opts = makeOptions({
      locks: [lock1, lock2, lock3],
      unlockConfirm: 'all',
      networkInfo: makeNetworkInfo(850000),
      handleUnlock: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { txid: 'tx-1' } })
        .mockResolvedValueOnce({ ok: false, error: 'Network error' })
        .mockResolvedValueOnce({ ok: true, value: { txid: 'tx-3' } }),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    // Should short-circuit after the first failure — lock3 should NOT be attempted
    expect(opts.handleUnlock).toHaveBeenCalledTimes(2)
    expect(opts.showToast).toHaveBeenCalledWith('Network error', 'error')
    // B-45: At least one succeeded, so modal should close
    expect(opts.cancelUnlock).toHaveBeenCalledTimes(1)
  })

  // ── handleConfirmUnlock — guard clauses ────────────────────────────

  it('does nothing when unlockConfirm is null', async () => {
    const opts = makeOptions({ unlockConfirm: null })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    expect(opts.handleUnlock).not.toHaveBeenCalled()
    expect(opts.setUnlocking).not.toHaveBeenCalled()
    expect(opts.cancelUnlock).not.toHaveBeenCalled()
  })

  // ── B-45: Modal behavior on failure ────────────────────────────────

  it('does not close modal when all locks fail (B-45)', async () => {
    const lock = makeLock({ unlockBlock: 800000 })

    const opts = makeOptions({
      locks: [lock],
      unlockConfirm: lock,
      handleUnlock: vi.fn().mockResolvedValue({ ok: false, error: 'Failed' }),
    })
    const { result } = renderHook(() => useUnlockHandler(opts))

    await act(async () => {
      await result.current.handleConfirmUnlock()
    })

    // succeeded=0, failed=1 => (0 > 0 || 1 === 0) is false => cancelUnlock NOT called
    expect(opts.cancelUnlock).not.toHaveBeenCalled()
  })
})
