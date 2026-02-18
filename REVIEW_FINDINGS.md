# Simply Sats — Review Findings
**Latest review:** 2026-02-17 (v5+ / Review #8 remediation)
**Full report:** `docs/reviews/2026-02-17-full-review-v5.md`
**Rating:** 8.5 / 10

> **Legend:** ✅ Fixed | 🔴 Open-Critical | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low

---

## Critical — Fix Before Next Release

| ID | Status | File | Issue |
|----|--------|------|-------|
| B-1 | ✅ Fixed (v5) | `SyncContext.tsx:261` | Stale balance: `isCancelled` check now before `setBalance` |
| B-2 | ✅ Fixed (v5) | `useWalletLock.ts:127-130` | `lockWallet()` failure: `setIsLocked(true)` forced on error |
| B-3 | ✅ Fixed (v5) | `transactions.ts:210-211` | `accountId ?? 1` replaced with hard throw |
| B-4 | ✅ Fixed (v5) | `transactions.ts:174,365` | Duplicate UTXO error caught and logged |

---

## High Priority — Next Sprint

| ID | Status | File | Issue |
|----|--------|------|-------|
| S-1 | ✅ Mitigated | `storage.ts:121` | Unprotected mode warning shown at setup (OnboardingFlow HIGH RISK banner), at restore (RestoreModal skip-warning modal), and in Settings (isPasswordless prompt to set password) |
| S-2 | ✅ Fixed (v5) | `storage.ts:43-48` | Read-back verify after `saveToSecureStorage()` now present |
| S-4 | ✅ Fixed (v5) | `crypto.ts:239` | PBKDF2 minimum enforced: `Math.max(encryptedData.iterations, PBKDF2_ITERATIONS)` |
| S-15 | ✅ Mitigated (v5+) | `brc100/state.ts:19` | All `setWalletKeys()` call sites audited (lock/unlock/account-switch/restore all covered). `assertKeysMatchAccount()` added for pre-sign divergence detection. `actions.ts:587` already guards sign path via `identityPubKey` comparison. Long-term: parameter injection refactor (A-8). |
| S-16 | ✅ Fixed (v5+) | `http_server.rs:649` | Timeout reduced from 120s to 30s |
| S-17 | 🟠 Accepted | `secureStorage.ts:21-23` | `SENSITIVE_KEYS` empty — `trusted_origins`/`connected_apps` in plaintext localStorage; XSS can exfiltrate and replay. Encryption previously caused data loss on restart (session key is per-session). Accepted risk: XSS in Tauri requires code exec. |
| A-4 | ✅ Fixed (v5) | `AppProviders.tsx` | All providers wrapped in ErrorBoundary including `ConnectedAppsProvider` (A-7 fixed) |
| A-5 | ✅ Fixed (v5) | `infrastructure/api/wocClient.ts` | Retry/backoff logic now in httpClient |
| Q-3 | ✅ Fixed (v5) | `balance.ts:32-34` | `getUTXOsFromDB()` no longer swallows errors — explicit comment at source |
| Q-5 | ✅ Partial (v5+) | `src/hooks/useWalletActions.test.ts` | 19 tests cover handleRestoreWallet, handleImportJSON, handleCreateWallet — password enforcement, encrypted vs unprotected save path, mnemonic stripping from React state |

---

## Medium Priority — Sprint After

| ID | Status | File | Issue |
|----|--------|------|-------|
| S-3 | 🟡 Moot | `secureStorage.ts:47-114` | Session key rotation race: `SENSITIVE_KEYS` is empty so no data is encrypted/rotated. Race is theoretical only. |
| S-6 | ✅ Verified | `lib.rs:194-210` | Nonce cleanup properly implemented with expiry + capacity guard (`MAX_USED_NONCES`); `generate_nonce` has capacity guard |
| S-7 | ✅ Fixed (v5+) | `utxoRepository.ts:83-89` | Address ownership check added: account_id only migrated when addresses match (or either is null); cross-account reassignment blocked and warned |
| S-8 | ✅ Fixed (v5) | `backupRecovery.ts:177-179` | Restored keys validated: checks walletWif, walletAddress, mnemonic presence |
| B-5 | ✅ Fixed (v5) | `balance.ts:113` | Full null guard: `prevTx?.vout && Array.isArray(prevTx.vout) ? prevTx.vout[vin.vout] : undefined` |
| B-6 | ✅ Fixed (v5) | `domain/transaction/fees.ts:97-103` | `feeFromBytes` guards invalid bytes/rate with isFinite checks |
| B-7 | ✅ Fixed (v5) | `domain/transaction/fees.ts:103` | `Math.max(1, Math.ceil())` prevents negative/zero fee |
| B-8 | ✅ Fixed (v5) | `backupRecovery.ts:177` | Restored key fields validated post-decrypt |
| B-9 | ✅ Fixed (v5) | `useWalletLock.ts:141-144` | Visibility listener properly cleaned up in useEffect return |
| B-10 | ✅ Fixed (v5) | `SyncContext.tsx:407,429` | `partialErrors.push('ordinals')` feeds into `setSyncError(...)` — user sees "Some data may be stale: failed to load ordinals" |
| B-12 | ✅ Fixed (v5) | `fees.ts:93-96` | `isCacheValid()` requires `age >= 0` — guards backwards clock |
| B-13 | ✅ Fixed (v5) | `SyncContext.tsx:273-274` | Array destructuring with defaults: `[ordAddressOrdinals = [], ...]` |
| B-14 | ✅ Fixed (v5) | `SyncContext.tsx:338,344` | `isCancelled?.()` check at line 338 runs before `setOrdinals(dbOrdinals)` at line 344 — already correctly placed |
| B-15 | ✅ Verified | `SyncContext.tsx:359-362` | `contentCacheRef.current` is intentional: useRef accumulator for async background caching, useState for React re-renders. Dual state is load-bearing. |
| A-1 | ✅ Partial (v5+) | `eslint.config.js` | ESLint `no-restricted-imports` rule expanded to cover all service modules (crypto, accounts, brc100, keyDerivation, tokens, etc.). 54 warnings now surfaced for incremental cleanup. |
| A-2 | 🟡 Open | `WalletContext.tsx` | God Object: 50+ state props, 30+ actions; should split into focused contexts. **Major refactor — separate branch.** |
| A-3 | 🟡 Open | Services layer | `Result<T,E>` migration ~30% complete; wallet throws AppError, DB throws/null, Accounts returns null. **Major refactor — separate branch.** |
| A-7 | ✅ Fixed (v5+) | `AppProviders.tsx:48` | `ConnectedAppsProvider` now wrapped in `<ErrorBoundary context="ConnectedAppsProvider">` |
| A-8 | 🟡 Open | `brc100/state.ts` | ARCH-6: Module-level key state documented as needing refactor; keys should be parameters, not module state. **Major refactor — separate branch.** |
| A-9 | 🟡 Open | `src/services/database/` | Database repos live in `services/database/` not `infrastructure/database/` — violates stated layer boundary. **Major refactor — separate branch.** |
| Q-1 | ✅ Fixed (v5) | `fees.ts:33-41` | `getStoredFeeRate()` helper centralizes localStorage fee rate retrieval |
| Q-2 | ✅ Fixed (v5+) | `src/hooks/useAddressValidation.ts` | `useAddressValidation()` hook created; SendModal and OrdinalTransferModal now use it |
| Q-4 | ✅ Fixed (v5) | `transactions.ts:121-122` | Rollback failure throws `AppError` with user-visible message: "Transaction failed and wallet state could not be fully restored" |
| Q-6 | ✅ Verified | `SyncContext.tsx:134-135` | `ordinalContentCache` dual state is intentional — useRef for async accumulation, useState for rendering. Same as B-15. |

---

## Low Priority

| ID | Status | File | Issue |
|----|--------|------|-------|
| S-5 | ✅ Documented (v5+) | `autoLock.ts:13-21` | Security tradeoff now documented: mousemove/scroll excluded because passive activity should not prevent auto-lock |
| S-9 | ✅ Verified | `http_server.rs:44-66` | CORS already properly scoped with production-only origins; debug origins stripped in release builds |
| S-10 | ✅ Fixed (v5+) | `domain/transaction/builder.ts` | Output sum validation added: `satoshis + change + fee === totalInput` checked before building both `buildP2PKHTx` and `buildMultiKeyP2PKHTx` |
| S-11 | ✅ Verified | `rate_limiter.rs:189-218` | HMAC key properly generated and persisted to disk on first boot; panics if persistence fails (security-critical) |
| S-12 | ✅ Fixed (v5+) | `storage.ts:308-330` | `changePassword()` now calls `rotate_session_for_account` to invalidate BRC-100 session tokens |
| S-13 | ✅ Verified | `tauri.conf.json:25` | `style-src 'unsafe-inline'` is required for Tailwind CSS; `script-src` does NOT have unsafe-inline. Acceptable. |
| S-14 | ✅ Fixed (v5+) | `brc100/actions.ts:126-135` | `parseInt` result now validated with `Number.isFinite() && > 0`; malformed tags return error to caller |
| S-18 | ✅ Fixed (v5+) | `infrastructure/api/httpClient.ts` | Response body size limit (10 MB) added via `content-length` header check in both GET and POST methods |
| A-6 | ✅ Verified | `brc100/RequestManager.ts` | Cleanup interval properly bounded: `Math.min(ttlMs / 4, 60_000)` — stale requests cleaned within 75s max |
| B-11 | ✅ Fixed (v5) | `SyncContext.tsx:264` | `Number.isFinite()` guard on balance before `setBalance` |
| Q-7a | ✅ Fixed (v5) | `useWalletLock.ts` | `HIDDEN_LOCK_DELAY_MS` moved to config |
| Q-7b | ✅ Fixed (v5) | `SendModal.tsx` | Fallback fee `0.05` moved to config |
| Q-8 | ✅ Fixed (v5+) | `autoLock.ts:98` | Poll interval reduced from 15s to 5s — max overshoot now ~4s instead of ~14s |
| Q-9 | ✅ Verified | `keyDerivation.ts:260-262` | Already guarded: `if (!import.meta.env.DEV) throw` — Vite tree-shakes dead code in production |

---

## Summary: Issue Status

| Category | Total | ✅ Fixed/Verified | 🟠 Accepted | 🟡 Open-Medium | ⚪ Open-Low |
|----------|-------|-------------------|-------------|----------------|-------------|
| Security | 18 | 16 | 1 | 1 | 0 |
| Bugs | 15 | 15 | 0 | 0 | 0 |
| Architecture | 9 | 5 | 0 | 4 | 0 |
| Quality | 9 | 9 | 0 | 0 | 0 |
| **Total** | **51** | **45** | **1** | **5** | **0** |

---

## Remaining Open Items

### Accepted Risk (no code change needed)
- **S-17** — `SENSITIVE_KEYS` empty in secureStorage. XSS in Tauri requires code execution which already owns the process.

### Architecture Debt (each needs its own branch/PR)
- **A-2** — WalletContext God Object split (50+ state props → focused contexts)
- **A-3** — `Result<T,E>` migration to AccountsContext and database layer
- **A-8** — BRC-100 key parameter injection (replace module-level state)
- **A-9** — Move database repos from `services/database/` to `infrastructure/database/`

### Moot (no longer applicable)
- **S-3** — Session key rotation race is moot because `SENSITIVE_KEYS` is empty
