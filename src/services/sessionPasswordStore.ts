/**
 * Module-level session password store.
 *
 * Stores the user's session password in a plain module variable rather than
 * React state.  This eliminates an entire class of bugs caused by stale
 * closures, ref-sync timing, and React re-render ordering when the password
 * is needed inside useCallback hooks (e.g. account switching).
 *
 * The password is:
 *  - set on successful unlock / wallet creation / wallet restore / JSON import
 *  - cleared on wallet lock or wallet deletion
 *  - read synchronously by any code that needs it (no async, no hooks)
 *
 * Security: identical to the previous React-state approach — the password
 * lives in JS heap memory and is cleared when the wallet locks.
 */

let _sessionPassword: string | null = null

/** Store the session password (call after successful unlock). */
export function setSessionPassword(password: string | null): void {
  _sessionPassword = password
}

/** Read the current session password (synchronous, never stale). */
export function getSessionPassword(): string | null {
  return _sessionPassword
}

/** Clear the session password (call on lock / delete). */
export function clearSessionPassword(): void {
  _sessionPassword = null
}
