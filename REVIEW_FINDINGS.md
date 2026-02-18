# Simply Sats — Review Findings
**Latest review:** 2026-02-18 (v6 / Review #9 — A-3 migration verification + new findings)
**Full report:** `docs/reviews/2026-02-18-full-review-v6.md`
**Rating:** 9.4 / 10
**Review #9 remediation:** Complete (2026-02-18) — all 10 issues resolved

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
| S-19 | ✅ Fixed (v6) | `ReceiveModal.tsx:73` / `derived_addresses` table | BRC-42 child private key (WIF) no longer stored in SQLite — re-derive on demand; migrations 019-021 strip existing WIF data (commits 5eac1bf, cabf0fe, edfafc7, aa33f32, c038d5b) |
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
| S-20 | ✅ Verified (v6) | `http_server.rs` (createAction handler) | `validate_origin()` + `ALLOWED_ORIGINS` whitelist confirmed present on `createAction`, `lockBSV`, `unlockBSV` — trusted-origin check already implemented |
| B-17 | ✅ Fixed (v6) | `sync.ts:268-273` | `syncAddress` now throws on DB failure instead of silently returning `totalBalance: 0` (commit b73ad1a) |
| A-10 | ✅ Fixed (v6) | `AccountsContext.tsx:220-226` | `renameAccount` returns `Promise<boolean>` — callers can surface error toast (commit 231fce1) |
| B-16 | ✅ Fixed (v6) | `LocksContext.tsx:17` | `knownUnlockedLocksRef` typed as `Readonly<MutableRefObject<Set<string>>>` — direct mutation blocked (commit b41e9d7) |
| A-11 | ✅ Fixed (v6) | `errors.ts:294-308` | `DbError.toAppError()` bridge added — structured `DbError.code` preserved when crossing error hierarchy boundary (commit 41256df) |
| Q-10 | ✅ Fixed (v6) | `ReceiveModal.tsx:39-82` | Handler functions moved before early `return null` guard for consistency (commit e6142ef) |
| Q-11 | ✅ Fixed (v6) | `sync.test.ts` | Test added: `getSpendableUTXOs` returning `err(DbError)` in `syncAddress` asserts `UTXO_STUCK_IN_PENDING` code (commit b73ad1a) |
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
| A-2 | ✅ Fixed | `WalletContext.tsx` | `useWallet()` marked `@deprecated`; `useWalletState()` / `useWalletActions()` now primary API; 14 of 15 consumers migrated; App.tsx intentional exception (orchestrator) |
| A-3 | ✅ Fixed | Services layer | Full Result<T,E> migration complete. Tier 1: sendBSV, createWallet, lockBSV → Result<T,AppError>. Tier 2 DB repos: all 10 migrated (contactRepository, actionRepository, addressRepository, syncRepository, basketRepository, txRepository, utxoRepository → Result<T,DbError>). accounts.ts mutations (createAccount, updateAccountName, deleteAccount) → Result<T,DbError>. consolidateUtxos migrated. Silent Result drops in broadcast path fixed. |
| A-7 | ✅ Fixed (v5+) | `AppProviders.tsx:48` | `ConnectedAppsProvider` now wrapped in `<ErrorBoundary context="ConnectedAppsProvider">` |
| A-8 | ✅ Fixed | `brc100/certificates.ts`, `listener.ts` | Keys now injected as first param in all 3 certificate functions; listener.ts consolidated from 6 → 1 `getWalletKeys()` call at handler boundary |
| A-9 | ✅ Fixed | `src/infrastructure/database/` | All 13 DB repo files moved to `infrastructure/database/`; `database-types.ts` → `row-types.ts`; 24 import sites updated; `services/database/` deleted |
| Q-1 | ✅ Fixed (v5) | `fees.ts:33-41` | `getStoredFeeRate()` helper centralizes localStorage fee rate retrieval |
| Q-2 | ✅ Fixed (v5+) | `src/hooks/useAddressValidation.ts` | `useAddressValidation()` hook created; SendModal and OrdinalTransferModal now use it |
| Q-4 | ✅ Fixed (v5) | `transactions.ts:121-122` | Rollback failure throws `AppError` with user-visible message: "Transaction failed and wallet state could not be fully restored" |
| Q-6 | ✅ Verified | `SyncContext.tsx:134-135` | `ordinalContentCache` dual state is intentional — useRef for async accumulation, useState for rendering. Same as B-15. |

---

## Low Priority

| ID | Status | File | Issue |
|----|--------|------|-------|
| B-18 | ✅ Fixed (v6) | `transactions.ts:120-129` | `UTXO_STUCK_IN_PENDING` error code now used correctly when broadcast+rollback both fail; test asserts the new code (commits d791968, d839737) |
| Q-12 | ✅ Fixed (v6) | `BRC100Modal.tsx:2` | `feeFromBytes` now routed through adapter layer instead of direct service import (commit 2fa46b0) |
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

| Category | Total | ✅ Fixed/Verified | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low |
|----------|-------|-------------------|-------------|----------------|-------------|
| Security | 20 | 19 (1 accepted) | 0 | 0 | 0 |
| Bugs | 18 | 18 | 0 | 0 | 0 |
| Architecture | 11 | 11 | 0 | 0 | 0 |
| Quality | 11 | 11 | 0 | 0 | 0 |
| **Total** | **60** | **59 (1 accepted)** | **0** | **0** | **0** |

---

## Remaining Open Items

All Review #9 issues are resolved. No open bugs, architecture concerns, or quality issues remain.

### Accepted Risk (no code change needed)
- **S-17** — `SENSITIVE_KEYS` empty in secureStorage. XSS in Tauri requires code execution which already owns the process.

### Moot (no longer applicable)
- **S-3** — Session key rotation race is moot because `SENSITIVE_KEYS` is empty

---

## Review #9 Remediation — Complete (2026-02-18)

All 10 issues from Review #9 were resolved. Summary of fixes:

| ID | Commit(s) | Change |
|----|-----------|--------|
| S-19 | 5eac1bf, cabf0fe, edfafc7, aa33f32, c038d5b | Stop storing child WIF in SQLite; migrations 019-021 wipe existing data; re-derive on demand |
| S-20 | (confirmed present) | `validate_origin()` + `ALLOWED_ORIGINS` whitelist already covers `createAction`, `lockBSV`, `unlockBSV` |
| B-18 | d791968, d839737 | `UTXO_STUCK_IN_PENDING` error code used correctly when both broadcast and rollback fail |
| A-11 | 41256df | `DbError.toAppError()` bridge added — preserves structured code across error hierarchy |
| B-16 | b41e9d7 | `knownUnlockedLocksRef` typed `Readonly<MutableRefObject<Set<string>>>` in context |
| B-17 | b73ad1a | `syncAddress` throws on DB failure instead of silently returning `totalBalance: 0` |
| Q-11 | b73ad1a | Test asserts `UTXO_STUCK_IN_PENDING` code on `getSpendableUTXOs` failure in `syncAddress` |
| A-10 | 231fce1 | `renameAccount` returns `Promise<boolean>` — callers can surface error feedback |
| Q-10 | e6142ef | Handler functions moved before early `return null` guard in `ReceiveModal` |
| Q-12 | 2fa46b0 | `feeFromBytes` routed through adapter layer in `BRC100Modal` |

**Prioritized Remediation — Review #9 (original plan)**

All items below were completed:

1. **S-19** ✅ — Child WIF removed from SQLite; re-derive on demand
2. **B-18** ✅ — `UTXO_STUCK_IN_PENDING` error code corrected
3. **B-17** ✅ — `syncAddress` propagates DB errors instead of silently returning zero
4. **A-10** ✅ — `renameAccount` returns `Promise<boolean>`
5. **B-16** ✅ — `knownUnlockedLocksRef` is now Readonly in context type
6. **A-11** ✅ — `DbError.toAppError()` bridge implemented
7. **Q-11** ✅ — Missing test added for `getSpendableUTXOs` failure path
8. **S-20** ✅ — Trusted-origin check confirmed present (already implemented)
9. **Q-10** ✅ — Guard ordering fixed in `ReceiveModal`
10. **Q-12** ✅ — `feeFromBytes` routed through adapter layer
