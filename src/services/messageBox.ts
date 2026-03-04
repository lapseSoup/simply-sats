/**
 * MessageBox Service for Simply Sats
 *
 * Integrates with the BSV MessageBox/PeerServ system to receive payment notifications.
 * When someone sends BSV to our identity key using BSV Desktop (or any BRC-29 wallet),
 * they send a message containing the derivation parameters needed to spend the funds.
 *
 * Without this message, we can't derive the private key to spend payments sent to us!
 */

import { tauriInvoke } from '../utils/tauri'
import { messageLogger } from './logger'
import { STORAGE_KEYS } from '../infrastructure/storage/localStorage'

// MessageBox server endpoint
const MESSAGEBOX_HOST = 'https://messagebox.babbage.systems'

// Payment message box name (standard for BRC-29 payments)
const PAYMENT_INBOX = 'payment_inbox'

// Message types we care about
interface PaymentMessage {
  messageId: string
  sender: string // sender's public key
  body: string   // JSON containing payment info
  createdAt: string
}

interface PaymentNotification {
  txid: string
  vout: number
  amount: number
  derivationPrefix: string
  derivationSuffix: string
  senderPublicKey: string
}

// Store for received payment notifications
let paymentNotifications: PaymentNotification[] = []
let isListening = false

// Suppress repeated 401 errors — after first failure, back off exponentially
// to avoid flooding the console with "Mutual-authentication failed!" every 30s
let _authFailureCount = 0
let _lastAuthFailureTime = 0
const AUTH_FAILURE_MAX_SUPPRESS = 10 // After 10 failures, stop trying until reset
const AUTH_FAILURE_RESET_MS = 5 * 60 * 1000 // S-76: Allow one retry after 5 min cooldown

/** Reset auth failure counter (call on account switch or app restart) */
export function resetMessageBoxAuth(): void { _authFailureCount = 0 }

// Load persisted notifications
export function loadNotifications(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.PAYMENT_NOTIFICATIONS)
    if (saved) {
      paymentNotifications = JSON.parse(saved)
      messageLogger.info('Loaded payment notifications from storage', { count: paymentNotifications.length })
    }
  } catch (e) {
    messageLogger.error('Failed to load payment notifications', e)
  }
}

// Save notifications to storage
function saveNotifications(): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_NOTIFICATIONS, JSON.stringify(paymentNotifications))
  } catch (e) {
    messageLogger.error('Failed to save payment notifications', e)
  }
}

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

/**
 * Create authentication headers for MessageBox API
 * This is a simplified BRC-103 auth implementation
 */
async function createAuthHeaders(
  identityWif: string,
  method: string,
  path: string,
  body?: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  // Generate random bytes for nonce (Web Crypto API)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  // Create the message to sign
  const messageToSign = `${method}${path}${timestamp}${nonce}${body || ''}`

  // Hash the message with SHA-256 (first hash)
  const messageHashHex = await tauriInvoke<string>('sha256_hash', { data: messageToSign })

  // sign_data internally SHA-256 hashes before ECDSA signing (second hash),
  // matching the original @bsv/sdk double-hash: Hash.sha256(msg) -> privateKey.sign(hash)
  const signatureDerHex = await tauriInvoke<string>('sign_data', {
    wif: identityWif,
    data: Array.from(hexToBytes(messageHashHex))
  })

  // Get public key from WIF
  const keyInfo = await tauriInvoke<{ wif: string; address: string; pubKey: string }>(
    'keys_from_wif', { wif: identityWif }
  )

  return {
    'Content-Type': 'application/json',
    'x-bsv-auth-pubkey': keyInfo.pubKey,
    'x-bsv-auth-timestamp': timestamp,
    'x-bsv-auth-nonce': nonce,
    'x-bsv-auth-signature': signatureDerHex
  }
}

/**
 * Create authentication headers using the Rust key store (S-121).
 * The identity WIF never leaves Rust memory — signing is done via
 * `sign_data_from_store` and the public key is passed in directly.
 */
