# Simply Sats — Full Code Review v4
**Date:** 2026-02-17
**Baseline:** `ed2e004` (review 6 remediation — security, race conditions, code quality)
**Tests:** 1593 passing / 64 files
**TypeScript:** 0 errors
**ESLint:** 0 errors, 34 warnings (architectural layer violations)

---

## Overall Rating: 7.5 / 10

Strong cryptographic foundations. Professional defense-in-depth architecture with keys in Rust memory, AES-256-GCM, PBKDF2 at 600k iterations, CSRF protection, and constant-time session token comparison. The four HIGH bugs below should be fixed before the next release; architecture debt (error boundaries, WoC retry) is the sprint after.

---

## Phase 1 — Security

### HIGH

**S-1 — `saveWalletUnprotected()` stores WIF/mnemonic in plaintext**
`src/services/wallet/storage.ts:112-131`
The function passes keys as if they were `EncryptedData` with mode `'unprotected'`. On Tauri plugin fallback (or non-Tauri env), keys land in `localStorage` in plaintext. Remove unprotected mode entirely or, at minimum, restrict it to identity key only and display a prominent warning.

**S-2 — No integrity check after `saveToSecureStorage()`**
`src/services/wallet/storage.ts:37-62`
The function returns a boolean but callers don't verify success before removing plaintext from localStorage. A silent save failure leaves keys in localStorage unencrypted. Add a read-back verify step after each save.

### MEDIUM

**S-3 — Session key rotation race condition**
`src/services/secureStorage.ts:47-114`
Two concurrent callers both hitting the TTL expiry check before rotation completes triggers separate rotations. Add an `isRotating` guard or use an `async-mutex`.

**S-4 — PBKDF2 iteration count not validated on decrypt**
`src/services/crypto.ts:227-235`
The iteration count is read from the untrusted ciphertext envelope and passed directly to `deriveKey()`. An attacker who modifies the stored ciphertext can reduce iterations to 1. Enforce `iterations >= PBKDF2_ITERATIONS` before decrypting.

**S-5 — Auto-lock bypass via programmatic scroll (undocumented deliberate tradeoff)**
`src/services/autoLock.ts:13-21`
`scroll` and `mousemove` are intentionally excluded (per comment S-13) to avoid false positives. However, this means a compromised browser extension can indefinitely prevent lock by firing scroll events. Document the tradeoff in code comments.

**S-6 — Nonce cleanup runs inside Mutex validation path**
`src-tauri/src/lib.rs:194-210`
`cleanup_expired_nonces()` is called under the session state Mutex lock during `validate_nonce()`. Move cleanup to a separate periodic task to avoid blocking validation.

**S-7 — UTXOs silently migrate between accounts without ownership verification**
`src/services/database/utxoRepository.ts:83-89`
On sync, a UTXO's `account_id` is set to `accountId ?? 1` with no check that the UTXO's address belongs to that account. Cross-account UTXO migration should verify address ownership and write to the audit log.

**S-8 — Backup restore does not validate recovered keys**
`src/services/backupRecovery.ts:150+`
After decryption, WIF and mnemonic are used without validation. A wrong password produces garbage that gets treated as valid keys. Call `PrivateKey.fromWIF(keys.walletWif).toPublicKey()` and `validateMnemonic(keys.mnemonic)` before accepting restored keys.

### LOW

| ID | File | Issue |
|----|------|-------|
| S-9 | `http_server.rs:44-66` | No CORS distinction between public and state-changing endpoints |
| S-10 | `transactions.ts:77-117` | No output sum validation before broadcast (`inputs − outputs − fee ≠ 0` check missing) |
| S-11 | `rate_limiter.rs:189-218` | Brief window on first boot where HMAC key is not yet persisted |
| S-12 | `storage.ts:299+` | BRC-100 session token not invalidated on password change |
| S-13 | `tauri.conf.json:25` | `style-src 'unsafe-inline'` in CSP |
| S-14 | `brc100/actions.ts:115-147` | Ordinal inscription content not sanitised before display |

---

## Phase 2 — Bugs

### HIGH

