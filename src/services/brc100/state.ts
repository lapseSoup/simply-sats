/**
 * BRC-100 State Management
 *
 * Centralized state for the BRC-100 service.
 * Manages wallet keys reference for HTTP server requests.
 */

import type { WalletKeys } from '../wallet'

// Current wallet keys (set by App component for HTTP server requests)
let currentWalletKeys: WalletKeys | null = null

/**
 * Set the wallet keys for BRC-100 operations
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
