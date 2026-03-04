// @vitest-environment jsdom
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// --- Mocks (must be before imports) ---

const { mockStopListener } = vi.hoisted(() => ({
  mockStopListener: vi.fn(),
}))

vi.mock('../services/messageBox', () => ({
  loadNotifications: vi.fn(),
  startPaymentListenerFromStore: vi.fn().mockReturnValue(mockStopListener),
  resetMessageBoxAuth: vi.fn(),
}))

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// --- Imports ---

import { usePaymentListener } from './usePaymentListener'
import {
  loadNotifications,
  startPaymentListenerFromStore,
  resetMessageBoxAuth,
} from '../services/messageBox'
import type { WalletKeys } from '../services/wallet'

const mockedLoadNotifications = vi.mocked(loadNotifications)
const mockedStartPaymentListenerFromStore = vi.mocked(startPaymentListenerFromStore)
const mockedResetMessageBoxAuth = vi.mocked(resetMessageBoxAuth)

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

function makeOptions(overrides: Partial<Parameters<typeof usePaymentListener>[0]> = {}) {
  return {
    wallet: makeWalletKeys() as WalletKeys | null,
    fetchData: vi.fn().mockResolvedValue(undefined),
    showToast: vi.fn(),
    ...overrides,
  }
}

// --- Tests ---

