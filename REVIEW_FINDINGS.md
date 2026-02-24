# Simply Sats — Review Findings
**Latest review:** 2026-02-23 (v12 / Review #15 — Deep Semantic Dive)
**Full report:** `docs/reviews/2026-02-23-full-review-v12.md`
**Rating:** 9.7 / 10 (down from 9.8 — 10 new findings from deep dive, 1 high-priority SDK security gap)
**Review #15 summary:** Deep semantic correctness review. 10 new findings (1 high, 4 medium, 5 low). SDK response signature bypass (S-25) and broken listOutputs/listLocks (S-27) are the most actionable.

> **Legend:** ✅ Fixed | 🔴 Open-Critical | 🟠 Open-High | 🟡 Open-Medium | ⚪ Open-Low

---

## Critical — Fix Before Next Release

| ID | Status | File | Issue |
|----|--------|------|-------|
| ST-8 | ✅ Fixed (v8) | `SendModal.tsx:151-187` | `executeSendMulti` lacked `sendingRef` guard — double-click could broadcast duplicate transactions. Added `sendingRef` + try/finally pattern |
| ST-9 | ✅ Fixed (v8) | `SendModal.tsx:122-140` | Multi-recipient send bypassed SpeedBumpModal confirmation for high-value transactions. Added `handleMultiSubmitClick` with threshold checks |
| ST-10 | ✅ Fixed (v8) | `SendModal.tsx:289-345` | Multi-recipient addresses not validated — invalid addresses only failed at broadcast. Added per-row `isValidBSVAddress` validation with error display |
| U-25 | ✅ Fixed (v11) | `ConsolidateModal.tsx`, `TestRecoveryModal.tsx`, `UnlockConfirmModal.tsx` | 3 modals bypassed shared Modal component — missing focus trap, ESC handling, scroll lock. Migrated all 3 to `<Modal>` |
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
| U-26 | ✅ Fixed (v11) | `SimplySatsLogo.tsx` | Logo hardcoded `#000` stroke/fill — invisible on dark backgrounds. Replaced with `currentColor` |
| U-27 | ✅ Fixed (v11) | `Toast.tsx`, `App.css` | Toast dismiss button only rendered on hover — inaccessible to keyboard users. Now always in DOM, visibility via CSS opacity |
| U-28 | ✅ Fixed (v11) | `Toast.tsx`, `App.css` | Toast dismiss button progressive disclosure via `:hover`/`:focus-within` CSS selectors |
| U-2 | ✅ Fixed (v7) | `SendModal.tsx:407` | Send error displayed with `.warning` (amber) instead of `.warning.error` (red) — wrong semantic color for a failure |
| U-3 | ✅ Fixed (v7) | `SpeedBumpModal.tsx` | 140-line embedded `<style>` tag removed; buttons now use shared `.btn` system; styles moved to `App.css` |
| U-4 | ✅ Fixed (v7) | `SendModal.tsx:382-384` | Emoji in coin control buttons replaced with lucide-react `Crosshair`/`Settings` icons |
| ST-3 | ✅ Fixed (v7) | `transactions.ts:432` | `consolidateUtxos` `executeBroadcast` not wrapped in try/catch — thrown error bypassed Result pattern. Now returns `err(AppError)` |
| ST-5 | ✅ Fixed (v7) | `SendModal.tsx:107-116` | Double-send race window — `sendingRef` (useRef) guard added at top of `handleSubmitClick`, set synchronously before async work |
| U-6 | ✅ Fixed (v9) | `LockScreenModal.tsx`, `PasswordInput.tsx` | Extended PasswordInput with `forwardRef`, `ariaInvalid`, `ariaDescribedby`, `wrapperClassName` props. LockScreenModal now uses shared PasswordInput component |
| S-19 | ✅ Fixed (v6) | `ReceiveModal.tsx:73` / `derived_addresses` table | BRC-42 child private key (WIF) no longer stored in SQLite — re-derive on demand; migrations 019-021 strip existing WIF data |
| S-1 | ✅ Mitigated | `storage.ts:121` | Unprotected mode warning shown at setup, restore, and Settings |
| S-2 | ✅ Fixed (v5) | `storage.ts:43-48` | Read-back verify after `saveToSecureStorage()` now present |
| S-4 | ✅ Fixed (v5) | `crypto.ts:239` | PBKDF2 minimum enforced |
| S-15 | ✅ Mitigated (v5+) | `brc100/state.ts:19` | All `setWalletKeys()` call sites audited |
| S-16 | ✅ Fixed (v5+) | `http_server.rs:649` | Timeout reduced from 120s to 30s |
| S-25 | 🟠 Open-High | `sdk/src/index.ts:207-208` | SDK HMAC response signature verification only `console.warn`s on mismatch — MITM on localhost can modify responses undetected. Should reject or throw |
| S-17 | 🟠 Accepted | `secureStorage.ts:21-23` | `SENSITIVE_KEYS` empty — accepted risk: XSS in Tauri requires code exec |
| A-4 | ✅ Fixed (v5) | `AppProviders.tsx` | All providers wrapped in ErrorBoundary |
| A-5 | ✅ Fixed (v5) | `infrastructure/api/wocClient.ts` | Retry/backoff logic now in httpClient |
| Q-3 | ✅ Fixed (v5) | `balance.ts:32-34` | `getUTXOsFromDB()` no longer swallows errors |
| Q-5 | ✅ Partial (v5+) | `src/hooks/useWalletActions.test.ts` | 19 tests cover wallet operations |

---

## Medium Priority — Sprint After

| ID | Status | File | Issue |
|----|--------|------|-------|
| U-29 | ✅ Fixed (v11) | `OrdinalListModal.tsx`, `BackupVerificationModal.tsx`, `AccountCreateForm.tsx` | Hardcoded hex colors (`#22c55e`) instead of `var(--success)` — replaced across 5 files |
| U-30 | ✅ Fixed (v11) | `ConsolidateModal.tsx`, `TestRecoveryModal.tsx`, `UnlockConfirmModal.tsx` | 53 inline `style={{}}` extracted to CSS classes (`.result-icon-circle`, `.result-title`, `.modal-actions`, etc.) |
| U-31 | ✅ Fixed (v11) | `MnemonicInput.tsx`, `AccountModal.tsx` | Embedded `<style>` blocks (~375 lines total) moved to App.css |
| U-32 | ✅ Fixed (v11) | `App.css` | Settings rows lacked `:active` press feedback — added `transform: scale(0.995)` to existing rule |
| U-33 | ✅ Fixed (v11) | `App.css` | Hardcoded font sizes (`18px`, `12px`) replaced with `var(--type-h3-size)`, `var(--type-caption-size)` tokens |
| U-34 | ✅ Fixed (v11) | `App.css` | Duplicate `.empty-state` CSS rule merged into single consolidated rule |
| U-35 | ✅ Fixed (v11) | `useModalKeyboard.ts` | `onItemSelect` double-fire — useEffect watching `selectedIndex` removed; selection only fires on Enter/click per ARIA listbox spec |
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
| Q-17 | ✅ Fixed (v9) | `utils/syncHelpers.ts` | Extracted `compareTxByHeight` + `mergeOrdinalTxEntries` to shared module. Both hooks now import from `utils/syncHelpers.ts` |
| S-23 | ✅ Fixed (v10) | `http_server.rs:151-167` | Token rotation TOCTOU race — between `drop(session)` and re-lock, concurrent requests could desync tokens. Re-check `is_token_expired()` under second lock before rotating |
| S-27 | 🟡 Open-Medium | `sdk/src/index.ts:346-353`, `http_server.rs:565-575` | SDK `listOutputs()` and `listLocks()` don't send CSRF nonces, but server `validate_and_parse_request` requires them — these calls will fail for external SDK consumers |
| B-21 | 🟡 Open-Medium | `useSyncData.ts:369` | Partial ordinal display on API failure — `apiOrdinals.length > 0 ? apiOrdinals : dbOrdinals` means if some ordinal API calls fail (return []) while others succeed, a partial set replaces the full DB set |
| A-17 | 🟡 Open-Medium | `sync.ts`, `tokens.ts`, `brc100/actions.ts`, `locks.ts` | Four monolithic service files exceed 800 LOC (1351, 1057, 957, 838). Natural seam points exist for splitting |
| Q-24 | 🟡 Open-Medium | `src/hooks/` | 13 of 17 hooks have zero test coverage — most complex logic (useAccountSwitching, useWalletSend, useSyncData) is untested |
| A-16 | 🟡 Backlog | 51 component files | 51 `no-restricted-imports` lint warnings — components importing directly from `services/` instead of context hooks. Tracked as backlog item |
| A-15 | ✅ Fixed (v9) | `utils/syncHelpers.test.ts`, `hooks/useOrdinalCache.test.ts` | 27 new tests: 14 for syncHelpers (compareTxByHeight, mergeOrdinalTxEntries), 13 for cacheOrdinalsInBackground |
| ST-4 | ✅ Fixed (v9) | `useSyncData.ts`, `httpClient.ts`, `wocClient.ts`, `balance.ts`, `ordinals.ts` | AbortController created in `fetchData`, signal threaded through API layer to `fetch()` calls. Cancelled requests now abort immediately |
| ST-6 | ✅ Fixed (v9) | `sync.ts` | Added cancellation checks before tx history loop, before balance calculation, inside derived address loop. `cancellableDelay` replaces `setTimeout` between iterations |
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
| U-36 | ✅ Fixed (v11) | `PasswordInput.tsx` | Toggle button `tabIndex={-1}` — keyboard users couldn't toggle visibility. Changed to `tabIndex={0}` |
| U-37 | ✅ Fixed (v11) | `SettingsConnectedApps.tsx` | Disconnect buttons lacked differentiated `aria-label` — added `aria-label={`Disconnect ${app}`}` |
| U-38 | ✅ Fixed (v11) | `WalletContext.tsx` | `useAnnounce` hook implemented but never called — added announcements for wallet lock/unlock and account switch |
| U-39 | ✅ Fixed (v11) | `autoLock.ts`, `WalletContext.tsx` | No auto-lock warning — added `onWarning` callback, fires toast 30s before wallet locks |
| U-40 | ✅ Fixed (v11) | `SettingsNetwork.tsx`, `SettingsTransactions.tsx` | Inline styles on select/input elements — extracted to `.settings-inline-select`, `.settings-inline-input`, `.settings-hint-text` CSS classes |
| U-21 | ✅ Fixed (v8) | `AccountSwitcher.tsx` | Added focus trap, ArrowUp/Down/Home/End keyboard navigation, auto-focus on open |
| U-22 | ✅ Fixed (v8) | `TokensTab.tsx:27-59` | Token cards now have tabIndex, role="button", onKeyDown (Enter→send), aria-label |
| U-23 | ✅ Fixed (v8) | `PaymentAlert.tsx` | Added role="alert", tabIndex, onKeyDown (Enter/Escape dismiss), aria-label |
| U-24 | ✅ Fixed (v8) | `TokensTab.tsx:197-202` | Added `aria-label="Search tokens"` to search input |
| U-9 | ✅ Fixed (v7) | `EmptyState.tsx` | Empty state title casing standardized to Title Case |
| ST-7 | ✅ Fixed (v7) | `App.css:550-554` | Dead `prefers-reduced-motion` rule targeting nonexistent `.tab-content` removed |
| Q-18 | ✅ Fixed (v9) | `SendModal.tsx` | Extracted `executeWithSendGuard` shared helper — `executeSend` and `executeSendMulti` now delegate to it |
| Q-19 | ✅ Fixed (v9) | `utils/syncHelpers.ts` | `console.warn` replaced with `syncLogger.warn` during extraction to shared module. Stale `[SyncContext]` prefix removed |
| Q-20 | ✅ Fixed (v9) | `App.tsx:594` | Added `logger.error('get_mnemonic_once failed', { error: String(_err) })` before toast |
| U-12 | ✅ Fixed (v9) | `AppTabs.tsx`, `App.css` | Replaced per-tab `::after` pseudo-elements with shared `<span className="tab-indicator">` that slides between tabs via CSS transitions on `left`/`width` |
| U-13 | ✅ Fixed (v9) | `AccountSwitcher.tsx`, `App.css` | Added `modalOut` exit animation with delayed unmount pattern (`closing` state + `onAnimationEnd`) |
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
| S-24 | ✅ Fixed (v10) | `locks.ts:472-496` | Lock unlock fallback assumed UTXO was spent by our tx without verification. Now computes expected txid via `tx.id('hex')` and compares with spending txid; logs warning on mismatch |
| B-19 | ✅ Fixed (v10) | `certificates.ts:162` | `JSON.parse(row.fields)` in `.map()` with no try-catch. Created `safeParseFields()` helper that returns `{}` on failure, used across all 4 query functions |
| B-20 | ✅ Fixed (v10) | `accounts.ts:572` | `JSON.parse(account.encryptedKeys)` in `encryptAllAccounts` without try-catch. Wrapped loop body in try-catch, corrupted accounts skipped with warning log |
| Q-21 | ✅ Fixed (v10) | `SettingsSecurity.tsx:107,128,210` + `SettingsBackup.tsx:75,153` | 5 `console.error()` calls replaced with `logger.error()` |
| Q-22 | ✅ Fixed (v10) | `sync.test.ts`, `src/test/factories.ts` | 20+ `as any` casts for UTXO mocks replaced with typed factory helpers: `createMockDBUtxo()`, `createMockUTXO()`, `createMockExtendedUTXO()` |
| Q-23 | ✅ Fixed (v10) | `httpClient.ts:333-338` | JSON response parsed without checking `Content-Type` header. Added Content-Type validation before JSON parse, rejects unexpected content types |
| S-28 | ⚪ Open-Low | `tauri.conf.json:26` | CSP `img-src 'self' data: blob: https:` allows any HTTPS image URL — ordinal preview images could be used for IP tracking. Consider restricting to known ordinal CDN domains |
| B-22 | ⚪ Open-Low | `useSyncData.ts:92,229,251` | `localStorage.setItem()` wrapped in silent `try/catch` — if quota exceeded, next cold start shows 0 balance flash until API sync completes |
| A-18 | ⚪ Open-Low | Service layer | Error handling pattern fragmentation — mix of `Result<T,E>` returns, `{success, error}` objects, and raw `throw`. ~60% migrated to Result pattern |
| Q-25 | ⚪ Open-Low | `useOrdinalCache.ts:45-59` | Sequential `await upsertOrdinalCache(cached)` for 620+ ordinals — batched INSERT would be significantly faster |
| Q-26 | ⚪ Open-Low | `eslint.config.js` | ESLint scans `coverage/` directory — 3 spurious warnings from instrumented files. Add `coverage/` to ignores |
| Q-9 | ✅ Verified | `keyDerivation.ts:260-262` | Dev-only code guarded |

---

## Summary: Issue Status

| Category | Total | ✅ Fixed/Verified | 🔴/🟠 Critical/High Open | 🟡 Medium Open | ⚪ Low Open |
|----------|-------|-------------------|--------------------------|----------------|-------------|
| Security | 27 | 23 (1 accepted) | 1 (S-25) | 1 (S-27) | 1 (S-28) |
| Bugs | 22 | 20 | 0 | 1 (B-21) | 1 (B-22) |
| Architecture | 18 | 15 | 0 | 2 (A-17 + A-16 backlog) | 1 (A-18) |
| Quality | 26 | 23 | 0 | 1 (Q-24) | 2 (Q-25, Q-26) |
| UX/UI | 40 | 40 | 0 | 0 | 0 |
| Stability | 13 | 13 | 0 | 0 | 0 |
| **Total** | **146** | **135 (1 accepted)** | **1** | **5 (1 backlog)** | **5** |

---

## Remaining Open Items

### High Priority
- **S-25** — SDK HMAC response signature verification non-blocking (`sdk/src/index.ts:207-208`)

### Medium Priority
- **S-27** — SDK/Server nonce mismatch for listOutputs/listLocks
- **B-21** — Partial ordinal display on API failure (`useSyncData.ts:369`)
- **A-17** — Four monolithic service files >800 LOC
- **Q-24** — 13/17 hooks have zero test coverage

### Low / Deferred
- **S-28** — CSP img-src wildcard enables IP tracking via ordinal images
- **B-22** — localStorage quota silently swallowed
- **A-18** — Error handling pattern fragmentation (~60% migrated to Result)
- **Q-25** — Sequential ordinal DB writes (batched INSERT would be faster)
- **Q-26** — ESLint should exclude `coverage/` directory

### Backlog
- **A-16** — 51 `no-restricted-imports` lint warnings (components importing from `services/` directly)

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

---

## Review #12 — 2026-02-23

5 new findings (2 medium, 3 low) + 2 carry-forward medium items (ST-4, ST-6). All 7 fixed in this session.

| ID | File(s) | Change |
|----|---------|--------|
| Q-17 | `utils/syncHelpers.ts` | Extracted `compareTxByHeight` + `mergeOrdinalTxEntries` to shared module; both hooks now import |
| Q-19 | `utils/syncHelpers.ts` | `console.warn` → `syncLogger.warn`, stale `[SyncContext]` prefix removed |
| Q-20 | `App.tsx:594` | Added `logger.error` before toast in mnemonic catch block |
| Q-18 | `SendModal.tsx` | Extracted `executeWithSendGuard` shared helper for send execution pattern |
| A-15 | `utils/syncHelpers.test.ts`, `hooks/useOrdinalCache.test.ts` | 27 new tests (14 syncHelpers + 13 cacheOrdinalsInBackground) |
| ST-4 | `useSyncData.ts`, `httpClient.ts`, `wocClient.ts`, `balance.ts`, `ordinals.ts` | AbortController + signal threaded through entire API pipeline |
| ST-6 | `sync.ts` | Cancellation checks at key DB write boundaries, `cancellableDelay` replaces setTimeout |
| U-6 | `PasswordInput.tsx`, `LockScreenModal.tsx` | Extended PasswordInput with `forwardRef`, `ariaInvalid`, `ariaDescribedby`, `wrapperClassName`; LockScreenModal uses shared component |
| U-12 | `AppTabs.tsx`, `App.css` | Sliding tab indicator — replaced `::after` pseudo-elements with shared `<span>` + CSS `left`/`width` transitions |
| U-13 | `AccountSwitcher.tsx`, `App.css` | Exit animation — `@keyframes modalOut` + `closing` state + `onAnimationEnd` delayed unmount |

**Remediation — Review #12: Complete (10 of 10 issues fixed)**

1. **Q-19** ✅ — `syncLogger.warn` in shared module (5 min)
2. **Q-17** ✅ — Extracted to `src/utils/syncHelpers.ts` (15 min)
3. **Q-20** ✅ — Added `logger.error` to App.tsx:594 (5 min)
4. **Q-18** ✅ — `executeWithSendGuard` in SendModal (20 min)
5. **A-15** ✅ — 27 new tests, 1670 total passing (90 min)
6. **ST-4** ✅ — AbortSignal threaded through fetch → httpClient → wocClient → API (45 min)
7. **ST-6** ✅ — Cancellation checks + `cancellableDelay` in syncWallet (20 min)
8. **U-6** ✅ — Extended PasswordInput with forwardRef/aria props; LockScreenModal now uses shared component (15 min)
9. **U-12** ✅ — Sliding tab indicator: replaced per-tab ::after with shared DOM element + CSS transitions (15 min)
10. **U-13** ✅ — Account dropdown exit animation: `modalOut` keyframe + delayed unmount pattern (10 min)

---

## Review #13 — 2026-02-23

8 new findings (2 medium, 6 low). 7 of 8 fixed in this session; A-16 tracked as backlog.

| ID | File(s) | Change |
|----|---------|--------|
| S-23 | `http_server.rs:151-167` | Re-check `is_token_expired()` under second lock before rotating — closes TOCTOU race window |
| S-24 | `locks.ts:472-496` | Compute expected txid via `tx.id('hex')` and compare with spending txid; log warning on mismatch |
| B-19 | `certificates.ts:162` | Created `safeParseFields()` helper returning `{}` on failure, used across all 4 query functions |
| B-20 | `accounts.ts:572` | Wrapped `encryptAllAccounts` loop body in try-catch; corrupted accounts skipped with warning log |
| A-16 | 51 component files | 51 `no-restricted-imports` lint warnings — tracked as backlog item, not fixed in this session |
| Q-21 | `SettingsSecurity.tsx`, `SettingsBackup.tsx` | 5 `console.error()` calls replaced with `logger.error()` |
| Q-22 | `sync.test.ts`, `src/test/factories.ts` | Created `createMockDBUtxo()`, `createMockUTXO()`, `createMockExtendedUTXO()` factory helpers; replaced 20+ `as any` casts |
| Q-23 | `httpClient.ts:333-338` | Added Content-Type validation before JSON parse; rejects unexpected content types |

**Remediation — Review #13: 7 of 8 fixed (A-16 backlog)**

1. **S-23** ✅ — Token rotation TOCTOU race closed with double-check under lock (medium)
2. **S-24** ✅ — Lock unlock fallback now verifies spending txid matches expected (low)
3. **B-19** ✅ — `safeParseFields()` helper prevents JSON.parse crashes in certificate queries (low)
4. **B-20** ✅ — Corrupted account resilience in `encryptAllAccounts` (low)
5. **A-16** 🟡 — 51 `no-restricted-imports` warnings tracked as backlog (medium)
6. **Q-21** ✅ — Logger consistency: 5 `console.error` → `logger.error` in Settings components (low)
7. **Q-22** ✅ — Test factory helpers eliminate 20+ `as any` casts in sync.test.ts (low)
8. **Q-23** ✅ — Content-Type validation before JSON parse in httpClient (low)

---

## Review #14 — 2026-02-23 (UI/UX Polish)

16 new findings (4 high, 7 medium, 5 low). All 16 fixed in this session.

| ID | File(s) | Change |
|----|---------|--------|
| U-25 | `ConsolidateModal.tsx`, `TestRecoveryModal.tsx`, `UnlockConfirmModal.tsx` | Migrated 3 modals to shared `<Modal>` component — gains focus trap, ESC, scroll lock, ARIA |
| U-26 | `SimplySatsLogo.tsx` | Replaced 4 hardcoded `#000` with `currentColor` for dark background support |
| U-27 | `Toast.tsx`, `App.css` | Dismiss button always in DOM for keyboard access; visibility via CSS opacity transitions |
| U-28 | `Toast.tsx`, `App.css` | Progressive disclosure: dismiss button visible on `:hover`/`:focus-within`/`:focus-visible` |
| U-29 | `OrdinalListModal.tsx`, `BackupVerificationModal.tsx`, `AccountCreateForm.tsx` | `#22c55e` → `var(--success)` across 5 locations |
| U-30 | `ConsolidateModal.tsx`, `TestRecoveryModal.tsx`, `UnlockConfirmModal.tsx` | 53 inline styles extracted to CSS classes |
| U-31 | `MnemonicInput.tsx`, `AccountModal.tsx` | ~375 lines of embedded `<style>` blocks moved to App.css |
| U-32 | `App.css` | Settings rows `:active` press feedback: `transform: scale(0.995)` |
| U-33 | `App.css` | `18px` → `var(--type-h3-size)`, `12px` → `var(--type-caption-size)` |
| U-34 | `App.css` | Duplicate `.empty-state` rules merged |
| U-35 | `useModalKeyboard.ts` | Removed useEffect watching `selectedIndex` — fixed double-fire of `onItemSelect` |
| U-36 | `PasswordInput.tsx` | Toggle button `tabIndex={-1}` → `tabIndex={0}` for keyboard users |
| U-37 | `SettingsConnectedApps.tsx` | Disconnect buttons: `aria-label={`Disconnect ${app}`}` |
| U-38 | `WalletContext.tsx` | Connected `useAnnounce` for wallet lock/unlock and account switch |
| U-39 | `autoLock.ts`, `WalletContext.tsx` | Auto-lock warning toast 30s before wallet locks |
| U-40 | `SettingsNetwork.tsx`, `SettingsTransactions.tsx` | Inline styles → `.settings-inline-select`, `.settings-inline-input`, `.settings-hint-text` |

**Remediation — Review #14: 16 of 16 fixed**

### High (structural UX gaps)
1. **U-25** ✅ — 3 modals migrated to shared Modal component (focus trap, ESC, scroll lock)
2. **U-26** ✅ — SimplySatsLogo `currentColor` for dark background support
3. **U-27** ✅ — Toast dismiss always in DOM for keyboard accessibility
4. **U-28** ✅ — Progressive disclosure via CSS hover/focus-within

### Medium (visual consistency)
5. **U-29** ✅ — Hex colors replaced with `var(--success)` token
6. **U-30** ✅ — 53 inline styles extracted to CSS classes
7. **U-31** ✅ — 375 lines of embedded `<style>` moved to App.css
8. **U-32** ✅ — Settings row `:active` press feedback
9. **U-33** ✅ — Font sizes aligned to type scale tokens
10. **U-34** ✅ — Duplicate CSS rule merged
11. **U-35** ✅ — useModalKeyboard double-fire bug fixed

### Low (polish)
12. **U-36** ✅ — Password toggle keyboard accessible
13. **U-37** ✅ — Connected apps disconnect button differentiated aria-labels
14. **U-38** ✅ — Screen reader announcements for wallet state changes
15. **U-39** ✅ — Auto-lock 30-second warning toast
16. **U-40** ✅ — Settings inline styles extracted to CSS classes

---

## Review #15 — 2026-02-23 (Deep Semantic Dive)

10 new findings (1 high, 4 medium, 5 low). Deep semantic correctness review targeting areas that heavy refactoring may have introduced subtle issues in, and security vectors previous reviews didn't explore in depth.

| ID | Severity | File(s) | Finding |
|----|----------|---------|---------|
| S-25 | HIGH | `sdk/src/index.ts:207-208` | SDK HMAC response signature verification non-blocking — `console.warn` on mismatch instead of rejecting. MITM on localhost can silently modify responses |
| S-27 | MEDIUM | `sdk/src/index.ts:346-353`, `http_server.rs:565-575` | SDK `listOutputs`/`listLocks` don't send CSRF nonces but server requires them via `validate_and_parse_request`. External SDK consumers will get auth failures |
| B-21 | MEDIUM | `useSyncData.ts:369` | Partial ordinal display on API failure — ternary `apiOrdinals.length > 0 ? apiOrdinals : dbOrdinals` replaces full DB set with partial API set when some calls fail |
| A-17 | MEDIUM | `sync.ts` (1351), `tokens.ts` (1057), `brc100/actions.ts` (957), `locks.ts` (838) | Four monolithic service files exceed 800 LOC with natural splitting seams |
| Q-24 | MEDIUM | `src/hooks/` | 13 of 17 hooks have zero test coverage — most complex logic (useAccountSwitching, useWalletSend, useSyncData) is untested |
| S-28 | LOW | `tauri.conf.json:26` | CSP `img-src https:` allows any HTTPS image — ordinal previews could enable IP tracking |
| B-22 | LOW | `useSyncData.ts:92,229,251` | localStorage quota silently swallowed — cold start shows 0 balance flash |
| A-18 | LOW | Service layer | Error handling pattern fragmentation — ~60% Result, ~40% ad-hoc `{success, error}` or throw |
| Q-25 | LOW | `useOrdinalCache.ts:45-59` | Sequential ordinal DB writes (620+) — batched INSERT significantly faster |
| Q-26 | LOW | `eslint.config.js` | ESLint scans `coverage/` directory — 3 spurious warnings from instrumented files |

**Prioritized Remediation — Review #15**

### Immediate (before next release)
1. **S-25** `sdk/src/index.ts:207-208` — Make HMAC verification blocking: throw or return error on signature mismatch instead of `console.warn`. **Effort: quick** (change warn to throw, add `strictVerification` option defaulting to true)

### Next Sprint
2. **S-27** `sdk/src/index.ts` + `http_server.rs` — Either: (a) exempt read-only operations from nonce requirement in server, or (b) have SDK send nonces for all requests. Option (a) is simpler and more correct. **Effort: quick**
3. **B-21** `useSyncData.ts:369` — Replace ternary with merge logic: only replace DB ordinals with API ordinals when ALL API calls succeed (check error flags). **Effort: quick**
4. **Q-24** `src/hooks/` — Add test files for useAccountSwitching, useWalletSend, useSyncData. Focus on the complex branching paths (Rust vs password fallback, queued switches, abort handling). **Effort: major** (3-5 hours)

### Later
5. **A-17** Service files — Split along natural seams: `sync.ts` → sync orchestration + address sync + UTXO sync; `tokens.ts` → token fetching + token state + token transfer. **Effort: major**
6. **S-28** `tauri.conf.json` — Restrict `img-src` to known ordinal CDN domains (`ordinals.gorillapool.io`). **Effort: quick**
7. **B-22** `useSyncData.ts` — Add `try/catch` with `walletLogger.warn` and consider a `storageAvailable` guard. **Effort: quick**
8. **A-18** Service layer — Continue Result<T,E> migration for remaining ~40% of service methods. **Effort: major** (multi-session)
9. **Q-25** `useOrdinalCache.ts` — Replace sequential upserts with batched SQL INSERT. **Effort: medium**
10. **Q-26** `eslint.config.js` — Add `coverage/` to ESLint ignores array. **Effort: quick** (1 line)