async function createAuthHeadersFromStore(
  identityPubKey: string,
  method: string,
  path: string,
  body?: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16))
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const messageToSign = `${method}${path}${timestamp}${nonce}${body || ''}`

  const messageHashHex = await tauriInvoke<string>('sha256_hash', { data: messageToSign })

  // S-121: Use store-based signing — WIF never enters JS heap
  const signatureDerHex = await tauriInvoke<string>('sign_data_from_store', {
    data: Array.from(hexToBytes(messageHashHex)),
    keyType: 'identity'
  })

  return {
    'Content-Type': 'application/json',
    'x-bsv-auth-pubkey': identityPubKey,
    'x-bsv-auth-timestamp': timestamp,
    'x-bsv-auth-nonce': nonce,
    'x-bsv-auth-signature': signatureDerHex
  }
}

/**
 * List messages from our payment inbox
 */
export async function listPaymentMessages(identityWif: string): Promise<PaymentMessage[]> {
  // Skip if we've had too many auth failures (don't spam the API)
  // S-76: Allow one retry after cooldown period to detect recovered auth
  if (_authFailureCount >= AUTH_FAILURE_MAX_SUPPRESS) {
    if (Date.now() - _lastAuthFailureTime > AUTH_FAILURE_RESET_MS) {
      _authFailureCount = 0
    } else {
      return []
    }
  }

  const path = `/api/v1/message/${PAYMENT_INBOX}`

  try {
    const headers = await createAuthHeaders(identityWif, 'GET', path)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      if (response.status === 404) {
        return [] // No messages
      }
      if (response.status === 401) {
        _authFailureCount++
        _lastAuthFailureTime = Date.now()
        if (_authFailureCount === 1) {
          messageLogger.warn('MessageBox auth failed — will suppress further attempts', { status: 401 })
        }
        return []
      }
      const errorText = await response.text()
      messageLogger.error('MessageBox error', undefined, { status: response.status, errorText })
      return []
    }

    // Successful response — reset failure counter
    _authFailureCount = 0

    const data = await response.json()
    return data.messages || []
  } catch (error) {
    messageLogger.error('Failed to list payment messages', error)
    return []
  }
}

/**
 * Acknowledge (delete) messages we've processed
 */
export async function acknowledgeMessages(
  identityWif: string,
  messageIds: string[]
): Promise<boolean> {
  if (messageIds.length === 0) return true

  const path = `/api/v1/message/acknowledge`
  const body = JSON.stringify({ messageIds })

  try {
    const headers = await createAuthHeaders(identityWif, 'POST', path, body)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'POST',
      headers,
      body
    })

    return response.ok
  } catch (error) {
    messageLogger.error('Failed to acknowledge messages', error)
    return false
  }
}

/**
 * Process a payment message and extract the notification
 */
function parsePaymentMessage(message: PaymentMessage): PaymentNotification | null {
  try {
    const bodyData = JSON.parse(message.body)

    // Check if this is a payment notification
    if (!bodyData.txid || !bodyData.derivationPrefix || !bodyData.derivationSuffix) {
      messageLogger.debug('Message is not a payment notification', { bodyData })
      return null
    }

    return {
      txid: bodyData.txid,
      vout: bodyData.vout || 0,
      amount: bodyData.amount || 0,
      derivationPrefix: bodyData.derivationPrefix,
      derivationSuffix: bodyData.derivationSuffix,
      senderPublicKey: message.sender
    }
  } catch (e) {
    messageLogger.error('Failed to parse payment message', e)
    return null
  }
}

/**
 * Check for new payment messages and process them
 */
