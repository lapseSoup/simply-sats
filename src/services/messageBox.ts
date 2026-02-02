/**
 * MessageBox Service for Simply Sats
 *
 * Integrates with the BSV MessageBox/PeerServ system to receive payment notifications.
 * When someone sends BSV to our identity key using BSV Desktop (or any BRC-29 wallet),
 * they send a message containing the derivation parameters needed to spend the funds.
 *
 * Without this message, we can't derive the private key to spend payments sent to us!
 */

import { PrivateKey, PublicKey, Hash, Random } from '@bsv/sdk'

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

// Load persisted notifications
export function loadNotifications(): void {
  try {
    const saved = localStorage.getItem('simply_sats_payment_notifications')
    if (saved) {
      paymentNotifications = JSON.parse(saved)
      console.log(`Loaded ${paymentNotifications.length} payment notifications from storage`)
    }
  } catch (e) {
    console.error('Failed to load payment notifications:', e)
  }
}

// Save notifications to storage
function saveNotifications(): void {
  try {
    localStorage.setItem('simply_sats_payment_notifications', JSON.stringify(paymentNotifications))
  } catch (e) {
    console.error('Failed to save payment notifications:', e)
  }
}

/**
 * Create authentication headers for MessageBox API
 * This is a simplified BRC-103 auth implementation
 */
async function createAuthHeaders(
  privateKey: PrivateKey,
  method: string,
  path: string,
  body?: string
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  // Generate random bytes for nonce
  const nonceBytes = Random(16)
  const nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  // Create the message to sign
  const messageToSign = `${method}${path}${timestamp}${nonce}${body || ''}`
  const messageHash = Hash.sha256(new TextEncoder().encode(messageToSign))

  // Sign with identity key
  const signature = privateKey.sign(messageHash)

  return {
    'Content-Type': 'application/json',
    'x-bsv-auth-pubkey': privateKey.toPublicKey().toString(),
    'x-bsv-auth-timestamp': timestamp,
    'x-bsv-auth-nonce': nonce,
    'x-bsv-auth-signature': signature.toDER('hex') as string
  }
}

/**
 * List messages from our payment inbox
 */
export async function listPaymentMessages(identityPrivateKey: PrivateKey): Promise<PaymentMessage[]> {
  const path = `/api/v1/message/${PAYMENT_INBOX}`

  try {
    const headers = await createAuthHeaders(identityPrivateKey, 'GET', path)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'GET',
      headers
    })

    if (!response.ok) {
      if (response.status === 404) {
        return [] // No messages
      }
      const errorText = await response.text()
      console.error('MessageBox error:', response.status, errorText)
      return []
    }

    const data = await response.json()
    return data.messages || []
  } catch (error) {
    console.error('Failed to list payment messages:', error)
    return []
  }
}

/**
 * Acknowledge (delete) messages we've processed
 */
export async function acknowledgeMessages(
  identityPrivateKey: PrivateKey,
  messageIds: string[]
): Promise<boolean> {
  if (messageIds.length === 0) return true

  const path = `/api/v1/message/acknowledge`
  const body = JSON.stringify({ messageIds })

  try {
    const headers = await createAuthHeaders(identityPrivateKey, 'POST', path, body)

    const response = await fetch(`${MESSAGEBOX_HOST}${path}`, {
      method: 'POST',
      headers,
      body
    })

    return response.ok
  } catch (error) {
    console.error('Failed to acknowledge messages:', error)
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
      console.log('Message is not a payment notification:', bodyData)
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
    console.error('Failed to parse payment message:', e)
    return null
  }
}

/**
 * Check for new payment messages and process them
 */
export async function checkForPayments(identityPrivateKey: PrivateKey): Promise<PaymentNotification[]> {
  console.log('Checking MessageBox for payment notifications...')

  const messages = await listPaymentMessages(identityPrivateKey)
  console.log(`Found ${messages.length} messages in payment inbox`)

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
        console.log('New payment notification:', notification)
      }

      processedIds.push(msg.messageId)
    }
  }

  // Acknowledge processed messages
  if (processedIds.length > 0) {
    await acknowledgeMessages(identityPrivateKey, processedIds)
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

/**
 * Derive the private key for a payment using the notification info
 */
export function deriveKeyFromNotification(
  identityPrivateKey: PrivateKey,
  notification: PaymentNotification
): { privateKey: PrivateKey; address: string } {
  const senderPubKey = PublicKey.fromString(notification.senderPublicKey)

  // Construct the invoice number in BRC-29 format
  const invoiceNumber = `${notification.derivationPrefix} ${notification.derivationSuffix}`

  // Use SDK's BRC-42 derivation
  const childPrivKey = identityPrivateKey.deriveChild(senderPubKey, invoiceNumber)
  const address = childPrivKey.toPublicKey().toAddress()

  return { privateKey: childPrivKey, address }
}

/**
 * Start periodic checking for payment messages
 */
export function startPaymentListener(
  identityPrivateKey: PrivateKey,
  onNewPayment?: (notification: PaymentNotification) => void,
  intervalMs = 30000 // Check every 30 seconds
): () => void {
  if (isListening) {
    console.log('Payment listener already running')
    return () => {}
  }

  isListening = true
  console.log('Starting payment message listener...')

  // Initial check
  checkForPayments(identityPrivateKey).then(newPayments => {
    for (const payment of newPayments) {
      onNewPayment?.(payment)
    }
  })

  // Set up interval
  const intervalId = setInterval(async () => {
    try {
      const newPayments = await checkForPayments(identityPrivateKey)
      for (const payment of newPayments) {
        onNewPayment?.(payment)
      }
    } catch (e) {
      console.error('Payment check failed:', e)
    }
  }, intervalMs)

  // Return cleanup function
  return () => {
    clearInterval(intervalId)
    isListening = false
    console.log('Payment listener stopped')
  }
}

export type { PaymentNotification }
