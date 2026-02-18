# Simply Sats — Review Findings
**Latest review:** 2026-02-17 (v7 / Review #10 — UX/UI polish & stability)
**Full report:** `docs/reviews/2026-02-17-full-review-v7.md`
**Rating:** 9.0 / 10
**Review #10 remediation:** In progress — 14 of 17 issues fixed in this session

> **Legend:** ✅ Fixed | 🔴 Open-Critical | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low

---

## Critical — Fix Before Next Release

| ID | Status | File | Issue |
|----|--------|------|-------|
| U-1 | ✅ Fixed (v7) | `ReceiveModal.tsx:247-248` | Contact chips used undefined `--primary`/`--primary-bg` CSS tokens — replaced with `--accent`/`--accent-subtle` |
| ST-1 | ✅ Fixed (v7) | `TokensContext.tsx:81-114` | Token send didn't acquire sync lock — wrapped with `acquireSyncLock()`/`releaseLock()` matching `transactions.ts` pattern |
| B-1 | ✅ Fixed (v5) | `SyncContext.tsx:261` | Stale balance: `isCancelled` check now before `setBalance` |
| B-2 | ✅ Fixed (v5) | `useWalletLock.ts:127-130` | `lockWallet()` failure: `setIsLocked(true)` forced on error |
| B-3 | ✅ Fixed (v5) | `transactions.ts:210-211` | `accountId ?? 1` replaced with hard throw |
| B-4 | ✅ Fixed (v5) | `transactions.ts:174,365` | Duplicate UTXO error caught and logged |

---

## High Priority — Next Sprint

| ID | Status | File | Issue |
|----|--------|------|-------|
| U-2 | ✅ Fixed (v7) | `SendModal.tsx:407` | Send error displayed with `.warning` (amber) instead of `.warning.error` (red) — wrong semantic color for a failure |
| U-3 | ✅ Fixed (v7) | `SpeedBumpModal.tsx` | 140-line embedded `<style>` tag removed; buttons now use shared `.btn` system; styles moved to `App.css` |
| U-4 | ✅ Fixed (v7) | `SendModal.tsx:382-384` | Emoji in coin control buttons replaced with lucide-react `Crosshair`/`Settings` icons |
| ST-3 | ✅ Fixed (v7) | `transactions.ts:432` | `consolidateUtxos` `executeBroadcast` not wrapped in try/catch — thrown error bypassed Result pattern. Now returns `err(AppError)` |
| ST-5 | ✅ Fixed (v7) | `SendModal.tsx:107-116` | Double-send race window — `sendingRef` (useRef) guard added at top of `handleSubmitClick`, set synchronously before async work |
| U-6 | 🟡 Deferred | `LockScreenModal.tsx:24-92` | Manual Eye/EyeOff toggle reimplements `PasswordInput`. Deferred: LockScreenModal needs `ref`, `aria-invalid`, `aria-describedby` which PasswordInput doesn't support. Would require extending PasswordInput. |
| S-19 | ✅ Fixed (v6) | `ReceiveModal.tsx:73` / `derived_addresses` table | BRC-42 child private key (WIF) no longer stored in SQLite — re-derive on demand; migrations 019-021 strip existing WIF data |
| S-1 | ✅ Mitigated | `storage.ts:121` | Unprotected mode warning shown at setup, restore, and Settings |
| S-2 | ✅ Fixed (v5) | `storage.ts:43-48` | Read-back verify after `saveToSecureStorage()` now present |
| S-4 | ✅ Fixed (v5) | `crypto.ts:239` | PBKDF2 minimum enforced |
| S-15 | ✅ Mitigated (v5+) | `brc100/state.ts:19` | All `setWalletKeys()` call sites audited |
| S-16 | ✅ Fixed (v5+) | `http_server.rs:649` | Timeout reduced from 120s to 30s |
| S-17 | 🟠 Accepted | `secureStorage.ts:21-23` | `SENSITIVE_KEYS` empty — accepted risk: XSS in Tauri requires code exec |
| A-4 | ✅ Fixed (v5) | `AppProviders.tsx` | All providers wrapped in ErrorBoundary |
| A-5 | ✅ Fixed (v5) | `infrastructure/api/wocClient.ts` | Retry/backoff logic now in httpClient |
| Q-3 | ✅ Fixed (v5) | `balance.ts:32-34` | `getUTXOsFromDB()` no longer swallows errors |
| Q-5 | ✅ Partial (v5+) | `src/hooks/useWalletActions.test.ts` | 19 tests cover wallet operations |

---

## Medium Priority — Sprint After

| ID | Status | File | Issue |
|----|--------|------|-------|
| U-5 | ✅ Fixed (v7) | `ReceiveModal.tsx` | 29 inline `style={{}}` props extracted to CSS classes in `App.css` under `.receive-*` namespace |
| U-7 | ✅ Fixed (v7) | `FeeEstimation.tsx:60-65` | Dead code — all 4 branches returned same string. Collapsed to single `return 'Near-instant'` |
| U-8 | ✅ Fixed (v7) | `App.tsx:268-273` | Unbranded loading screen — added `SimplySatsLogo` |
| U-10 | ✅ Fixed (v7) | `LockScreenModal.tsx:74` | Placeholder changed from "Enter password (or leave blank)" to "Enter your password" |
| U-11 | ✅ Fixed (v7) | `App.tsx:375` | Raw Unicode `✕` replaced with `<X size={16} />` from lucide-react |
| ST-4 | 🟡 Open | `SyncContext.tsx` (fetchData) | No AbortController for inflight network requests on cancellation — cancelled requests waste bandwidth |
| ST-6 | 🟡 Open | `SyncContext.tsx:150-238` | `performSync` has no cancellation mechanism — DB writes continue after account switch |
| S-20 | ✅ Verified (v6) | `http_server.rs` | `validate_origin()` + `ALLOWED_ORIGINS` whitelist confirmed present |
| B-17 | ✅ Fixed (v6) | `sync.ts:268-273` | `syncAddress` now throws on DB failure |
| A-10 | ✅ Fixed (v6) | `AccountsContext.tsx:220-226` | `renameAccount` returns `Promise<boolean>` |
| B-16 | ✅ Fixed (v6) | `LocksContext.tsx:17` | `knownUnlockedLocksRef` typed as Readonly |
| A-11 | ✅ Fixed (v6) | `errors.ts:294-308` | `DbError.toAppError()` bridge added |
| Q-10 | ✅ Fixed (v6) | `ReceiveModal.tsx:39-82` | Handler functions moved before early return guard |
| Q-11 | ✅ Fixed (v6) | `sync.test.ts` | Test added for `getSpendableUTXOs` failure path |
| S-3 | 🟡 Moot | `secureStorage.ts:47-114` | Session key rotation race is moot (`SENSITIVE_KEYS` empty) |
| S-6 | ✅ Verified | `lib.rs:194-210` | Nonce cleanup properly implemented |
| S-7 | ✅ Fixed (v5+) | `utxoRepository.ts:83-89` | Address ownership check added |
| S-8 | ✅ Fixed (v5) | `backupRecovery.ts:177-179` | Restored keys validated |
| B-5 | ✅ Fixed (v5) | `balance.ts:113` | Full null guard on prevTx.vout |
| B-6 | ✅ Fixed (v5) | `domain/transaction/fees.ts:97-103` | `feeFromBytes` guards invalid values |
| B-7 | ✅ Fixed (v5) | `domain/transaction/fees.ts:103` | `Math.max(1, ...)` prevents zero fee |
| B-8 | ✅ Fixed (v5) | `backupRecovery.ts:177` | Restored key fields validated post-decrypt |
| B-9 | ✅ Fixed (v5) | `useWalletLock.ts:141-144` | Visibility listener cleaned up |
| B-10 | ✅ Fixed (v5) | `SyncContext.tsx:407,429` | Partial sync errors surfaced to user |
| B-12 | ✅ Fixed (v5) | `fees.ts:93-96` | `isCacheValid()` guards backwards clock |
| B-13 | ✅ Fixed (v5) | `SyncContext.tsx:273-274` | Array destructuring with defaults |
| B-14 | ✅ Fixed (v5) | `SyncContext.tsx:338,344` | `isCancelled` check correctly placed |
| B-15 | ✅ Verified | `SyncContext.tsx:359-362` | Dual state (ref + state) is intentional |
| A-1 | ✅ Partial (v5+) | `eslint.config.js` | ESLint `no-restricted-imports` expanded |
| A-2 | ✅ Fixed | `WalletContext.tsx` | `useWallet()` deprecated; split into state/actions |
| A-3 | ✅ Fixed | Services layer | Full Result<T,E> migration complete |
| A-7 | ✅ Fixed (v5+) | `AppProviders.tsx:48` | `ConnectedAppsProvider` wrapped in ErrorBoundary |
| A-8 | ✅ Fixed | `brc100/certificates.ts`, `listener.ts` | Keys injected as first param |
| A-9 | ✅ Fixed | `src/infrastructure/database/` | DB repos moved to infrastructure |
| Q-1 | ✅ Fixed (v5) | `fees.ts:33-41` | `getStoredFeeRate()` helper |
| Q-2 | ✅ Fixed (v5+) | `src/hooks/useAddressValidation.ts` | `useAddressValidation()` hook created |
| Q-4 | ✅ Fixed (v5) | `transactions.ts:121-122` | Rollback failure throws AppError |
| Q-6 | ✅ Verified | `SyncContext.tsx:134-135` | Dual state is intentional |

---

## Low Priority

| ID | Status | File | Issue |
|----|--------|------|-------|
| U-9 | ✅ Fixed (v7) | `EmptyState.tsx` | Empty state title casing standardized to Title Case ("No Contacts Yet", "No Results Found", "Something Went Wrong") |
| ST-7 | ✅ Fixed (v7) | `App.css:550-554` | Dead `prefers-reduced-motion` rule targeting nonexistent `.tab-content` removed |
| U-12 | ⚪ Deferred | `App.css` | Tab underline doesn't slide between tabs (existing fade transition is adequate) |
| U-13 | ⚪ Deferred | `App.css` | Account dropdown has no exit animation (would require JS-delayed unmount) |
| B-18 | ✅ Fixed (v6) | `transactions.ts:120-129` | `UTXO_STUCK_IN_PENDING` error code used correctly |
| Q-12 | ✅ Fixed (v6) | `BRC100Modal.tsx:2` | `feeFromBytes` routed through adapter layer |
| S-5 | ✅ Documented (v5+) | `autoLock.ts:13-21` | Security tradeoff documented |
| S-9 | ✅ Verified | `http_server.rs:44-66` | CORS properly scoped |
| S-10 | ✅ Fixed (v5+) | `domain/transaction/builder.ts` | Output sum validation added |
| S-11 | ✅ Verified | `rate_limiter.rs:189-218` | HMAC key properly generated |
| S-12 | ✅ Fixed (v5+) | `storage.ts:308-330` | `changePassword()` invalidates BRC-100 sessions |
| S-13 | ✅ Verified | `tauri.conf.json:25` | `style-src 'unsafe-inline'` required for Tailwind |
| S-14 | ✅ Fixed (v5+) | `brc100/actions.ts:126-135` | `parseInt` validated |
| S-18 | ✅ Fixed (v5+) | `infrastructure/api/httpClient.ts` | Response size limit (10 MB) added |
| A-6 | ✅ Verified | `brc100/RequestManager.ts` | Cleanup interval bounded |
| B-11 | ✅ Fixed (v5) | `SyncContext.tsx:264` | `Number.isFinite()` guard on balance |
| Q-7a | ✅ Fixed (v5) | `useWalletLock.ts` | `HIDDEN_LOCK_DELAY_MS` moved to config |
| Q-7b | ✅ Fixed (v5) | `SendModal.tsx` | Fallback fee `0.05` moved to config |
| Q-8 | ✅ Fixed (v5+) | `autoLock.ts:98` | Poll interval reduced from 15s to 5s |
| Q-9 | ✅ Verified | `keyDerivation.ts:260-262` | Dev-only code guarded |

---

## Summary: Issue Status

| Category | Total | ✅ Fixed/Verified | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low |
|----------|-------|-------------------|-------------|----------------|-------------|
| Security | 20 | 19 (1 accepted) | 0 | 0 | 0 |
| Bugs | 18 | 18 | 0 | 0 | 0 |
| Architecture | 11 | 11 | 0 | 0 | 0 |
| Quality | 12 | 12 | 0 | 0 | 0 |
| UX/UI (new) | 13 | 10 | 0 | 1 deferred | 2 deferred |
| Stability (new) | 7 | 4 | 0 | 2 open | 0 |
| **Total** | **81** | **74 (1 accepted)** | **0** | **3** | **2** |

---

## Remaining Open Items

### Deferred (low effort, no urgency)
- **U-6** — LockScreenModal reimplements PasswordInput. Requires extending PasswordInput with ref forwarding and ARIA props.
- **U-12** — Tab underline doesn't slide between tabs. Existing fade transition is functional.
- **U-13** — Account dropdown has no exit animation. Would require JS-delayed unmount.

### Open Medium (next sprint)
- **ST-4** — No AbortController for cancelled network requests in SyncContext. Bandwidth waste on slow networks.
- **ST-6** — performSync has no cancellation mechanism. DB writes continue after account switch.

### Accepted Risk (no code change needed)
- **S-17** — `SENSITIVE_KEYS` empty in secureStorage. XSS in Tauri requires code exec.

### Moot (no longer applicable)
- **S-3** — Session key rotation race is moot because `SENSITIVE_KEYS` is empty

---

## Review #10 Remediation — 2026-02-17

14 of 17 issues fixed in this session. Summary of fixes:

| ID | File(s) | Change |
|----|---------|--------|
| U-1 | `ReceiveModal.tsx` | `--primary`/`--primary-bg` → `--accent`/`--accent-subtle` |
| ST-1 | `TokensContext.tsx` | `sendTokenAction` wrapped with `acquireSyncLock()`/`releaseLock()` |
| U-2 | `SendModal.tsx` | `className="warning compact"` → `"warning error compact"` |
| U-3 | `SpeedBumpModal.tsx`, `App.css` | Embedded `<style>` removed; buttons use `.btn` system; styles in App.css |
| U-4 | `SendModal.tsx` | Emoji replaced with `Crosshair`/`Settings` lucide-react icons |
| ST-3 | `transactions.ts` | `consolidateUtxos` `executeBroadcast` wrapped in try/catch, returns `err(AppError)` |
| ST-5 | `SendModal.tsx` | `sendingRef` (useRef) guard prevents double-send race |
| U-5 | `ReceiveModal.tsx`, `App.css` | 29 inline styles extracted to CSS classes under `.receive-*` namespace |
| U-7 | `FeeEstimation.tsx` | Dead multi-branch code collapsed; label changed to "Near-instant" |
| U-8 | `App.tsx` | `SimplySatsLogo` added to loading screen |
| U-9 | `EmptyState.tsx`, `EmptyState.test.tsx` | Title casing standardized to Title Case |
| U-10 | `LockScreenModal.tsx` | Placeholder changed to "Enter your password" |
| U-11 | `App.tsx` | Raw `✕` replaced with `<X>` icon |
| ST-7 | `App.css` | Dead `.tab-content` reduced-motion rule removed |

**Prioritized Remediation — Review #10**

### Completed
1. **U-1** ✅ — Undefined CSS tokens fixed (visual bug)
2. **ST-1** ✅ — Token send sync lock added (stability)
3. **U-2** ✅ — Error color corrected
4. **U-3** ✅ — SpeedBumpModal integrated with design system
5. **U-4** ✅ — Emoji replaced with icons
6. **ST-3** ✅ — consolidateUtxos error handling fixed
7. **ST-5** ✅ — Double-send race window closed
8. **U-5** ✅ — ReceiveModal inline styles extracted
9. **U-7** ✅ — Fee estimation dead code cleaned up
10. **U-8** ✅ — Loading screen branded
11. **U-9** ✅ — Empty state casing standardized
12. **U-10** ✅ — Lock screen placeholder improved
13. **U-11** ✅ — Unicode dismiss button replaced
14. **ST-7** ✅ — Dead CSS removed

### Remaining (next sprint)
15. **ST-4** — AbortController for cancelled network requests. **Effort: 30 min**
16. **ST-6** — performSync cancellation mechanism. **Effort: 20 min**
17. **U-6** — LockScreenModal → PasswordInput. **Effort: 30 min** (requires PasswordInput extension)