**B-1 — Stale balance after account switch**
`src/contexts/SyncContext.tsx:262-265`
`setBalance(totalBalance)` executes before the `isCancelled?.()` guard. On a fast account switch, the previous account's balance overwrites the new account's state. Move the cancellation check to before the `setBalance` call.

**B-2 — `lockWallet()` failure swallowed in visibility handler**
`src/hooks/useWalletLock.ts:123-125`
`lockWallet().catch(e => log(e))` swallows the rejection. If locking fails (Rust keystore error), the wallet stays unlocked but the UI shows it as locked. Add retry logic or surface the error to the user.

**B-3 — Wrong sync lock acquired when `accountId` is undefined**
`src/services/wallet/transactions.ts:191,277`
`acquireSyncLock(accountId ?? 1)` silently defaults to account 1 when `accountId` is undefined. During an account switch, the lock protects account 1 rather than the active account. Assert `accountId` is defined before acquiring the lock.

**B-4 — Duplicate-UTXO error swallowed in DB transaction — change UTXO lost**
`src/services/wallet/transactions.ts:142-165`
The `UNIQUE` / `duplicate` catch path silently continues without verifying the duplicate UTXO matches expected state. If the existing row has wrong satoshis or account, the change UTXO is permanently incorrect. Re-throw if existing row doesn't match.

### MEDIUM

| ID | File | Issue |
|----|------|-------|
| B-5 | `balance.ts:115-116` | Incomplete null guard — `prevTx?.vout[vin.vout]` treated as 0 when `prevTx` is null |
| B-6 | `fees.ts:96-104` | `bytes * feeRate` can overflow `Number.MAX_SAFE_INTEGER` silently |
| B-7 | `fees.ts:260-261` | Negative fee scenario not guarded — `canSend` returns `true` on invalid fee |
| B-8 | `coinSelection.ts:172-180` | `needsChangeOutput()` not guarded against `totalInput = 0` |
| B-9 | `useWalletLock.ts:111-140` | Visibility listener leak if `lockWallet` reference changes (unstable closure) |
| B-10 | `SyncContext.tsx:359-370` | `Promise.allSettled` all-fail silently drops ordinals — no warning, stale cache served |

### LOW

| ID | File | Issue |
|----|------|-------|
| B-11 | `SyncContext.tsx:262,278` | `NaN`/`Infinity` from API can corrupt balance state — no `Number.isFinite` guard |
| B-12 | `fees.ts:34,92` | Fee cache age goes negative on backwards clock — cache treated as fresh indefinitely |
| B-13 | `SyncContext.tsx:273-274` | Hardcoded indices `results[0]` / `results[1]` without bounds check |

---

## Phase 3 — Architecture

### HIGH

**A-4 — No error boundaries around individual context providers**
`src/AppProviders.tsx`
A crash in any provider (`SyncProvider`, `NetworkProvider`, etc.) bubbles up to the single `ErrorBoundary` at `App.tsx`, showing "app failed to start". Wrap each provider in its own `ErrorBoundary` with a targeted fallback so one failing sync doesn't kill the entire wallet.

**A-5 — `wocClient.ts` has no retry logic or fallback**
`src/infrastructure/api/wocClient.ts`
`httpClient.ts` already has exponential backoff; `wocClient.ts` does not. Any transient outage causes sync to fail immediately. Add 3-attempt retry with backoff for `TIMEOUT` / `NETWORK_ERROR` codes. Consider a GorillaPool fallback for block height.

### MEDIUM

| ID | Finding |
|----|---------|
| A-1 | 32 component files import directly from `services/` or `infrastructure/` — violates layered architecture (already surfaced by ESLint) |
| A-2 | `WalletContext` is a God Object (50+ state props, 30+ actions) — a crash cascades everywhere; split into `WalletKeysContext`, `WalletOperationsContext`, `WalletSettingsContext` |
| A-3 | `Result<T,E>` adoption ~30%; 70% of services still throw or use ad-hoc `{ success, error }` — complete migration in `wallet/transactions.ts` and `sync.ts` first |

### LOW