export async function checkForPayments(identityWif: string): Promise<PaymentNotification[]> {
  messageLogger.info('Checking MessageBox for payment notifications')

  const messages = await listPaymentMessages(identityWif)
  messageLogger.info('Found messages in payment inbox', { count: messages.length })

  const newNotifications: PaymentNotification[] = []
  const processedIds: string[] = []

  for (const msg of messages) {
    const notification = parsePaymentMessage(msg)
    if (notification) {
      // Check if we already have this notification
      const exists = paymentNotifications.some(
        n => n.txid === notification.txid && n.vout === notification.vout
      )

      if (!exists) {
        paymentNotifications.push(notification)
        newNotifications.push(notification)
        messageLogger.info('New payment notification', { txid: notification.txid, vout: notification.vout, amount: notification.amount })
      }

      processedIds.push(msg.messageId)
    }
  }

  // Acknowledge processed messages
  if (processedIds.length > 0) {
    await acknowledgeMessages(identityWif, processedIds)
    saveNotifications()
  }

  return newNotifications
}

/**
 * Get the derivation info for a specific UTXO
 */
export function getDerivationForUtxo(txid: string, vout: number): PaymentNotification | null {
  return paymentNotifications.find(n => n.txid === txid && n.vout === vout) || null
}

/**
 * Get all stored payment notifications
 */
export function getPaymentNotifications(): PaymentNotification[] {
  return [...paymentNotifications]
}

/**
 * Add a manual payment notification (for debugging/recovery)
 */
export function addManualNotification(notification: PaymentNotification): void {
  const exists = paymentNotifications.some(
    n => n.txid === notification.txid && n.vout === notification.vout
  )

  if (!exists) {
    paymentNotifications.push(notification)
    saveNotifications()
  }
}

/**
 * Clear all notifications (for testing)
 */
export function clearNotifications(): void {
  paymentNotifications = []
  saveNotifications()
}

// ==================== Store-Based Variants (S-121) ====================
// These functions use the Rust key store for signing, so the identity WIF
// never enters the JavaScript heap. They accept identityPubKey instead of WIF.

/**
 * List messages from our payment inbox using store-based auth (S-121).
 */
export async function listPaymentMessagesFromStore(identityPubKey: string): Promise<PaymentMessage[]> {
  if (_authFailureCount >= AUTH_FAILURE_MAX_SUPPRESS) {
    if (Date.now() - _lastAuthFailureTime > AUTH_FAILURE_RESET_MS) {
      _authFailureCount = 0
    } else {
      return []
    }
  }

  const path = `/api/v1/message/${PAYMENT_INBOX}`

  try {
    const headers = await createAuthHeadersFromStore(identityPubKey, 'GET', path)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      if (response.status === 404) return []
      if (response.status === 401) {
        _authFailureCount++
        _lastAuthFailureTime = Date.now()
        if (_authFailureCount === 1) {
          messageLogger.warn('MessageBox auth failed — will suppress further attempts', { status: 401 })
        }
        return []
      }
      const errorText = await response.text()
      messageLogger.error('MessageBox error', undefined, { status: response.status, errorText })
      return []
    }

    _authFailureCount = 0
    const data = await response.json()
    return data.messages || []
  } catch (error) {
    messageLogger.error('Failed to list payment messages', error)
    return []
  }
}

/**
 * Acknowledge messages using store-based auth (S-121).
 */
export async function acknowledgeMessagesFromStore(
  identityPubKey: string,
  messageIds: string[]
): Promise<boolean> {
  if (messageIds.length === 0) return true

  const path = `/api/v1/message/acknowledge`
  const body = JSON.stringify({ messageIds })

  try {
    const headers = await createAuthHeadersFromStore(identityPubKey, 'POST', path, body)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'POST',
      headers,
      body
    })

    return response.ok
  } catch (error) {
    messageLogger.error('Failed to acknowledge messages', error)
    return false
  }
}

/**
 * Check for new payment messages using store-based auth (S-121).
 */
export async function checkForPaymentsFromStore(identityPubKey: string): Promise<PaymentNotification[]> {
  messageLogger.info('Checking MessageBox for payment notifications (store-based)')

  const messages = await listPaymentMessagesFromStore(identityPubKey)
  messageLogger.info('Found messages in payment inbox', { count: messages.length })

  const newNotifications: PaymentNotification[] = []
  const processedIds: string[] = []

  for (const msg of messages) {
    const notification = parsePaymentMessage(msg)
    if (notification) {
      const exists = paymentNotifications.some(
        n => n.txid === notification.txid && n.vout === notification.vout
      )

      if (!exists) {
        paymentNotifications.push(notification)
        newNotifications.push(notification)
        messageLogger.info('New payment notification', { txid: notification.txid, vout: notification.vout, amount: notification.amount })
      }

      processedIds.push(msg.messageId)
    }
  }

  if (processedIds.length > 0) {
    await acknowledgeMessagesFromStore(identityPubKey, processedIds)
    saveNotifications()
  }

  return newNotifications
}

