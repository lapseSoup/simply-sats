// @vitest-environment node

/**
 * Tests for MessageBox Service (messageBox.ts)
 *
 * Covers: createAuthHeaders (indirectly via listPaymentMessages),
 *         listPaymentMessages, acknowledgeMessages, checkForPayments,
 *         loadNotifications, getDerivationForUtxo, getPaymentNotifications,
 *         addManualNotification, clearNotifications, resetMessageBoxAuth,
 *         deriveKeyFromNotification, startPaymentListener, startPaymentListenerFromWif,
 *         parsePaymentMessage (indirectly via checkForPayments)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockTauriInvoke } = vi.hoisted(() => ({
  mockTauriInvoke: vi.fn(),
}))

vi.mock('../utils/tauri', () => ({
  tauriInvoke: (...args: unknown[]) => mockTauriInvoke(...args),
}))

vi.mock('./logger', () => ({
  messageLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('../infrastructure/storage/localStorage', () => ({
  STORAGE_KEYS: {
    PAYMENT_NOTIFICATIONS: 'simply_sats_payment_notifications',
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  listPaymentMessages,
  acknowledgeMessages,
  checkForPayments,
  loadNotifications,
  getDerivationForUtxo,
  getPaymentNotifications,
  addManualNotification,
  clearNotifications,
  resetMessageBoxAuth,
  deriveKeyFromNotification,
  startPaymentListener,
  startPaymentListenerFromWif,
  listPaymentMessagesFromStore,
  acknowledgeMessagesFromStore,
  checkForPaymentsFromStore,
  startPaymentListenerFromStore,
} from './messageBox'
import type { PaymentNotification } from './messageBox'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_WIF = 'L1identityWifMockValue'
const MOCK_PUB_KEY = '02' + 'a'.repeat(64)
const MOCK_HASH = 'abc123def456'
const MOCK_SIGNATURE = 'deadbeef'

function makePaymentMessage(overrides: Record<string, unknown> = {}) {
  return {
    messageId: 'msg-1',
    sender: MOCK_PUB_KEY,
    body: JSON.stringify({
      txid: 'tx-abc',
      vout: 0,
      amount: 50000,
      derivationPrefix: 'prefix-1',
      derivationSuffix: 'suffix-1',
    }),
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makePaymentNotification(overrides: Partial<PaymentNotification> = {}): PaymentNotification {
  return {
    txid: 'tx-abc',
    vout: 0,
    amount: 50000,
    derivationPrefix: 'prefix-1',
    derivationSuffix: 'suffix-1',
    senderPublicKey: MOCK_PUB_KEY,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure default mock behavior for Tauri invoke calls used by createAuthHeaders */
