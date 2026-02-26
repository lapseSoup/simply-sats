/**
 * Tests for Tauri Environment Utilities
 *
 * Tests isTauri() detection and tauriInvoke() with timeout/race logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @tauri-apps/api/core before importing the module under test
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

import { isTauri, tauriInvoke } from './tauri'

describe('isTauri', () => {
  afterEach(() => {
    // Clean up __TAURI_INTERNALS__ after each test
    if (typeof window !== 'undefined') {
      delete (window as Record<string, unknown>).__TAURI_INTERNALS__
    }
  })

  it('returns true when __TAURI_INTERNALS__ is present on window', () => {
    ;(window as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    expect(isTauri()).toBe(true)
  })

  it('returns false when __TAURI_INTERNALS__ is not present on window', () => {
    delete (window as Record<string, unknown>).__TAURI_INTERNALS__
    expect(isTauri()).toBe(false)
  })

  it('returns false when window is undefined', () => {
    // Temporarily remove window
    const saved = globalThis.window
    // @ts-expect-error -- deliberately removing window for test
    delete globalThis.window
    try {
      expect(isTauri()).toBe(false)
    } finally {
      globalThis.window = saved
    }
  })
})

describe('tauriInvoke', () => {
  // Suppress unhandled rejection warnings from Promise.race losers.
  // tauriInvoke uses Promise.race([invoke, timeout]) — the losing branch
  // always produces an unhandled rejection once the winner settles.
  // This is inherent to the Promise.race pattern and safe to suppress in tests.
  const suppressUnhandled = (err: unknown) => {
    if (err instanceof Error && err.message.includes('timed out after')) return
    if (err instanceof Error && err.message === 'Command failed') return
    // Re-throw anything unexpected
    throw err
  }

  beforeEach(() => {
    vi.useFakeTimers()
    mockInvoke.mockReset()
    process.on('unhandledRejection', suppressUnhandled)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    process.removeListener('unhandledRejection', suppressUnhandled)
  })

  it('invokes a Tauri command and returns the result', async () => {
    mockInvoke.mockResolvedValue('hello')

    const result = await tauriInvoke<string>('greet', { name: 'world' })

    expect(result).toBe('hello')
    expect(mockInvoke).toHaveBeenCalledWith('greet', { name: 'world' })
  })

  it('passes undefined args when none provided', async () => {
    mockInvoke.mockResolvedValue(42)

    const result = await tauriInvoke<number>('get_count')

    expect(result).toBe(42)
    expect(mockInvoke).toHaveBeenCalledWith('get_count', undefined)
  })

  it('times out after the default 30s if invoke hangs', async () => {
    // Simulate a command that never resolves
    mockInvoke.mockReturnValue(new Promise(() => {}))

    const promise = tauriInvoke('slow_command')

    // Advance time past the 30s default timeout
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(promise).rejects.toThrow(
      "Tauri command 'slow_command' timed out after 30000ms"
    )
  })

  it('uses a custom timeout when provided', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))

    const promise = tauriInvoke('slow_command', undefined, 5000)

    // Advance time just past the 5s timeout
    await vi.advanceTimersByTimeAsync(5000)

    await expect(promise).rejects.toThrow(
      "Tauri command 'slow_command' timed out after 5000ms"
    )
  })

  it('does not time out before the timeout period', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))

    const promise = tauriInvoke('slow_command', undefined, 5000)
    let settled = false
    promise.then(() => { settled = true }).catch(() => { settled = true })

    // Advance to just before timeout
    await vi.advanceTimersByTimeAsync(4999)

    expect(settled).toBe(false)

    // Now trigger timeout so we don't leak
    await vi.advanceTimersByTimeAsync(1)
    await promise.catch(() => {})
  })

  it('resolves before timeout when invoke is fast', async () => {
    mockInvoke.mockResolvedValue({ data: 'fast' })

    const promise = tauriInvoke<{ data: string }>('fast_command', { key: 'value' }, 5000)
    const result = await promise

    expect(result).toEqual({ data: 'fast' })
  })

  it('propagates errors from invoke (not timeout)', async () => {
    mockInvoke.mockRejectedValue(new Error('Command failed'))

    const promise = tauriInvoke('broken_command')

    await expect(promise).rejects.toThrow('Command failed')
  })

  it('includes the command name and timeout in the error message', async () => {
    mockInvoke.mockReturnValue(new Promise(() => {}))

    const promise = tauriInvoke('my_cmd', undefined, 1234)
    await vi.advanceTimersByTimeAsync(1234)

    await expect(promise).rejects.toThrow(
      "Tauri command 'my_cmd' timed out after 1234ms"
    )
  })

  it('returns typed results correctly', async () => {
    interface WalletInfo {
      address: string
      balance: number
    }
    mockInvoke.mockResolvedValue({ address: '1ABC', balance: 50000 })

    const result = await tauriInvoke<WalletInfo>('get_wallet_info')

    expect(result.address).toBe('1ABC')
    expect(result.balance).toBe(50000)
  })
})
