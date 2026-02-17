/**
 * BRC-100 State Management
 *
 * Centralized state for the BRC-100 service.
 * Manages wallet keys reference for HTTP server requests.
 *
 * ARCHITECTURE NOTE (ARCH-6):
 * currentWalletKeys is module-level mutable state, NOT React state.
 * It can silently diverge from WalletContext if setWalletKeys() is not called
 * after every account switch or wallet lock/unlock event.
 * The proper fix is to inject keys as parameters to BRC-100 action functions.
 * Until that refactor is complete, callers MUST call setWalletKeys() immediately
 * after any wallet state change.
 */

import type { WalletKeys } from '../wallet'

// Current wallet keys (set by App component for HTTP server requests)
let currentWalletKeys: WalletKeys | null = null

/**
 * Set the wallet keys for BRC-100 operations.
 * Must be called after every account switch, unlock, and lock event.
 */
export function setWalletKeys(keys: WalletKeys | null): void {
  currentWalletKeys = keys
}

/**
 * Get the current wallet keys
 */
export function getWalletKeys(): WalletKeys | null {
  return currentWalletKeys
}

/**
 * Check if wallet keys are available
 */
export function hasWalletKeys(): boolean {
  return currentWalletKeys !== null
}