function setupAuthMocks() {
  mockTauriInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'sha256_hash') return MOCK_HASH
    if (cmd === 'sign_data') return MOCK_SIGNATURE
    if (cmd === 'sign_data_from_store') return MOCK_SIGNATURE
    if (cmd === 'keys_from_wif') return { wif: MOCK_WIF, address: '1MockAddr', pubKey: MOCK_PUB_KEY }
    if (cmd === 'derive_child_key') return { wif: 'L1derived', address: '1Derived', pubKey: MOCK_PUB_KEY }
    throw new Error(`Unexpected Tauri command: ${cmd}`)
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MessageBox Service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    // Clear internal state between tests
    clearNotifications()
    resetMessageBoxAuth()
    setupAuthMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // =========================================================================
  // loadNotifications
  // =========================================================================

  describe('loadNotifications', () => {
    it('should load notifications from localStorage', () => {
      const notifications = [makePaymentNotification()]
      localStorage.setItem(
        'simply_sats_payment_notifications',
        JSON.stringify(notifications)
      )

      loadNotifications()

      const result = getPaymentNotifications()
      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-abc')
    })

    it('should handle empty localStorage gracefully', () => {
      loadNotifications()

      const result = getPaymentNotifications()
      expect(result).toHaveLength(0)
    })

    it('should handle invalid JSON in localStorage gracefully', () => {
      localStorage.setItem(
        'simply_sats_payment_notifications',
        'not-valid-json'
      )

      // Should not throw
      loadNotifications()

      const result = getPaymentNotifications()
      expect(result).toHaveLength(0)
    })
  })

  // =========================================================================
  // getPaymentNotifications / clearNotifications
  // =========================================================================

  describe('getPaymentNotifications', () => {
    it('should return a copy of notifications array', () => {
      addManualNotification(makePaymentNotification())

      const result = getPaymentNotifications()
      expect(result).toHaveLength(1)

      // Mutating the returned array should not affect internal state
      result.pop()
      expect(getPaymentNotifications()).toHaveLength(1)
    })
  })

  describe('clearNotifications', () => {
    it('should remove all notifications', () => {
      addManualNotification(makePaymentNotification())
      expect(getPaymentNotifications()).toHaveLength(1)

      clearNotifications()
      expect(getPaymentNotifications()).toHaveLength(0)
    })

    it('should persist cleared state to localStorage', () => {
      addManualNotification(makePaymentNotification())
      clearNotifications()

      const stored = localStorage.getItem('simply_sats_payment_notifications')
      expect(stored).toBe('[]')
    })
  })

  // =========================================================================
  // addManualNotification
  // =========================================================================

  describe('addManualNotification', () => {
    it('should add a new notification', () => {
      const notification = makePaymentNotification()
      addManualNotification(notification)

      const result = getPaymentNotifications()
      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-abc')
    })

    it('should not add duplicate notifications (same txid + vout)', () => {
      const notification = makePaymentNotification()
      addManualNotification(notification)
      addManualNotification(notification)

      expect(getPaymentNotifications()).toHaveLength(1)
    })

    it('should allow notifications with same txid but different vout', () => {
      addManualNotification(makePaymentNotification({ vout: 0 }))
      addManualNotification(makePaymentNotification({ vout: 1 }))

      expect(getPaymentNotifications()).toHaveLength(2)
    })

    it('should persist to localStorage', () => {
      addManualNotification(makePaymentNotification())

      const stored = localStorage.getItem('simply_sats_payment_notifications')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].txid).toBe('tx-abc')
    })
  })

  // =========================================================================
  // getDerivationForUtxo
  // =========================================================================

  describe('getDerivationForUtxo', () => {
    it('should return matching notification for known utxo', () => {
      addManualNotification(makePaymentNotification())

      const result = getDerivationForUtxo('tx-abc', 0)
      expect(result).not.toBeNull()
      expect(result!.derivationPrefix).toBe('prefix-1')
    })

    it('should return null for unknown utxo', () => {
      const result = getDerivationForUtxo('tx-unknown', 0)
      expect(result).toBeNull()
    })

    it('should differentiate by vout', () => {
      addManualNotification(makePaymentNotification({ txid: 'tx-1', vout: 0 }))
      addManualNotification(makePaymentNotification({ txid: 'tx-1', vout: 1, derivationSuffix: 'suffix-2' }))

      const r0 = getDerivationForUtxo('tx-1', 0)
      const r1 = getDerivationForUtxo('tx-1', 1)
      expect(r0!.derivationSuffix).toBe('suffix-1')
      expect(r1!.derivationSuffix).toBe('suffix-2')
    })
  })

  // =========================================================================
  // listPaymentMessages
  // =========================================================================

  describe('listPaymentMessages', () => {
    it('should fetch messages from MessageBox API', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages }), { status: 200 })
      )

      const result = await listPaymentMessages(MOCK_WIF)

      expect(result).toEqual(messages)
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string
      expect(fetchUrl).toContain('/api/v1/message/payment_inbox')
    })

    it('should include correct auth headers', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      await listPaymentMessages(MOCK_WIF)

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['x-bsv-auth-pubkey']).toBe(MOCK_PUB_KEY)
      expect(headers['x-bsv-auth-signature']).toBe(MOCK_SIGNATURE)
      expect(headers['x-bsv-auth-timestamp']).toBeDefined()
      expect(headers['x-bsv-auth-nonce']).toBeDefined()
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should return empty array on 404 (no messages)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 404 })
      )

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should return empty array and increment auth failure count on 401', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should suppress repeated 401 failures after max attempts', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )

      // Exhaust the failure counter (10 failures)
      for (let i = 0; i < 10; i++) {
        await listPaymentMessages(MOCK_WIF)
      }

      // 11th call should not even hit fetch
      vi.mocked(globalThis.fetch).mockClear()
      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('should retry after cooldown period (5 min)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )

      // Exhaust the failure counter
      for (let i = 0; i < 10; i++) {
        await listPaymentMessages(MOCK_WIF)
      }

      // Advance time past cooldown (5 minutes + 1 second)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

      vi.mocked(globalThis.fetch).mockClear()
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const result = await listPaymentMessages(MOCK_WIF)
      expect(globalThis.fetch).toHaveBeenCalledOnce()
      expect(result).toEqual([])
    })

    it('should return empty array on non-401/404 HTTP errors', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('Server Error', { status: 500 })
      )

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should return empty array on network error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'))

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should return empty array when Tauri auth commands fail', async () => {
      mockTauriInvoke.mockRejectedValue(new Error('No keys in store'))

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should return empty array when keys_from_wif returns null', async () => {
      mockTauriInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'sha256_hash') return MOCK_HASH
        if (cmd === 'sign_data') return MOCK_SIGNATURE
        if (cmd === 'keys_from_wif') return null
        throw new Error(`Unexpected command: ${cmd}`)
      })

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })

    it('should reset auth failure counter on successful response', async () => {
      // First: simulate some 401s
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )
      await listPaymentMessages(MOCK_WIF)
      await listPaymentMessages(MOCK_WIF)

      // Then: successful response
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )
      await listPaymentMessages(MOCK_WIF)

      // Another 401 should work (counter was reset)
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )
      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
      // fetch was still called (not suppressed)
      expect(globalThis.fetch).toHaveBeenCalled()
    })

    it('should handle response with missing messages field', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200 })
      )

      const result = await listPaymentMessages(MOCK_WIF)
      expect(result).toEqual([])
    })
  })

  // =========================================================================
  // acknowledgeMessages
  // =========================================================================

  describe('acknowledgeMessages', () => {
    it('should return true for empty message IDs', async () => {
      const result = await acknowledgeMessages(MOCK_WIF, [])
      expect(result).toBe(true)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('should POST message IDs to acknowledge endpoint', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 200 })
      )

      const result = await acknowledgeMessages(MOCK_WIF, ['msg-1', 'msg-2'])

      expect(result).toBe(true)
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
      const url = fetchCall[0] as string
      expect(url).toContain('/api/v1/message/acknowledge')
      const options = fetchCall[1] as RequestInit
      expect(options.method).toBe('POST')
      const body = JSON.parse(options.body as string)
      expect(body.messageIds).toEqual(['msg-1', 'msg-2'])
    })

    it('should return false on server error', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 500 })
      )

      const result = await acknowledgeMessages(MOCK_WIF, ['msg-1'])
      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'))

      const result = await acknowledgeMessages(MOCK_WIF, ['msg-1'])
      expect(result).toBe(false)
    })

    it('should include auth headers in request', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 200 })
      )

      await acknowledgeMessages(MOCK_WIF, ['msg-1'])

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['x-bsv-auth-pubkey']).toBe(MOCK_PUB_KEY)
      expect(headers['x-bsv-auth-signature']).toBeDefined()
    })
  })

  // =========================================================================
  // checkForPayments
  // =========================================================================

  describe('checkForPayments', () => {
    it('should process payment messages and return new notifications', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response('', { status: 200 }) // acknowledge
        )

      const result = await checkForPayments(MOCK_WIF)

      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-abc')
      expect(result[0]!.amount).toBe(50000)
      expect(result[0]!.senderPublicKey).toBe(MOCK_PUB_KEY)
    })

    it('should not return duplicate notifications', async () => {
      const messages = [makePaymentMessage()]

      // First check: returns the notification
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response('', { status: 200 })
        )
      const first = await checkForPayments(MOCK_WIF)
      expect(first).toHaveLength(1)

      // Second check with same message: should return empty
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response('', { status: 200 })
        )
      const second = await checkForPayments(MOCK_WIF)
      expect(second).toHaveLength(0)
    })

    it('should skip non-payment messages (missing required fields)', async () => {
      const invalidMsg = makePaymentMessage({
        body: JSON.stringify({ note: 'just a message, not a payment' }),
      })
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [invalidMsg] }), { status: 200 })
      )

      const result = await checkForPayments(MOCK_WIF)
      expect(result).toHaveLength(0)
    })

    it('should handle messages with invalid JSON body', async () => {
      const badMsg = makePaymentMessage({ body: 'not-json' })
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [badMsg] }), { status: 200 })
      )

      const result = await checkForPayments(MOCK_WIF)
      expect(result).toHaveLength(0)
    })

    it('should acknowledge processed payment messages', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response('', { status: 200 })
        )

      await checkForPayments(MOCK_WIF)

      // Second fetch call should be the acknowledge
      expect(globalThis.fetch).toHaveBeenCalledTimes(2)
      const ackCall = vi.mocked(globalThis.fetch).mock.calls[1]!
      const ackUrl = ackCall[0] as string
      expect(ackUrl).toContain('/api/v1/message/acknowledge')
      const ackBody = JSON.parse((ackCall[1] as RequestInit).body as string)
      expect(ackBody.messageIds).toEqual(['msg-1'])
    })

    it('should not acknowledge when no payment messages found', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      await checkForPayments(MOCK_WIF)

      // Only one fetch call (list), no acknowledge
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('should handle empty message list gracefully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const result = await checkForPayments(MOCK_WIF)
      expect(result).toHaveLength(0)
    })

    it('should use default vout 0 and amount 0 when not provided', async () => {
      const msg = makePaymentMessage({
        body: JSON.stringify({
          txid: 'tx-minimal',
          derivationPrefix: 'p',
          derivationSuffix: 's',
          // vout and amount omitted
        }),
      })
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages: [msg] }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response('', { status: 200 }))

      const result = await checkForPayments(MOCK_WIF)
      expect(result).toHaveLength(1)
      expect(result[0]!.vout).toBe(0)
      expect(result[0]!.amount).toBe(0)
    })

    it('should persist notifications after processing', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response('', { status: 200 }))

      await checkForPayments(MOCK_WIF)

      const stored = localStorage.getItem('simply_sats_payment_notifications')
      expect(stored).not.toBeNull()
      const parsed = JSON.parse(stored!)
      expect(parsed).toHaveLength(1)
    })
  })

  // =========================================================================
  // resetMessageBoxAuth
  // =========================================================================

  describe('resetMessageBoxAuth', () => {
    it('should allow requests again after reset', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )

      // Exhaust the failure counter
      for (let i = 0; i < 10; i++) {
        await listPaymentMessages(MOCK_WIF)
      }

      // Should be suppressed now
      vi.mocked(globalThis.fetch).mockClear()
      await listPaymentMessages(MOCK_WIF)
      expect(globalThis.fetch).not.toHaveBeenCalled()

      // Reset and try again
      resetMessageBoxAuth()
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )
      await listPaymentMessages(MOCK_WIF)
      expect(globalThis.fetch).toHaveBeenCalledOnce()
    })
  })

  // =========================================================================
  // deriveKeyFromNotification
  // =========================================================================

  describe('deriveKeyFromNotification', () => {
    it('should invoke derive_child_key with correct parameters', async () => {
      const notification = makePaymentNotification({
        derivationPrefix: 'myprefix',
        derivationSuffix: 'mysuffix',
        senderPublicKey: MOCK_PUB_KEY,
      })

      mockTauriInvoke.mockResolvedValue({
        wif: 'L1derivedWif',
        address: '1DerivedAddr',
        pubKey: '02' + 'e'.repeat(64),
      })

      const result = await deriveKeyFromNotification('L1identityWif', notification)

      expect(result.wif).toBe('L1derivedWif')
      expect(result.address).toBe('1DerivedAddr')
      expect(mockTauriInvoke).toHaveBeenCalledWith('derive_child_key', {
        wif: 'L1identityWif',
        senderPubKey: MOCK_PUB_KEY,
        invoiceNumber: 'myprefix mysuffix',
      })
    })

    it('should propagate errors from Tauri', async () => {
      const notification = makePaymentNotification()
      mockTauriInvoke.mockRejectedValue(new Error('Key derivation failed'))

      await expect(
        deriveKeyFromNotification('L1identityWif', notification)
      ).rejects.toThrow('Key derivation failed')
    })
  })

  // =========================================================================
  // startPaymentListener
  // =========================================================================

  describe('startPaymentListener', () => {
    it('should return a cleanup function', () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListener(MOCK_WIF)
      expect(typeof cleanup).toBe('function')
      cleanup()
    })

    it('should call onNewPayment for new payments found on initial check', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response('', { status: 200 }))

      const onNewPayment = vi.fn()
      const cleanup = startPaymentListener(MOCK_WIF, onNewPayment)

      // Flush the initial promise-based check (no timers to advance for .then())
      await vi.advanceTimersByTimeAsync(0)

      expect(onNewPayment).toHaveBeenCalledWith(
        expect.objectContaining({ txid: 'tx-abc' })
      )

      cleanup()
    })

    it('should check periodically at specified interval', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListener(MOCK_WIF, undefined, 5000)

      // Flush initial check
      await vi.advanceTimersByTimeAsync(0)

      vi.mocked(globalThis.fetch).mockClear()

      // Advance to trigger one interval check
      await vi.advanceTimersByTimeAsync(5000)

      expect(globalThis.fetch).toHaveBeenCalled()

      cleanup()
    })

    it('should stop checking after cleanup is called', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListener(MOCK_WIF, undefined, 1000)
      await vi.advanceTimersByTimeAsync(0)

      cleanup()

      vi.mocked(globalThis.fetch).mockClear()
      await vi.advanceTimersByTimeAsync(5000)

      // No more calls after cleanup
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('should not start a second listener if already running', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup1 = startPaymentListener(MOCK_WIF)
      await vi.advanceTimersByTimeAsync(0)

      const cleanup2 = startPaymentListener(MOCK_WIF)

      // The second call should return a no-op cleanup
      cleanup2()

      // First listener should still be running
      vi.mocked(globalThis.fetch).mockClear()
      await vi.advanceTimersByTimeAsync(30000)

      expect(globalThis.fetch).toHaveBeenCalled()

      cleanup1()
    })

    it('should handle errors during initial check gracefully', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network down'))

      const onNewPayment = vi.fn()
      const cleanup = startPaymentListener(MOCK_WIF, onNewPayment)

      // Flush initial check
      await vi.advanceTimersByTimeAsync(0)

      expect(onNewPayment).not.toHaveBeenCalled()
      cleanup()
    })

    it('should handle errors during interval check gracefully', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListener(MOCK_WIF, undefined, 1000)
      await vi.advanceTimersByTimeAsync(0)

      // Now make fetch fail on next interval
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Temporary error'))

      // Advance one interval
      await vi.advanceTimersByTimeAsync(1000)

      cleanup()
    })
  })

  // =========================================================================
  // startPaymentListenerFromWif (deprecated wrapper)
  // =========================================================================

  describe('startPaymentListenerFromWif', () => {
    it('should delegate to startPaymentListener ignoring wif param', () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const onNewPayment = vi.fn()
      const cleanup = startPaymentListenerFromWif('L1someWif', onNewPayment, 5000)

      expect(typeof cleanup).toBe('function')
      cleanup()
    })
  })

  // =========================================================================
  // Store-Based Variants (S-121) — WIF never enters JS heap
  // =========================================================================

  describe('listPaymentMessagesFromStore', () => {
    it('should use sign_data_from_store instead of sign_data', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      await listPaymentMessagesFromStore(MOCK_PUB_KEY)

      // Should call sign_data_from_store with keyType 'identity', NOT sign_data with wif
      const signCalls = mockTauriInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'sign_data_from_store'
      )
      expect(signCalls.length).toBeGreaterThanOrEqual(1)
      expect(signCalls[0]![1]).toEqual(expect.objectContaining({ keyType: 'identity' }))

      // Should NOT call keys_from_wif (pubkey is passed directly)
      const wifCalls = mockTauriInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'keys_from_wif'
      )
      expect(wifCalls).toHaveLength(0)
    })

    it('should include provided pubkey in auth headers', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      await listPaymentMessagesFromStore(MOCK_PUB_KEY)

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['x-bsv-auth-pubkey']).toBe(MOCK_PUB_KEY)
    })

    it('should return messages on success', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages }), { status: 200 })
      )

      const result = await listPaymentMessagesFromStore(MOCK_PUB_KEY)
      expect(result).toEqual(messages)
    })

    it('should suppress repeated 401 failures', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 401 })
      )

      for (let i = 0; i < 10; i++) {
        await listPaymentMessagesFromStore(MOCK_PUB_KEY)
      }

      vi.mocked(globalThis.fetch).mockClear()
      const result = await listPaymentMessagesFromStore(MOCK_PUB_KEY)
      expect(result).toEqual([])
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('acknowledgeMessagesFromStore', () => {
    it('should return true for empty message IDs', async () => {
      const result = await acknowledgeMessagesFromStore(MOCK_PUB_KEY, [])
      expect(result).toBe(true)
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('should POST message IDs using store-based auth', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response('', { status: 200 })
      )

      const result = await acknowledgeMessagesFromStore(MOCK_PUB_KEY, ['msg-1', 'msg-2'])
      expect(result).toBe(true)

      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]!
      const options = fetchCall[1] as RequestInit
      const headers = options.headers as Record<string, string>
      expect(headers['x-bsv-auth-pubkey']).toBe(MOCK_PUB_KEY)
    })
  })

  describe('checkForPaymentsFromStore', () => {
    it('should process payments using store-based auth', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response('', { status: 200 })
        )

      const result = await checkForPaymentsFromStore(MOCK_PUB_KEY)

      expect(result).toHaveLength(1)
      expect(result[0]!.txid).toBe('tx-abc')

      // Verify no WIF-based commands were used
      const wifCalls = mockTauriInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'sign_data' || c[0] === 'keys_from_wif'
      )
      expect(wifCalls).toHaveLength(0)
    })
  })

  describe('startPaymentListenerFromStore', () => {
    it('should return a cleanup function', () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListenerFromStore(MOCK_PUB_KEY)
      expect(typeof cleanup).toBe('function')
      cleanup()
    })

    it('should call onNewPayment for payments found on initial check', async () => {
      const messages = [makePaymentMessage()]
      vi.mocked(globalThis.fetch)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ messages }), { status: 200 })
        )
        .mockResolvedValueOnce(new Response('', { status: 200 }))

      const onNewPayment = vi.fn()
      const cleanup = startPaymentListenerFromStore(MOCK_PUB_KEY, onNewPayment)

      await vi.advanceTimersByTimeAsync(0)

      expect(onNewPayment).toHaveBeenCalledWith(
        expect.objectContaining({ txid: 'tx-abc' })
      )

      cleanup()
    })

    it('should never invoke sign_data or keys_from_wif (no WIF in JS)', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListenerFromStore(MOCK_PUB_KEY)
      await vi.advanceTimersByTimeAsync(0)

      // Verify only store-based commands were used
      const wifCommands = mockTauriInvoke.mock.calls.filter(
        (c: unknown[]) => c[0] === 'sign_data' || c[0] === 'keys_from_wif'
      )
      expect(wifCommands).toHaveLength(0)

      cleanup()
    })

    it('should check periodically at specified interval', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListenerFromStore(MOCK_PUB_KEY, undefined, 5000)
      await vi.advanceTimersByTimeAsync(0)

      vi.mocked(globalThis.fetch).mockClear()
      await vi.advanceTimersByTimeAsync(5000)

      expect(globalThis.fetch).toHaveBeenCalled()

      cleanup()
    })

    it('should stop checking after cleanup is called', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ messages: [] }), { status: 200 })
      )

      const cleanup = startPaymentListenerFromStore(MOCK_PUB_KEY, undefined, 1000)
      await vi.advanceTimersByTimeAsync(0)

      cleanup()

      vi.mocked(globalThis.fetch).mockClear()
      await vi.advanceTimersByTimeAsync(5000)

      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })
})
