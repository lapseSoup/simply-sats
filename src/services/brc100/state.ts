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
 *
 * Call sites that update this state:
 *   - WalletContext.tsx: setWallet() → setWalletKeys()      (all wallet state changes)
 *   - useWalletLock.ts: lockWallet(), unlockWallet()         (lock/unlock events)
 *   - useBRC100.ts: useEffect on wallet change               (wallet prop changes)
 *   - RestoreModal.tsx: after restore/import                 (wallet creation)
 */

import type { WalletKeys } from '../wallet'
import { brc100Logger } from '../logger'

// Current wallet keys (set by App component for HTTP server requests)
let currentWalletKeys: WalletKeys | null = null

// Identity address at the time setWalletKeys() was last called — used to detect divergence.
let _lastSetIdentityAddress: string | null = null

/**
 * Set the wallet keys for BRC-100 operations.
 * Must be called after every account switch, unlock, and lock event.
 */
export function setWalletKeys(keys: WalletKeys | null): void {
  currentWalletKeys = keys
  _lastSetIdentityAddress = keys?.identityAddress ?? null
}

/**
 * Get the current wallet keys.
 *
 * If you know which account should be active, prefer assertKeysMatchAccount()
 * to detect stale key state before signing.
 */
export function getWalletKeys(): WalletKeys | null {
  return currentWalletKeys
}

/**
 * Assert that the current BRC-100 keys belong to the expected account.
 * Returns true if the keys match (or no keys are loaded, which is valid when locked).
 * Returns false and logs a warning when keys are present but belong to a different account.
 *
 * Use this before any signing operation when you know the expected active account.
 */
export function assertKeysMatchAccount(expectedIdentityAddress: string): boolean {
  if (!currentWalletKeys) return true // No keys loaded — valid locked state
  const matches = currentWalletKeys.identityAddress === expectedIdentityAddress
  if (!matches) {
    brc100Logger.warn(
      '[BRC-100] Key divergence detected: BRC-100 keys do not match the expected account. ' +
      'setWalletKeys() may not have been called after the last account switch.',
      {
        expected: expectedIdentityAddress.slice(0, 8) + '…',
        actual: currentWalletKeys.identityAddress.slice(0, 8) + '…',
        lastSet: _lastSetIdentityAddress?.slice(0, 8) + '…',
      }
    )
  }
  return matches
}

/**
 * Check if wallet keys are available
 */
export function hasWalletKeys(): boolean {
  return currentWalletKeys !== null
}