**A-6 — BRC-100 `RequestManager` cleanup interval = TTL**
`src/services/brc100/RequestManager.ts`
Stale requests can linger up to 2× TTL (≈10 min). Set interval to `min(ttlMs/4, 60_000)` and add per-request `setTimeout` for hard expiry.

---

## Phase 4 — Code Quality

### HIGH

**Q-3 — `getUTXOsFromDB()` silently returns `[]` on database failure**
`src/services/wallet/balance.ts:41-44`
The catch block logs and returns an empty array. The UI renders "no UTXOs" rather than showing an error. Return `Result<UTXO[], string>` or throw so callers can distinguish "no UTXOs" from "DB error".

**Q-4 — Broadcast rollback critical-state failure not surfaced**
`src/services/wallet/transactions.ts:106-116`
When broadcast fails and the DB rollback also fails, the code throws (correct) but no UI notification is triggered. The user has no indication that wallet state may be inconsistent. Emit an error toast or set a critical error flag.

**Q-5 — 24 of 26 modal components have no tests**
`src/components/modals/`
Only `SendModal.test.tsx` and `ReceiveModal.test.tsx` exist. `RestoreModal` (three restore paths, security-critical) is completely untested. Prioritise: `RestoreModal`, `LockModal`, `OrdinalTransferModal`, `UnlockConfirmModal`.

### MEDIUM

| ID | File | Issue |
|----|------|-------|
| Q-1 | `fees.ts` | Fee rate localStorage retrieval duplicated 3× — extract `getStoredFeeRate()` |
| Q-2 | Multiple modals | Address validation logic repeated per modal — create `useAddressValidation()` hook |
| Q-6 | `SyncContext.tsx` | `ordinalContentCache` lives as both `useState` Map and a `ref` — consolidate to ref only |

### LOW

| ID | File | Issue |
|----|------|-------|
| Q-7a | `useWalletLock.ts:116` | `HIDDEN_LOCK_DELAY_MS = 60_000` is a magic number; move to `src/config/index.ts` SECURITY section |
| Q-7b | `SendModal.tsx:50` | Fallback fee `0.05` sat/byte is hardcoded; move to `TRANSACTION` config |

---

## Validated Strengths

- AES-256-GCM encryption throughout
- PBKDF2 at 600,000 iterations (OWASP 2025)
- Private keys in Rust native memory (not JavaScript)
- CSRF nonces with HMAC binding
- Constant-time session token comparison
- Rate limiting with exponential backoff (Rust backend)
- Parameterized SQL queries — no SQL injection surface
- HMAC-SHA256 for rate-limiter state integrity
- DNS rebinding protection via host header validation
- Structured logger with module-specific instances — no bare `console.log` in production
- Sync mutex: per-account, promise-chain serialisation, no deadlock possible
- 1593 passing tests, 0 TypeScript errors, clean ESLint (warnings only)

---

## Prioritised Remediation

### Before Next Release
1. B-1 — Stale balance after account switch (`SyncContext.tsx:262`)
2. B-2 — Swallowed `lockWallet()` failure (`useWalletLock.ts:123`)
3. B-3 — Wrong sync lock on undefined `accountId` (`transactions.ts:191,277`)
4. B-4 — Lost change UTXO on duplicate-key swallow (`transactions.ts:142-165`)

### Next Sprint
5. S-1 — Remove / restrict `saveWalletUnprotected()`
6. S-2 — Add read-back verification after `saveToSecureStorage()`
7. S-4 — Enforce PBKDF2 iteration minimum on decrypt
8. A-4 — Wrap each context provider in `ErrorBoundary`
9. A-5 — Add retry + fallback to `wocClient.ts`
10. Q-3 — Make `getUTXOsFromDB()` surface errors
11. Q-5 — Add tests for `RestoreModal`, `LockModal`, `OrdinalTransferModal`

### Sprint After
12. S-3 — Session key rotation mutex
13. S-6..8 — Nonce concurrency, UTXO account migration, backup key validation
14. A-1 — Hook abstraction layer for service imports
15. A-2 — Split `WalletContext`
16. A-3 — Complete `Result<T,E>` migration
17. Q-1, Q-2 — DRY fixes (fee retrieval, address validation hook)
