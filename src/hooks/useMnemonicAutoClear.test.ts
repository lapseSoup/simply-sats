// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// --- Mocks ---

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../config', () => ({
  SECURITY: {
    MNEMONIC_AUTO_CLEAR_MS: 300000, // 5 minutes
  },
}))

// --- Imports ---

import { useMnemonicAutoClear } from './useMnemonicAutoClear'

// --- Tests ---

describe('useMnemonicAutoClear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing when mnemonic is null', () => {
    const setNewMnemonic = vi.fn()
    renderHook(() => useMnemonicAutoClear(null, setNewMnemonic))

    // Advance well past the timeout
    vi.advanceTimersByTime(600000)

    expect(setNewMnemonic).not.toHaveBeenCalled()
  })

  it('clears mnemonic after the timeout duration', () => {
    const setNewMnemonic = vi.fn()
    renderHook(() => useMnemonicAutoClear('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12', setNewMnemonic))

    // Should not be cleared before timeout
    vi.advanceTimersByTime(299999)
    expect(setNewMnemonic).not.toHaveBeenCalled()

    // Should be cleared exactly at timeout (overwrite with zeros, then null)
    vi.advanceTimersByTime(1)
    expect(setNewMnemonic).toHaveBeenCalledTimes(2)
    expect(setNewMnemonic).toHaveBeenNthCalledWith(1, '0'.repeat('word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12'.length))
    expect(setNewMnemonic).toHaveBeenNthCalledWith(2, null)
  })

  it('clears timeout on unmount (cleanup)', () => {
    const setNewMnemonic = vi.fn()
    const { unmount } = renderHook(() =>
      useMnemonicAutoClear('test mnemonic words', setNewMnemonic)
    )

    // Unmount before timeout fires
    unmount()

    // Advance past timeout
    vi.advanceTimersByTime(600000)

    // Should NOT have been called because timer was cleaned up
    expect(setNewMnemonic).not.toHaveBeenCalled()
  })

  it('resets timer when mnemonic changes to a new value', () => {
    const setNewMnemonic = vi.fn()
    const { rerender } = renderHook(
      ({ mnemonic }) => useMnemonicAutoClear(mnemonic, setNewMnemonic),
      { initialProps: { mnemonic: 'first mnemonic' as string | null } }
    )

    // Advance partway through timeout
    vi.advanceTimersByTime(200000)
    expect(setNewMnemonic).not.toHaveBeenCalled()

    // Change mnemonic — should reset the timer
    rerender({ mnemonic: 'second mnemonic' })

    // The old timer's remaining time has passed, but it was cancelled
    vi.advanceTimersByTime(200000)
    expect(setNewMnemonic).not.toHaveBeenCalled()

    // Now advance to complete the NEW timer (300000ms from rerender)
    vi.advanceTimersByTime(100000)
    expect(setNewMnemonic).toHaveBeenCalledTimes(2)
    expect(setNewMnemonic).toHaveBeenNthCalledWith(1, '0'.repeat('second mnemonic'.length))
    expect(setNewMnemonic).toHaveBeenNthCalledWith(2, null)
  })

  it('does not restart timer when mnemonic changes to null', () => {
    const setNewMnemonic = vi.fn()
    const { rerender } = renderHook(
      ({ mnemonic }) => useMnemonicAutoClear(mnemonic, setNewMnemonic),
      { initialProps: { mnemonic: 'some mnemonic' as string | null } }
    )

    // Change to null before timeout — should cancel timer
    rerender({ mnemonic: null })

    // Advance well past timeout
    vi.advanceTimersByTime(600000)

    // setNewMnemonic should NOT have been called
    expect(setNewMnemonic).not.toHaveBeenCalled()
  })

  it('handles rapid mnemonic changes (only last timer fires)', () => {
    const setNewMnemonic = vi.fn()
    const { rerender } = renderHook(
      ({ mnemonic }) => useMnemonicAutoClear(mnemonic, setNewMnemonic),
      { initialProps: { mnemonic: 'mnemonic-1' as string | null } }
    )

    // Rapid changes
    rerender({ mnemonic: 'mnemonic-2' })
    rerender({ mnemonic: 'mnemonic-3' })
    rerender({ mnemonic: 'mnemonic-4' })

    // Only the last timer should be active (overwrite with zeros, then null)
    vi.advanceTimersByTime(300000)
    expect(setNewMnemonic).toHaveBeenCalledTimes(2)
    expect(setNewMnemonic).toHaveBeenNthCalledWith(1, '0'.repeat('mnemonic-4'.length))
    expect(setNewMnemonic).toHaveBeenNthCalledWith(2, null)
  })
})
