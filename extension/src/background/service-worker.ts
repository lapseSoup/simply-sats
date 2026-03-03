/**
 * Simply Sats — Chrome Extension Service Worker
 *
 * Runs persistently in the background. Responsible for:
 * - Wallet state management (survives popup open/close)
 * - Auto-lock timer via chrome.alarms
 * - Message routing between popup, content scripts, and native host
 * - Badge text updates for balance display
 *
 * @module extension/background/service-worker
 */

// ============================================
// Types
// ============================================

interface WalletState {
  isLocked: boolean
  hasWallet: boolean
  currentAccountIndex: number
}

type MessageHandler = (
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | undefined

interface ExtensionMessage {
  type: string
  payload?: unknown
}

// ============================================
// State
// ============================================

const AUTO_LOCK_ALARM = 'simply-sats-auto-lock'
const DEFAULT_LOCK_MINUTES = 10

let walletState: WalletState = {
  isLocked: true,
  hasWallet: false,
  currentAccountIndex: 0,
}

// ============================================
// Message Handling
// ============================================

const messageHandler: MessageHandler = (message, _sender, sendResponse) => {
  switch (message.type) {
    case 'GET_WALLET_STATE':
      sendResponse({ success: true, state: walletState })
      return false

    case 'SET_WALLET_STATE':
      walletState = { ...walletState, ...(message.payload as Partial<WalletState>) }
      sendResponse({ success: true })
      return false

    case 'UNLOCK_WALLET':
      walletState.isLocked = false
      resetAutoLockTimer()
      sendResponse({ success: true })
      return false

    case 'LOCK_WALLET':
      walletState.isLocked = true
      chrome.alarms.clear(AUTO_LOCK_ALARM)
      sendResponse({ success: true })
      return false

    case 'RESET_AUTO_LOCK':
      resetAutoLockTimer()
      sendResponse({ success: true })
      return false

    case 'PING':
      sendResponse({ success: true, pong: true })
      return false

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` })
      return false
  }
}

chrome.runtime.onMessage.addListener(messageHandler)

// ============================================
// Auto-Lock Timer
// ============================================

function resetAutoLockTimer(): void {
  chrome.alarms.clear(AUTO_LOCK_ALARM)

  chrome.storage.local.get(['auto_lock_minutes'], (result) => {
    const minutes = (result.auto_lock_minutes as number) || DEFAULT_LOCK_MINUTES
    chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: minutes })
  })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) {
    walletState.isLocked = true
    // Notify any open popups
    chrome.runtime.sendMessage({ type: 'WALLET_LOCKED' }).catch(() => {
      // No popup open — that's fine
    })
  }
})

// ============================================
// Installation
// ============================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First install — set default preferences
    chrome.storage.local.set({
      auto_lock_minutes: DEFAULT_LOCK_MINUTES,
      display_unit: 'sats',
    })
  }
})

// ============================================
// Badge
// ============================================

export function updateBadge(balanceSats: number): void {
  const text = balanceSats > 0
    ? balanceSats >= 100_000_000
      ? `${(balanceSats / 100_000_000).toFixed(1)}B`
      : balanceSats >= 1_000_000
        ? `${(balanceSats / 1_000_000).toFixed(1)}M`
        : balanceSats >= 1_000
          ? `${(balanceSats / 1_000).toFixed(0)}k`
          : String(balanceSats)
    : ''

  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color: '#f7931a' })
}