/**
 * Start periodic checking for payment messages using the Rust key store (S-121).
 * The identity WIF never enters the JavaScript heap — only the public key
 * is passed in, and all signing is delegated to `sign_data_from_store`.
 */
export function startPaymentListenerFromStore(
  identityPubKey: string,
  onNewPayment?: (notification: PaymentNotification) => void,
  intervalMs = 30000
): () => void {
  if (isListening) {
    messageLogger.debug('Payment listener already running')
    return () => {}
  }

  isListening = true
  messageLogger.info('Starting payment message listener (store-based)')

  checkForPaymentsFromStore(identityPubKey).then(newPayments => {
    for (const payment of newPayments) {
      onNewPayment?.(payment)
    }
  }).catch(e => {
    messageLogger.error('Initial payment check failed', e)
  })

  const intervalId = setInterval(async () => {
    try {
      const newPayments = await checkForPaymentsFromStore(identityPubKey)
      for (const payment of newPayments) {
        onNewPayment?.(payment)
      }
    } catch (e) {
      messageLogger.error('Payment check failed', e)
    }
  }, intervalMs)

  return () => {
    clearInterval(intervalId)
    isListening = false
    messageLogger.info('Payment listener stopped')
  }
}

/**
 * Derive the private key for a payment using the notification info.
 * Returns the child WIF and address via Tauri's BRC-42 derivation command.
 */
export async function deriveKeyFromNotification(
  identityWif: string,
  notification: PaymentNotification
): Promise<{ wif: string; address: string }> {
  // Construct the invoice number in BRC-29 format
  const invoiceNumber = `${notification.derivationPrefix} ${notification.derivationSuffix}`

  // Use Tauri's BRC-42 derivation
  const result = await tauriInvoke<{ wif: string; address: string; pubKey: string }>(
    'derive_child_key',
    {
      wif: identityWif,
      senderPubKey: notification.senderPublicKey,
      invoiceNumber
    }
  )

  return { wif: result.wif, address: result.address }
}

/**
 * Start periodic checking for payment messages.
 * Accepts a WIF string for the identity key.
 */
export function startPaymentListener(
  identityWif: string,
  onNewPayment?: (notification: PaymentNotification) => void,
  intervalMs = 30000 // Check every 30 seconds
): () => void {
  if (isListening) {
    messageLogger.debug('Payment listener already running')
    return () => {}
  }

  isListening = true
  messageLogger.info('Starting payment message listener')

  // Initial check
  checkForPayments(identityWif).then(newPayments => {
    for (const payment of newPayments) {
      onNewPayment?.(payment)
    }
  }).catch(e => {
    messageLogger.error('Initial payment check failed', e)
  })

  // Set up interval
  const intervalId = setInterval(async () => {
    try {
      const newPayments = await checkForPayments(identityWif)
      for (const payment of newPayments) {
        onNewPayment?.(payment)
      }
    } catch (e) {
      messageLogger.error('Payment check failed', e)
    }
  }, intervalMs)

  // Return cleanup function
  return () => {
    clearInterval(intervalId)
    isListening = false
    messageLogger.info('Payment listener stopped')
  }
}

/**
 * Start periodic checking for payment messages using a WIF string.
 *
 * @deprecated Use `startPaymentListener` directly — it now accepts WIF strings.
 */
export function startPaymentListenerFromWif(
  identityWif: string,
  onNewPayment?: (notification: PaymentNotification) => void,
  intervalMs = 30000
): () => void {
  return startPaymentListener(identityWif, onNewPayment, intervalMs)
}

export type { PaymentNotification }
