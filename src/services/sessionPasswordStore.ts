/**
 * Module-level session password store.
 *
 * Stores the user's session password in a plain module variable rather than
 * React state.  This eliminates an entire class of bugs caused by stale
 * closures, ref-sync timing, and React re-render ordering when the password
 * is needed inside useCallback hooks (e.g. account creation, import).
 *
 * Note: Account SWITCHING no longer needs this — it derives keys directly
 * from the Rust key store's mnemonic. But account creation and import still
 * need the password to encrypt new keys in the database.
 *
 * The password is:
 *  - set on successful unlock / wallet creation / wallet restore / JSON import
 *  - cleared on wallet lock or wallet deletion
 *  - read synchronously by any code that needs it (no async, no hooks)
 *
 * Security: identical to the previous React-state approach — the password
 * lives in JS heap memory and is cleared when the wallet locks.
 */

/**
 * Sentinel value for "wallet is unlocked but no password was set."
 * Distinct from null (locked) and any real password string.
 * Note: empty string is falsy in JS — use `=== null` to check "no session."
 */
export const NO_PASSWORD = '' as const

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
