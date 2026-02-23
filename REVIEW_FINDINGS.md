# Simply Sats — Review Findings
**Latest review:** 2026-02-23 (v8 / Review #11 — UI/UX polish & stability deep dive)
**Full report:** `docs/reviews/2026-02-23-full-review-v8.md`
**Rating:** 9.2 / 10 (up from 8.0 — 25 of 26 Review #11 issues resolved, only 2 medium + 3 deferred remain)
**Review #11 remediation:** Complete — all critical/high/medium issues fixed, 4 low-priority accessibility issues fixed

> **Legend:** ✅ Fixed | 🔴 Open-Critical | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low

---

## Critical — Fix Before Next Release

| ID | Status | File | Issue |
|----|--------|------|-------|
| ST-8 | ✅ Fixed (v8) | `SendModal.tsx:151-187` | `executeSendMulti` lacked `sendingRef` guard — double-click could broadcast duplicate transactions. Added `sendingRef` + try/finally pattern |
| ST-9 | ✅ Fixed (v8) | `SendModal.tsx:122-140` | Multi-recipient send bypassed SpeedBumpModal confirmation for high-value transactions. Added `handleMultiSubmitClick` with threshold checks |
| ST-10 | ✅ Fixed (v8) | `SendModal.tsx:289-345` | Multi-recipient addresses not validated — invalid addresses only failed at broadcast. Added per-row `isValidBSVAddress` validation with error display |
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
| ST-11 | ✅ Fixed (v8) | `ordinals.ts:246+` | `transferOrdinal` didn't acquire sync lock — race with background sync could corrupt UTXO state. Added `acquireSyncLock`/`releaseLock` |
| A-12 | ✅ Fixed (v8) | `AppProviders.tsx:52,57` | `TokensProvider` and `ModalProvider` missing ErrorBoundary wrappers — could crash entire app. Wrapped both |
| U-14 | ✅ Fixed (v8) | `AccountSwitcher.tsx:109-114` | No loading indicator during account switch — dropdown closed instantly with no feedback. Added switching state |
| U-15 | ✅ Fixed (v8) | `ReceiveModal.tsx:39-52` | Silent failure on BRC-100 key derivation — empty address shown with no error. Added `derivationError` state |
| Q-13 | ✅ Fixed (v8) | `ordinalRepository.test.ts` | No tests for new `getBatchOrdinalContent` function. Added test suite covering chunking, filtering, error handling |
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
| U-16 | ✅ Fixed (v8) | `BalanceDisplay.tsx` | No skeleton/loading state during initial sync — added skeleton bars when `totalBalance === 0 && syncing` |
| U-17 | ✅ Fixed (v8) | `LockScreenModal.tsx` | No rate limiting feedback — integrated rateLimiter service, shows attempts remaining and lockout countdown |
| U-18 | ✅ Fixed (v8) | `TokensTab.tsx:53` | Send button disabled with no tooltip — added `title` attribute explaining pending tokens not spendable |
| U-19 | ✅ Fixed (v8) | `SendModal.tsx` | Amount input accepted negative numbers — added `min="0"` attribute |
| U-20 | ✅ Fixed (v8) | `AppModals.tsx` | Suspense `fallback={null}` — created `ModalLoadingFallback` spinner component, replaced all 8 fallbacks |
| ST-12 | ✅ Fixed (v8) | `SyncContext.tsx:298` | Race window: `getBatchOrdinalContent` result written to state without `isCancelled` check. Added guard |
| ST-13 | ✅ Fixed (v8) | `ordinalRepository.ts` | DB-fallback upsert overwriting metadata — changed to `ON CONFLICT DO UPDATE SET` with COALESCE to preserve existing non-null values |
| Q-14 | ✅ Fixed (v8) | `hooks/useSyncData.ts` | Sort comparator duplicated 4 times — extracted `compareTxByHeight` utility function |
| Q-15 | ✅ Fixed (v8) | `SyncContext.tsx:664` | `(ord as any).blockHeight` — unnecessary `as any` cast removed (type already has `blockHeight?: number`) |
| Q-16 | ✅ Fixed (v8) | `ordinalRepository.ts:192` | Silent `catch (_e)` swallowed all DB errors — now logs via `dbLogger.warn` |
| S-21 | ✅ Fixed (v8) | `transactions.ts`, `ConsolidateModal.tsx` | `consolidateUtxos` no longer fetches WIF — removed `getWifForOperation` call, Rust `build_consolidation_tx_from_store` reads key directly |
| S-22 | ✅ Fixed (v8) | `http_server.rs`, `lib.rs` | `isAuthenticated` now checks `SharedKeyStore.has_keys()` for actual wallet lock state |
| A-13 | ✅ Fixed (v8) | `SyncContext.tsx` → `hooks/useSyncData.ts`, `useSyncOrchestration.ts`, `useOrdinalCache.ts` | 863→208 lines — extracted into 3 hooks |
| A-14 | ✅ Fixed (v8) | `services/ordinalCache.ts` | Created services facade — SyncContext now imports ordinal cache functions through services layer |
| ST-4 | 🟡 Open | `SyncContext.tsx` (fetchData) | No AbortController for inflight network requests on cancellation — cancelled requests waste bandwidth |
| ST-6 | 🟡 Open | `SyncContext.tsx:150-238` | `performSync` has no cancellation mechanism — DB writes continue after account switch |
| U-5 | ✅ Fixed (v7) | `ReceiveModal.tsx` | 29 inline `style={{}}` props extracted to CSS classes in `App.css` under `.receive-*` namespace |
| U-7 | ✅ Fixed (v7) | `FeeEstimation.tsx:60-65` | Dead code — all 4 branches returned same string. Collapsed to single `return 'Near-instant'` |
| U-8 | ✅ Fixed (v7) | `App.tsx:268-273` | Unbranded loading screen — added `SimplySatsLogo` |
| U-10 | ✅ Fixed (v7) | `LockScreenModal.tsx:74` | Placeholder changed from "Enter password (or leave blank)" to "Enter your password" |
| U-11 | ✅ Fixed (v7) | `App.tsx:375` | Raw Unicode `✕` replaced with `<X size={16} />` from lucide-react |
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
| U-21 | ✅ Fixed (v8) | `AccountSwitcher.tsx` | Added focus trap, ArrowUp/Down/Home/End keyboard navigation, auto-focus on open |
| U-22 | ✅ Fixed (v8) | `TokensTab.tsx:27-59` | Token cards now have tabIndex, role="button", onKeyDown (Enter→send), aria-label |
| U-23 | ✅ Fixed (v8) | `PaymentAlert.tsx` | Added role="alert", tabIndex, onKeyDown (Enter/Escape dismiss), aria-label |
| U-24 | ✅ Fixed (v8) | `TokensTab.tsx:197-202` | Added `aria-label="Search tokens"` to search input |
| U-9 | ✅ Fixed (v7) | `EmptyState.tsx` | Empty state title casing standardized to Title Case |
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

| Category | Total | ✅ Fixed/Verified | 🔴/🟠 Critical/High Open | 🟡 Medium Open | ⚪ Low Open |
|----------|-------|-------------------|--------------------------|----------------|-------------|
| Security | 22 | 21 (1 accepted) | 0 | 0 | 0 |
| Bugs | 18 | 18 | 0 | 0 | 0 |
| Architecture | 13 | 13 | 0 | 0 | 0 |
| Quality | 16 | 15 | 0 | 0 | 0 |
| UX/UI | 24 | 24 | 0 | 0 | 3 deferred |
| Stability | 13 | 11 | 0 | 2 (ST-4, ST-6) | 0 |
| **Total** | **106** | **102 (1 accepted)** | **0** | **2** | **3** |

---

## Remaining Open Items

### Medium (next sprint)
- **ST-4** — AbortController for cancelled network requests. **Effort: 30 min**
- **ST-6** — performSync cancellation mechanism. **Effort: 20 min**

### Low / Deferred
- **U-6** — LockScreenModal → PasswordInput refactor
- **U-12** — Tab underline slide animation
- **U-13** — Account dropdown exit animation

### Accepted Risk
- **S-17** — `SENSITIVE_KEYS` empty in secureStorage

### Moot
- **S-3** — Session key rotation race (SENSITIVE_KEYS empty)

---

## Review #11 Remediation — 2026-02-23

25 of 26 issues fixed in this session. Summary of fixes:

| ID | File(s) | Change |
|----|---------|--------|
| ST-8 | `SendModal.tsx` | `sendingRef` guard + try/finally added to `executeSendMulti` |
| ST-9 | `SendModal.tsx` | `handleMultiSubmitClick` routes multi-recipient sends through confirmation modal with threshold checks |
| ST-10 | `SendModal.tsx` | Per-row `isValidBSVAddress` validation with `recipientErrors` state and error display |
| A-12 | `AppProviders.tsx` | `TokensProvider` and `ModalProvider` wrapped in `<ErrorBoundary>` |
| ST-11 | `ordinals.ts` | `transferOrdinal` now acquires sync lock with `acquireSyncLock`/`releaseLock` |
| U-14 | `AccountSwitcher.tsx` | Loading state shown during account switch |
| U-15 | `ReceiveModal.tsx` | `derivationError` state surfaces BRC-100 derivation failures to user |
| Q-13 | `ordinalRepository.test.ts` | New test suite for `getBatchOrdinalContent` |
| Q-15 | `SyncContext.tsx` | Removed unnecessary `(ord as any).blockHeight` cast |
| Q-16 | `ordinalRepository.ts` | Silent catch now logs via `dbLogger.warn` |
| ST-12 | `SyncContext.tsx` | Added `isCancelled` check after batch content load |
| U-19 | `SendModal.tsx` | Added `min="0"` to amount inputs |
| U-16 | `BalanceDisplay.tsx`, `App.css` | Skeleton loading bars during initial sync |
| U-17 | `LockScreenModal.tsx` | Rate limiter integration with attempts remaining + lockout countdown |
| U-18 | `TokensTab.tsx` | `title` attribute on disabled send button |
| U-20 | `AppModals.tsx`, `App.css` | `ModalLoadingFallback` spinner replaces all `fallback={null}` |
| ST-13 | `ordinalRepository.ts` | `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE SET` with COALESCE |
| Q-14 | `hooks/useSyncData.ts` | Extracted `compareTxByHeight` utility, eliminated 4x duplication |
| S-21 | `transactions.ts`, `ConsolidateModal.tsx` | Removed unnecessary WIF bridge from consolidation flow |
| S-22 | `http_server.rs`, `lib.rs` | `isAuthenticated` checks `SharedKeyStore.has_keys()` |
| A-13 | `SyncContext.tsx` → 3 hooks | 863→208 lines: `useSyncData`, `useSyncOrchestration`, `useOrdinalCache` |
| A-14 | `services/ordinalCache.ts` | Services facade for ordinal cache DB access |
| U-21 | `AccountSwitcher.tsx` | Focus trap + ArrowUp/Down/Home/End keyboard nav |
| U-22 | `TokensTab.tsx` | Token card tabIndex, role="button", onKeyDown |
| U-23 | `PaymentAlert.tsx` | role="alert", tabIndex, keyboard dismiss (Enter/Escape) |
| U-24 | `TokensTab.tsx` | `aria-label="Search tokens"` on search input |

**Prioritized Remediation — Review #11**

### Completed (25 of 26 issues fixed)
1. **ST-8** ✅ — Multi-recipient double-send guard (critical)
2. **ST-9** ✅ — Multi-recipient SpeedBump confirmation (critical)
3. **ST-10** ✅ — Multi-recipient address validation (critical)
4. **A-12** ✅ — ErrorBoundary wrappers for TokensProvider/ModalProvider (high)
5. **ST-11** ✅ — Sync lock for ordinal transfers (high)
6. **U-14** ✅ — Account switch loading indicator (high)
7. **U-15** ✅ — ReceiveModal derivation error handling (high)
8. **Q-13** ✅ — getBatchOrdinalContent tests (high)
9. **Q-15** ✅ — Remove `as any` cast (medium)
10. **Q-16** ✅ — Log silent catches (medium)
11. **ST-12** ✅ — isCancelled check after batch load (medium)
12. **U-19** ✅ — Negative amount input validation (medium)
13. **U-16** ✅ — Balance loading skeleton during initial sync (medium)
14. **U-17** ✅ — Lock screen rate limit feedback with attempts remaining + lockout countdown (medium)
15. **U-18** ✅ — Token send disabled tooltip (medium)
16. **U-20** ✅ — Modal Suspense loading fallback spinner (medium)
17. **ST-13** ✅ — DB-fallback upsert guarded with COALESCE (medium)
18. **Q-14** ✅ — Extracted `compareTxByHeight` sort utility (medium)
19. **S-21** ✅ — Removed unnecessary WIF bridge from consolidateUTXOs (medium)
20. **S-22** ✅ — isAuthenticated checks actual wallet lock state (medium)
21. **A-13** ✅ — SyncContext 863→208 lines, extracted to 3 hooks (medium)
22. **A-14** ✅ — Created services/ordinalCache.ts facade (medium)
23. **U-21** ✅ — AccountSwitcher focus trap + arrow key navigation (low)
24. **U-22** ✅ — Token card keyboard interaction (low)
25. **U-23** ✅ — PaymentAlert keyboard dismiss + ARIA role (low)
26. **U-24** ✅ — Token search input aria-label (low)
