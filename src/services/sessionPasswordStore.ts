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

/**
 * Internal storage uses Uint8Array so the password bytes can be zeroed on clear.
 * JS strings are immutable and linger in V8 heap until GC; typed arrays can be
 * overwritten in-place, giving us deterministic scrubbing.
 */
let _sessionPassword: Uint8Array | null = null

const _encoder = new TextEncoder()
const _decoder = new TextDecoder()

/** Store the session password (call after successful unlock). */
export function setSessionPassword(password: string | null): void {
  // Scrub previous buffer before replacing
  if (_sessionPassword) {
    _sessionPassword.fill(0)
  }
  _sessionPassword = password != null ? _encoder.encode(password) : null
}

/** Read the current session password (synchronous, never stale). */
export function getSessionPassword(): string | null {
  return _sessionPassword != null ? _decoder.decode(_sessionPassword) : null
}

/** Clear the session password (call on lock / delete). Zero the buffer first. */
export function clearSessionPassword(): void {
  if (_sessionPassword) {
    _sessionPassword.fill(0)
  }
  _sessionPassword = null
}