describe('usePaymentListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockStopListener.mockClear()
    mockedStartPaymentListenerFromStore.mockReturnValue(mockStopListener)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not start listener when wallet is null', () => {
    const opts = makeOptions({ wallet: null })
    renderHook(() => usePaymentListener(opts))

    expect(mockedStartPaymentListenerFromStore).not.toHaveBeenCalled()
    expect(mockedResetMessageBoxAuth).not.toHaveBeenCalled()
    expect(mockedLoadNotifications).not.toHaveBeenCalled()
  })

  it('starts listener when wallet is provided', () => {
    const wallet = makeWalletKeys({ identityPubKey: 'testPubKey' })
    const opts = makeOptions({ wallet })
    renderHook(() => usePaymentListener(opts))

    expect(mockedResetMessageBoxAuth).toHaveBeenCalledTimes(1)
    expect(mockedLoadNotifications).toHaveBeenCalledTimes(1)
    expect(mockedStartPaymentListenerFromStore).toHaveBeenCalledTimes(1)
    expect(mockedStartPaymentListenerFromStore).toHaveBeenCalledWith(
      'testPubKey',
      expect.any(Function)
    )
  })

  it('stops listener on cleanup (unmount)', () => {
    const opts = makeOptions()
    const { unmount } = renderHook(() => usePaymentListener(opts))

    expect(mockStopListener).not.toHaveBeenCalled()

    unmount()

    expect(mockStopListener).toHaveBeenCalledTimes(1)
  })

  it('restarts listener when wallet changes (account switch)', () => {
    const wallet1 = makeWalletKeys({ identityPubKey: 'pubkey1' })
    const wallet2 = makeWalletKeys({ identityPubKey: 'pubkey2' })

    const opts = makeOptions({ wallet: wallet1 })
    const { rerender } = renderHook(
      (props) => usePaymentListener(props),
      { initialProps: opts }
    )

    expect(mockedStartPaymentListenerFromStore).toHaveBeenCalledTimes(1)
    expect(mockedStartPaymentListenerFromStore).toHaveBeenCalledWith('pubkey1', expect.any(Function))

    // Switch wallet identity
    rerender({ ...opts, wallet: wallet2 })

    // Old listener should be stopped, new one started
    expect(mockStopListener).toHaveBeenCalledTimes(1)
    expect(mockedResetMessageBoxAuth).toHaveBeenCalledTimes(2)
    expect(mockedStartPaymentListenerFromStore).toHaveBeenCalledTimes(2)
    expect(mockedStartPaymentListenerFromStore).toHaveBeenLastCalledWith('pubkey2', expect.any(Function))
  })

  it('sets payment alert and shows toast when payment is received', () => {
    const opts = makeOptions()
    const { result } = renderHook(() => usePaymentListener(opts))

    // Initially no payment alert
    expect(result.current.newPaymentAlert).toBeNull()

    // Extract the handleNewPayment callback passed to startPaymentListenerFromStore
    const handleNewPayment = mockedStartPaymentListenerFromStore.mock.calls[0]![1]!

    // Simulate receiving a payment
    const payment = {
      txid: 'abc123',
      vout: 0,
      amount: 50000,
      derivationPrefix: 'm/0',
      derivationSuffix: '0/1',
      senderPublicKey: 'sender-pub',
    }

    act(() => {
      handleNewPayment(payment)
    })

    expect(result.current.newPaymentAlert).toEqual(payment)
    expect(opts.showToast).toHaveBeenCalledWith('Received 50,000 sats!')
    expect(opts.fetchData).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses payment alert after 5 seconds', () => {
    const opts = makeOptions()
    const { result } = renderHook(() => usePaymentListener(opts))

    const handleNewPayment = mockedStartPaymentListenerFromStore.mock.calls[0]![1]!

    const payment = {
      txid: 'abc123',
      vout: 0,
      amount: 1000,
      derivationPrefix: 'm/0',
      derivationSuffix: '0/1',
      senderPublicKey: 'sender-pub',
    }

    act(() => {
      handleNewPayment(payment)
    })

    expect(result.current.newPaymentAlert).toEqual(payment)

    // Advance time by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.newPaymentAlert).toBeNull()
  })

  it('dismissPaymentAlert clears the alert immediately', () => {
    const opts = makeOptions()
    const { result } = renderHook(() => usePaymentListener(opts))

    const handleNewPayment = mockedStartPaymentListenerFromStore.mock.calls[0]![1]!

    const payment = {
      txid: 'abc123',
      vout: 0,
      amount: 2000,
      derivationPrefix: 'm/0',
      derivationSuffix: '0/1',
      senderPublicKey: 'sender-pub',
    }

    act(() => {
      handleNewPayment(payment)
    })

    expect(result.current.newPaymentAlert).toEqual(payment)

    act(() => {
      result.current.dismissPaymentAlert()
    })

    expect(result.current.newPaymentAlert).toBeNull()
  })

  it('handles payment with unknown amount gracefully', () => {
    const opts = makeOptions()
    renderHook(() => usePaymentListener(opts))

    const handleNewPayment = mockedStartPaymentListenerFromStore.mock.calls[0]![1]!

    const payment = {
      txid: 'def456',
      vout: 0,
      amount: 0,
      derivationPrefix: 'm/0',
      derivationSuffix: '0/1',
      senderPublicKey: 'sender-pub',
    }

    act(() => {
      handleNewPayment(payment)
    })

    // Should show toast with "0" amount (toLocaleString handles 0)
    expect(opts.showToast).toHaveBeenCalledWith('Received 0 sats!')
  })

  it('handles fetchData failure gracefully after payment', () => {
    const opts = makeOptions({
      fetchData: vi.fn().mockRejectedValue(new Error('API error')),
    })
    renderHook(() => usePaymentListener(opts))

    const handleNewPayment = mockedStartPaymentListenerFromStore.mock.calls[0]![1]!

    const payment = {
      txid: 'ghi789',
      vout: 0,
      amount: 5000,
      derivationPrefix: 'm/0',
      derivationSuffix: '0/1',
      senderPublicKey: 'sender-pub',
    }

    // Should not throw even if fetchData rejects
    act(() => {
      handleNewPayment(payment)
    })

    expect(opts.fetchData).toHaveBeenCalledTimes(1)
  })

  it('returns initial state with no alert and a dismiss function', () => {
    const opts = makeOptions({ wallet: null })
    const { result } = renderHook(() => usePaymentListener(opts))

    expect(result.current.newPaymentAlert).toBeNull()
    expect(typeof result.current.dismissPaymentAlert).toBe('function')
  })
})
