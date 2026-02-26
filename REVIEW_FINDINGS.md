# Simply Sats — Review Findings
**Latest review:** 2026-02-25 (v18 / Review #18 — Post-Remediation Verification + Deep Review)
**Full report:** `docs/reviews/2026-02-25-full-review-v18.md`
**Rating:** 7.5 / 10 (up from 7.0 — 28 previously-open issues fixed by v17 remediation, 34 new findings)
**Review #18 summary:** Verified v17 remediation (38 fixes applied). 28 previously-open issues now confirmed fixed. 34 new findings (0 critical, 5 high, 21 medium, 8 low). Key discoveries: BRC-100 listener bypasses handler validation (S-61), token transfer missing address validation (S-62), marketplace throws instead of Result (B-55), token fee calc mismatch (B-54).

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
| B-23 | ✅ Fixed (v16) | `accounts.ts:116-124` | `createAccount` deactivates all accounts then inserts new one without `withTransaction()` — INSERT failure leaves all accounts deactivated (no active account). **Fix:** Wrapped deactivate+insert+settings in `withTransaction()` |
| S-29 | ✅ Fixed (v16) | `brc100/handlers.ts:191-199, 287` | BRC-100 lock/unlock handlers don't pass `accountId` — cross-account UTXO spending possible. **Fix:** Added `getActiveAccount()` import, scoped all UTXO/lock queries to `activeAccountId` |
| S-30 | ✅ Fixed (v16) | `brc100/validation.ts:136-156` | `lockBSV`/`unlockBSV` fall through to `default` case — auto-approved for trusted origins. **Fix:** Added explicit `case 'lockBSV':` and `case 'unlockBSV':` to always-approval-required block |
| B-24 | ✅ Fixed (v16) | `useWalletSend.ts:285` | `activeAccountId!` non-null assertion — can be null during initialization. **Fix:** Replaced with null guard returning `err('No active account')` |
| B-25 | ✅ Fixed (v16) | `marketplace.ts:193` | `cancelOrdinalListing` calls `toOrdUtxo(listingUtxo)` without private key. **Fix:** Now passes `ordPk` to `toOrdUtxo()` |
| B-26 | ✅ Fixed (v16) | `marketplace.ts:280` | `purchaseOrdinal` same issue — `toOrdUtxo(listingUtxo)` without key. **Fix:** Now passes `paymentPk` to `toOrdUtxo()` |
| B-27 | ✅ Fixed (v16) | `useSyncData.ts:183-184` | `setOrdBalance(0)` and `setSyncError(null)` fire without `isCancelled` check. **Fix:** Added `if (isCancelled?.()) return` before final state setters |

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
| S-25 | ✅ Fixed (v16) | `sdk/src/index.ts:215-218` | SDK HMAC response signature verification now throws `SimplySatsError` when `strictVerification: true` (default). Conditional warn remains for opt-out consumers |
| A-19 | ✅ Fixed (v16) | `wallet/locks.ts` (839→31 LOC) | locks.ts NOT cleaned up after split. **Fix:** Rewritten as 31-line barrel re-export from `lockCreation`, `lockUnlocking`, `lockQueries` |
| A-20 | ✅ Fixed (v16) | `wallet/lockCreation.ts`, `brc100/script.ts` | `createWrootzOpReturn` duplicated across 3 files. **Fix:** Removed local copy from lockCreation.ts, now imports from `brc100/script` with type adapter |
| Q-27 | ✅ Fixed (v16) | `lockUnlocking.ts` | `unlockBSV` and `generateUnlockTxHex` share ~80 lines of identical code. **Fix:** Extracted `buildUnlockTransaction()` shared helper, both functions delegate to it |
| S-43 | ✅ Fixed (v18) | `brc100/handlers.ts:79-83,90-94,360-365,412-415,438-439` | `getParams<T>()` now has runtime validation for all handler params (identityKey, data, plaintext, ciphertext, tag) |
| S-47 | ✅ Mitigated (v18) | `key_store.rs:386-413` | `get_wif_for_operation` documented as transitional bridge with security notes + warning log. WIF not persisted in React state |
| B-42 | ✅ Fixed (v18) | `tokens/transfers.ts:263-283` | Token transfer now calls `markUtxosSpent()` and `recordSentTransaction()` immediately after broadcast |
| B-43 | ✅ Fixed (v18) | `tokens/transfers.ts:310-340` | `getTokenUtxosForSend()` fetches from both wallet and ord addresses in parallel, combines and sorts |
| S-61 | 🟠 Open-High | `brc100/listener.ts:92-102,155-187` | Listener auto-response bypasses handler validation — getPublicKey, lockBSV, unlockBSV fast-path has no runtime type checking |
| S-62 | 🟠 Open-High | `tokens/transfers.ts:103-119` | Token transfer missing `isValidBSVAddress()` validation — invalid address causes permanent irreversible token loss |
| S-63 | 🟠 Open-High | `brc100/handlers.ts:90-96,360-365,411-415` | No size limits on byte arrays in encrypt/decrypt/sign handlers — approved app can send multi-MB payloads causing memory exhaustion |
| B-54 | 🟠 Open-High | `tokens/transfers.ts:169-183` | Fee calculated for max 2 funding inputs but selection loop adds N inputs — fee underestimated when N>2 |
| B-55 | 🟠 Open-High | `wallet/marketplace.ts:162,240` | `cancelOrdinalListing` and `purchaseOrdinal` throw instead of returning Result — breaks error handling contract |
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
| S-27 | ✅ Fixed (v18) | `sdk/src/index.ts:365-374` | SDK `listOutputs()` now accepts optional `nonce` parameter for CSRF |
| B-21 | ✅ Fixed (v16) | `useSyncData.ts:369-371` | Partial ordinal display on API failure — now uses `allOrdinalApiCallsSucceeded` flag to guard DB-to-API replacement |
| A-17 | ✅ Fixed (v16) | `sync/`, `tokens/`, `brc100/`, `wallet/lock*` | All four monolithic files split into focused modules. `sync.ts` → 4 modules, `tokens.ts` → 4 modules, `actions.ts` → 3 modules, `locks.ts` → 3 modules |
| S-42 | ✅ Fixed (v18) | `handlers.ts:412-415` | Runtime validation added — validates ciphertext is array of bytes 0-255 before ECIES decrypt |
| S-44 | ✅ Fixed (v18) | `keyDerivation.ts:455` | Length-prefixed serialization prevents tag collision from concatenation attacks |
| S-46 | ✅ Fixed (v18) | `brc100/utils.ts:21-26` | `crypto.getRandomValues()` replaces `Math.random()` for request IDs |
| S-48 | ✅ Fixed (v18) | `rate_limiter.rs` | Rate limiting module implemented for Tauri IPC commands |
| S-49 | ✅ Fixed (v18) | `sdk/index.ts:206-232` | HMAC verification properly handles missing/failed signatures with `strictVerification` flag |
| S-50 | ✅ Fixed (v18) | `brc100/script.ts:13-19` | `Number.isSafeInteger()` + range check 0 to 2^31-1 added to `encodeScriptNum` |
| S-51 | ✅ Fixed (v18) | `brc100/locks.ts:94` | Changed from `identityPubKey` to `walletPubKey` to match unlock path |
| S-53 | ✅ Fixed (v18) | `key_store.rs:209-222` | `get_mnemonic_once()` immediately zeroizes mnemonic after retrieval |
| S-57 | ✅ Accepted (v18) | `keyDerivation.ts:477-480` | Documented as intentional for BRC-42 interop — gated behind user approval in executeApprovedRequest |
| S-58 | ✅ Partial (v18) | `handlers.ts:207-213` | Origin-based hostname checking added for lock operations. Full per-origin scoping deferred |
| S-59 | ✅ Accepted (v18) | `lib.rs:576-588` | Documented as accepted trade-off — CSP + Tauri webview isolation mitigate XSS risk |
| B-39 | ✅ Fixed (v18) | `App.tsx:165-192` | Proper cleanup with `stopListener?.()` return; refs prevent stale closures |
| B-41 | ✅ Fixed (v18) | `App.tsx:325` | `if (cancelled) break` explicitly checks cancelled flag inside async loop |
| B-45 | ✅ Fixed (v18) | `App.tsx:484-485` | `if (locksToUnlock.length > 1) break` exits loop on first failure |
| B-47 | ✅ Fixed (v18) | `App.tsx:363-371` | Cancellation check moved before param clearing with comment |
| B-53 | ✅ Fixed (v18) | `utxoRepository.ts:710-720` | Safety check queries `accounts` table — skips reassignment if account 1 is legitimate |
| A-30 | ✅ Fixed (v18) | `AppProviders.tsx:58-65` | JSX indentation properly aligned |
| A-31 | ✅ Fixed (v18) | `brc100/index.ts` | Comprehensive barrel exports including all handler functions |
| A-32 | ✅ Fixed (v18) | `src/utils/tauri.ts` | `isTauri()` centralized to shared utility module — all files import from utils/tauri |
| S-64 | 🟡 Open-Medium | `wallet/marketplace.ts:75-83,240-247` | Marketplace operations skip address validation for payAddress/ordAddress — invalid address causes permanent fund loss |
| S-65 | 🟡 Open-Medium | `tokens/transfers.ts:170,249` | Token transfer fee uses estimated output count, not actual — over/under-pay fees |
| S-66 | 🟡 Open-Medium | `brc100/handlers.ts:378-382` | Public key regex-validated but not validated on secp256k1 curve — invalid keys cause downstream ECDH failure |
| S-67 | 🟡 Open-Medium | `brc100/handlers.ts:111` | Unbounded outputs array in createAction — no limit on actionRequest.outputs size |
| S-68 | 🟡 Open-Medium | `crypto.ts:382-389` | Ciphertext min size not validated — buffer < 28 bytes produces empty slices and cryptic errors |
| S-69 | 🟡 Open-Medium | `brc100/handlers.ts:437-442` | Tag parameter unbounded length in getTaggedKeys — multi-MB strings cause expensive key derivation |
| S-70 | 🟡 Open-Medium | `wallet/marketplace.ts:82,89` | Marketplace price/fee not validated — priceSats can be 0, NaN, or excessive |
| B-56 | 🟡 Open-Medium | `wallet/marketplace.ts:268-287` | Purchase pending-spend rollback silently fails — UTXOs stuck in pending state for 5 min |
| B-57 | 🟡 Open-Medium | `wallet/transactions.ts:458,468` | Consolidation missing accountId — records to wrong account in multi-account setups |
| B-58 | 🟡 Open-Medium | `wallet/marketplace.ts:130-143,207-220,291-304` | Post-broadcast DB errors silently swallowed — transaction exists on-chain but not in local DB |
| B-59 | 🟡 Open-Medium | `wallet/lockCreation.ts:61-68` | lockBSV missing accountId validation — unlike sendBSV, allows undefined accountId to DB operations |
| B-60 | 🟡 Open-Medium | `useSyncData.ts:164-167,323-324` | Concurrent syncs race on contentCacheRef — one overwrites the other's ordinal cache |
| B-61 | 🟡 Open-Medium | `useSyncOrchestration.ts:103-108` | Stale sync error persists after account switch — cancelled check prevents error clearing |
| B-62 | 🟡 Open-Medium | `OrdinalImage.tsx:51-86` | Effect has incomplete dependencies — cachedContent changes not detected when contentData ref unchanged |
| A-35 | 🟡 Open-Medium | `brc100/handlers.ts:73-489` | Response object mutation pattern — 41+ assignments across 10+ switch cases, hard to audit |
| A-36 | 🟡 Open-Medium | `brc100/index.ts:102-106` | Undocumented module split — unclear which module (actions vs handlers) owns request lifecycle |
| Q-53 | 🟡 Open-Medium | `brc100/handlers.ts:277-287` | Outpoint parsing allows malformed input — `split('.')` silently drops extra segments |
| Q-54 | 🟡 Open-Medium | `tokens/transfers.ts:137-141` | BigInt validation incomplete — `BigInt('abc')` or `BigInt('1.5')` throws unhandled SyntaxError |
| Q-55 | 🟡 Open-Medium | `brc100/handlers.ts,validation.ts` | 41+ magic JSON-RPC error codes scattered — no centralized constants |
| Q-56 | 🟡 Open-Medium | `src/utils/tauri.ts` | No tests for new shared utility — `isTauri()` and `tauriInvoke()` untested |
| Q-57 | 🟡 Open-Medium | `brc100/handlers.ts` | No tests for extracted handler module — 400+ lines of security-sensitive code untested |
| Q-58 | 🟡 Open-Medium | `tokens/transfers.ts:119-141` | Redundant dual validation — sendToken and transferToken validate separately, direct callers bypass |
| Q-42 | 🟡 Open-Medium | 10+ files | UTXO `lockingScript`→`script` mapping repeated 10+ times — extract `toWalletUtxo()` |
| Q-43 | 🟡 Open-Medium | `useWalletSend.ts` | Derived address key resolution duplicated in handleSend/handleSendMulti (~70 lines each) |
| Q-44 | 🟡 Open-Medium | All components | Zero components use `React.memo` — every state change re-renders all tabs |
| Q-46 | 🟡 Open-Medium | `src/contexts/` | 6 of 9 context providers lack tests (WalletContext, SyncContext, AccountsContext, etc.) |
| Q-49 | 🟡 Open-Medium | `SyncContext.tsx:130` | `ordinalContentCache` as `useState<Map>` causes re-render on every cache entry |
| Q-52 | 🟡 Open-Medium | `brc100/locks.ts:97-106` | Manual greedy coin selection instead of domain `selectCoins()` — bug risk |
| Q-24 | 🟡 Open-Medium | `src/hooks/` | 12 of 17 hooks have zero test coverage (was 11/16). Tested: useKeyboardNav, useWalletActions, useAccountSwitching, useOrdinalCache, useSyncData. Still untested: useWalletSend, useWalletLock, useBRC100, useSyncOrchestration, useWalletInit, + 7 others |
| A-16 | 🟡 Backlog | 52 component files | 52 `no-restricted-imports` lint warnings (was 51) — components importing directly from `services/` instead of context hooks |
| S-31 | ✅ Fixed (v16) | `brc100/handlers.ts:155-166` | `params.satoshis as number` and `params.blocks as number` — no runtime validation. **Fix:** Added typeof/isFinite/positive/integer checks with `-32602` error codes |
| S-32 | ✅ Fixed (v16) | `storage.ts:150-151, 319-320` | `changePassword` only checks min length, not `validatePassword()` complexity. **Fix:** Replaced simple length check with `validatePassword()` in `saveWallet` and `changePassword` |
| S-33 | ✅ Fixed (v16) | `brc100/locks.ts:159-193` | Saves UTXO and lock to DB BEFORE broadcast. **Fix:** Moved DB writes after broadcast success |
| S-34 | ✅ Fixed (v16) | `brc100/locks.ts:62-67` | `createLockTransaction` has no input validation. **Fix:** Added satoshis/blocks validation matching `lockCreation.ts` pattern |
| S-35 | ✅ Fixed (v16) | `sdk/src/index.ts:212` | HMAC verification re-serializes JSON. **Fix:** Changed to `response.text()` + `JSON.parse()` so HMAC verifies raw bytes |
| S-36 | ✅ Mitigated (v16) | `lockUnlocking.ts:196-218` | Lock marked unlocked even when spending txid doesn't match expected. **Mitigation:** Added explicit warning log; UTXO is provably spent regardless |
| B-28 | ✅ Fixed (v16) | `RestoreModal.tsx:144-193` | Full backup restore doesn't call `storeKeysInRust()`. **Fix:** Added `invoke('store_keys', ...)` calls for both mnemonic and keys restore paths |
| B-29 | ✅ Fixed (v16) | `RestoreModal.tsx:80-92` | Encrypted backup decryption failure silently falls through. **Fix:** Catch block now detects encrypted format and shows explicit "wrong password" error toast |
| B-30 | ✅ Fixed (v16) | `SettingsSecurity.tsx:149-172` | React `sessionPassword` state not updated after setting password. **Fix:** Added `setSessionPassword(newPassword)` call |
| B-31 | ✅ Fixed (v16) | `accounts.ts:380-399` | `deleteAccount` switches account outside transaction. **Fix:** Wrapped post-delete `switchAccount` in try/catch |
| B-32 | ✅ Fixed (v16) | `accounts.ts:596-603` | `encryptAllAccounts` Phase 2 transaction failure throws unhandled. **Fix:** Wrapped in try/catch returning `err()` |
| B-33 | ✅ Fixed (v16) | `addressSync.ts:105-114` | Returns `totalBalance: 0` on API failure. **Fix:** Returns `totalBalance: -1` sentinel on failure |
| B-34 | ✅ Fixed (v16) | `orchestration.ts:530-531` | Phantom lock cleanup without `account_id` scoping. **Fix:** Added `AND account_id = $2` to DELETE query |
| B-35 | ✅ Fixed (v16) | `useSyncData.ts:384-401` | `dbTxHistory` array mutated in-place after React state set. **Fix:** Created copy with `[...dbTxHistory]` before mutation |
| A-21 | ✅ Fixed (v16) | `sync/addressSync.ts:20` | Submodules import types from own barrel. **Fix:** Created `sync/types.ts` for shared types, updated import |
| A-22 | ✅ Fixed (v16) | `addressSync.ts:223`, `orchestration.ts:607,620` | Dynamic `await import()` for DB calls. **Fix:** Converted to static imports |
| A-23 | ✅ Fixed (v16) | `historySync.ts:52-110` | Two `calculateTxAmount` with same name. **Fix:** Added cross-referencing docs about intentional differences |
| A-24 | ✅ Fixed (v16) | `brc100/actions.ts:1-15` | Barrel re-export missing `executeApprovedRequest`. **Fix:** Added to re-exports |
| A-25 | ✅ Fixed (v16) | `historySync.ts:32` | Exports mutable `txDetailCache` directly. **Fix:** Made private, added getter/setter accessors |
| Q-28 | ✅ Fixed (v16) | `accounts.ts:154,185,215,245` | `AccountRow` → `Account` mapping copy-pasted 4×. **Fix:** Extracted `mapRowToAccount()` helper |
| Q-29 | 🟡 Open-Medium | `validation.ts:106,127,139` | Promise-based approval queue pattern repeated 3 times — should extract `queueForApproval()` helper |
| Q-30 | 🟡 Open-Medium | `marketplace.ts:15` | `type AnyPrivateKey = any` disables type checking at SDK boundary |
| Q-31 | 🟡 Open-Medium | `marketplace.test.ts` | `purchaseOrdinal` has only 1 test (error case). No happy path, rollback, or fee tests |
| Q-32 | 🟡 Open-Medium | `useSyncData.test.ts` | No concurrent-sync race condition tests — doesn't verify two simultaneous `fetchData` calls with different accountIds |
| Q-33 | 🟡 Open-Medium | `orchestration.ts:462-474` | Sequential tx history sync — scales linearly with address count. Should use `batchWithConcurrency` |
| Q-34 | ✅ Fixed (v16) | `accounts.ts:195,225,255` | Silent `catch (_e) { return null }` with no logging. **Fix:** Added `accountLogger.warn()` in catch blocks |
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
| S-28 | ✅ Fixed (v16) | `tauri.conf.json:26` | CSP `img-src` now restricted to `https://ordinals.gorillapool.io` instead of wildcard `https:` |
| B-22 | ⚪ Mitigated (v16) | `useSyncData.ts:92` | localStorage quota now logs `syncLogger.warn` instead of silent catch. Underlying 0-balance flash remains |
| A-18 | ⚪ Open-Low | Service layer | Error handling pattern fragmentation — new modules replicate existing inconsistency. ~60% Result pattern |
| Q-25 | ✅ Fixed (v16) | `useOrdinalCache.ts:42-56` | `batchUpsertOrdinalCache(cacheEntries)` replaces sequential per-ordinal upserts |
| Q-26 | ✅ Fixed (v16) | `eslint.config.js:9` | `coverage` added to `globalIgnores` array |
| S-37 | ✅ Fixed (v16) | `accounts.ts:434,436` | `parseInt` without NaN guard. **Fix:** Added `Number.isFinite()` guard with fallback to defaults |
| S-38 | ✅ Fixed (v16) | `accounts.ts:438` | `JSON.parse` for `trustedOrigins` without array validation. **Fix:** Added `Array.isArray()` check |
| S-39 | ✅ Fixed (v16) | `storage.ts:134-137` | Unprotected mode stores plaintext keys in localStorage. **Fix:** Added security warning comments |
| S-40 | ✅ Fixed (v16) | `accounts.ts:146-168` | `getAllAccounts()` returns `encryptedKeys` for all accounts. **Fix:** Added JSDoc warning about exposure |
| S-41 | ✅ Fixed (v16) | `lockCreation.ts:90-96` | No dust limit validation for lock amount. **Fix:** Added soft dust limit warning for locks < 135 sats |
| B-36 | ✅ Fixed (v16) | `accounts.ts:536-539` | `getNextAccountNumber` uses `accounts.length + 1`. **Fix:** Now scans existing names for max index |
| B-37 | ⚪ Open-Low | `tokens/transfers.ts:108-163` | Single WIF for all token inputs — tokens spanning wallet + ordinals addresses can't be combined |
| B-38 | ✅ Fixed (v16) | `ordinalRepository.ts:210-212` | Origin parsing `parseInt` can produce NaN. **Fix:** Added `Number.isFinite()` guard |
| A-26 | ⚪ Open-Low | `useSyncData.ts:31-41` | Hook has 9 parameters — wide interface, hard to test |
| A-27 | ⚪ Open-Low | `tokens/state.ts`, `tokens/fetching.ts` | Bidirectional dependency between state and fetching modules |
| A-28 | ⚪ Open-Low | All new modules | Inconsistent error handling: Result in locks, ad-hoc in sync, inline objects in BRC-100 |
| A-29 | ⚪ Open-Low | `historySync.ts:120-330` | `syncTransactionHistory` still 210+ lines with 8 responsibilities in one function |
| Q-35 | ⚪ Open-Low | `marketplace.ts:37-41,46-50` | Hex-to-base64 conversion duplicated in `toOrdUtxo` |
| Q-36 | ⚪ Open-Low | `ordinalRepository.ts` | Conditional accountId query pattern repeated throughout — extract `withOptionalAccountFilter` |
| Q-37 | ⚪ Open-Low | `marketplace.ts:119,198,286` | `as unknown as Transaction` at SDK boundary — 3 occurrences |
| Q-38 | ⚪ Open-Low | `lockUnlocking.ts:133-155,328-344` | `as number[]` casts on BSV SDK returns — 10 occurrences |
| Q-39 | ⚪ Open-Low | `useSyncData.ts:185,439` | Large `useCallback` dependency arrays with 9 entries |
| Q-40 | ⚪ Open-Low | `formatting.ts:34-264` | 230-line `buildAndBroadcastAction` wrapped in single try/catch |
| Q-41 | ⚪ Open-Low | `brc100/handlers.ts` | Generic internal error messages passed to external BRC-100 callers — could leak implementation details |
| S-45 | ⚪ Open-Low | `handlers.ts:201` | `includes('wrootz')` permissive substring check for basket routing |
| S-52 | ⚪ Open-Low | `accounts.ts:249` | Non-atomic account switch creates brief dual-active window |
| S-54 | ⚪ Open-Low | `http_server.rs:249` | 10MB response body limit in HMAC signing middleware |
| S-55 | ⚪ Open-Low | `keyDerivation.ts:211` | Unbounded `KNOWN_SENDER_PUBKEYS` growth — no limit or validation |
| S-56 | ⚪ Open-Low | `keyDerivation.ts:226` | `loadKnownSenders` doesn't validate parsed JSON array contents |
| S-60 | ⚪ Open-Low | `crypto.ts:275` | `isLegacyEncrypted` parses untrusted data without size limits |
| B-40 | ⚪ Open-Low | `App.tsx:244-301` | Double `setSyncPhaseRef.current(null)` — no error feedback on failed initial sync |
| B-44 | ⚪ Open-Low | `LocksContext.tsx:94-111` | `detectLocks` ignores pre-fetched UTXOs, makes redundant API call |
| B-46 | ⚪ Open-Low | `useSyncData.ts:78` | Falsy check on `activeAccountId` would fail if ID is ever 0 |
| S-71 | ⚪ Open-Low | `brc100/handlers.ts:168-177` | No satoshis upper bound in lockBSV — validated as positive integer but no BSV supply cap |
| S-72 | ⚪ Open-Low | `domain/transaction/builder.ts:586-647` | Multi-output send has no output count limit — could exceed relay limits |
| B-63 | ⚪ Open-Low | `Header.tsx:31-54` | useEffect triggers on every balance change — unnecessary re-fetches of all account balances |
| B-49 | ⚪ Open-Low | `App.tsx:396-416` | Post-discovery sync uses stale `activeAccountId` from closure |
| B-50 | ⚪ Open-Low | `useBrc100Handler.ts:97` | BRC-100 listeners torn down on every render — incoming requests lost during gap |
| A-33 | ⚪ Open-Low | `SyncContext.tsx:59-65` | Raw state setters exposed in context API — invites uncoordinated mutations |
| A-34 | ⚪ Open-Low | `ConnectedAppsContext.tsx` | O(n) array lookups via `includes()` — should use `Set` |
| Q-47 | ⚪ Open-Low | `src/services/brc100/` | 8+ BRC-100 sub-modules lack tests (formatting, handlers, locks, etc.) |
| Q-48 | ⚪ Open-Low | `LocksContext.tsx:94` | Unused `_providedUtxos` parameter in `detectLocks` — misleads callers |
| Q-50 | ⚪ Open-Low | `ModalContext.tsx:79-140` | Trivial `useCallback` wrappers around single `setState` calls |
| Q-51 | ⚪ Open-Low | `migrations/010,011` | Legacy DML migrations lack clarifying comments about lesson learned |
| Q-9 | ✅ Verified | `keyDerivation.ts:260-262` | Dev-only code guarded |

---

## Summary: Issue Status

| Category | Total | ✅ Fixed/Verified/Accepted | 🟠 High Open | 🟡 Medium Open | ⚪ Low Open |
|----------|-------|---------------------------|--------------|----------------|-------------|
| Security | 72 | 40 (3 accepted) | 3 (S-61,62,63) | 7 (S-64-70) | 9 (S-45,52,54-56,60,71,72 + prior) |
| Bugs | 63 | 35 | 2 (B-54,55) | 7 (B-56-62) | 9 (B-22,37,40,44,46,49,50,63 + prior) |
| Architecture | 36 | 21 | 0 | 4 (A-16,35,36 + prior) | 7 (A-18,26-29,33,34) |
| Quality | 58 | 28 | 0 | 15 (Q-24,29,30,32,42-44,46,53-58) | 11 (Q-35-41,47,48,50,51) |
| UX/UI | 40 | 40 | 0 | 0 | 0 |
| Stability | 13 | 13 | 0 | 0 | 0 |
| **Total** | **282** | **177 (3 accepted)** | **5** | **33 (1 backlog)** | **36** |

---

## Remaining Open Items (as of Review #18)

### High Priority — Fix Before Release
- **S-61** — BRC-100 listener auto-response bypasses handler validation — getPublicKey, lockBSV, unlockBSV fast-path has no runtime type checking
- **S-62** — Token transfer missing `isValidBSVAddress()` validation — permanent irreversible token loss
- **S-63** — No size limits on byte arrays in BRC-100 encrypt/decrypt/sign handlers — memory exhaustion DoS
- **B-54** — Token transfer fee calculated for max 2 inputs but selection loop adds N inputs — fee underestimated
- **B-55** — Marketplace `cancelOrdinalListing`/`purchaseOrdinal` throw instead of returning Result — breaks error handling

### Medium Priority — Next Sprint
**Security:**
- **S-64** — Marketplace skips address validation for payAddress/ordAddress
- **S-65** — Token transfer fee uses estimated output count, not actual
- **S-66** — Public key regex-validated but not validated on secp256k1 curve
- **S-67** — Unbounded outputs array in createAction
- **S-68** — Ciphertext min size not validated before slice in decryptWithSharedSecret
- **S-69** — Tag parameter unbounded length in getTaggedKeys
- **S-70** — Marketplace price/fee not validated (0, NaN, excessive allowed)

**Bugs:**
- **B-56** — Marketplace purchase pending-spend rollback silently fails — UTXOs stuck 5 min
- **B-57** — Consolidation missing accountId — records to wrong account
- **B-58** — Post-broadcast DB errors silently swallowed in marketplace
- **B-59** — lockBSV missing accountId validation (unlike sendBSV)
- **B-60** — Concurrent syncs race on contentCacheRef — cache corruption
- **B-61** — Stale sync error persists after account switch
- **B-62** — OrdinalImage effect incomplete dependencies — stale content

**Architecture:**
- **A-16** — 52 `no-restricted-imports` lint warnings (backlog)
- **A-35** — Response object mutation pattern in handlers (41+ assignments)
- **A-36** — Undocumented module split in brc100 barrel exports

**Quality:**
- **Q-24** — 12+ hooks untested (critical: useWalletSend, useWalletLock, useBRC100)
- **Q-29** — Promise-based approval queue pattern repeated 3x
- **Q-30** — `type AnyPrivateKey = any` disables type checking
- **Q-32** — No concurrent-sync race condition tests
- **Q-42** — UTXO `lockingScript`→`script` mapping repeated 10+ times
- **Q-43** — Derived address key resolution duplicated ~70 lines each
- **Q-44** — Zero components use `React.memo`
- **Q-46** — 6+ context providers lack tests
- **Q-53** — Outpoint parsing allows malformed input (split('.') drops extra segments)
- **Q-54** — BigInt validation incomplete — BigInt('abc') throws unhandled SyntaxError
- **Q-55** — 41+ magic JSON-RPC error codes — no centralized constants
- **Q-56** — No tests for src/utils/tauri.ts (new shared utility)
- **Q-57** — No tests for extracted brc100/handlers.ts (400+ lines security-sensitive)
- **Q-58** — Redundant dual validation in token transfers (sendToken vs transferToken)

### Low / Deferred
**Security:** S-45, S-52, S-54, S-55, S-56, S-60, S-71, S-72
**Bugs:** B-22 (mitigated), B-37, B-40, B-44, B-46, B-49, B-50, B-63
**Architecture:** A-18, A-26, A-27, A-28, A-29, A-33, A-34
**Quality:** Q-35, Q-36, Q-37, Q-38, Q-39, Q-40, Q-41, Q-47, Q-48, Q-50, Q-51

### Accepted Risk
- **S-17** — `SENSITIVE_KEYS` empty in secureStorage
- **S-57** — `getKnownTaggedKey` returns root private keys — intentional for BRC-42 interop
- **S-59** — Session token accessible to any JS context — CSP + webview isolation mitigate

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
5. **A-17** ✅ Fixed (v16) — All four monoliths split into focused modules
6. **S-28** ✅ Fixed (v16) — CSP `img-src` restricted to `ordinals.gorillapool.io`
7. **B-22** ⚪ Mitigated (v16) — Now logs `syncLogger.warn` on quota error
8. **A-18** Service layer — Continue Result<T,E> migration for remaining ~40% of service methods. **Effort: major** (multi-session)
9. **Q-25** ✅ Fixed (v16) — `batchUpsertOrdinalCache` replaces sequential upserts
10. **Q-26** ✅ Fixed (v16) — `coverage` added to ESLint globalIgnores

---

## Review #16 — 2026-02-23 (Architectural Refactoring Review)

55 new findings (1 critical, 10 high, 27 medium, 17 low). Major refactoring review covering monolith splitting, hook extraction, multi-account rewrite. 6 prior issues confirmed fixed.

### Prior Issues Fixed in v16
| ID | Fix |
|----|-----|
| S-25 | `strictVerification` defaults to `true`, throws `SimplySatsError` on HMAC mismatch |
| B-21 | `allOrdinalApiCallsSucceeded` flag guards DB-to-API ordinal replacement |
| A-17 | All 4 monoliths split: sync/ (4), tokens/ (4), brc100/ (3), wallet/lock* (3) |
| S-28 | CSP `img-src` restricted to `https://ordinals.gorillapool.io` |
| Q-25 | `batchUpsertOrdinalCache(cacheEntries)` for batched DB writes |
| Q-26 | `coverage` added to `globalIgnores` in eslint.config.js |

### New Findings Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Security (S-29—S-41) | 0 | 2 | 6 | 5 |
| Bugs (B-23—B-38) | 1 | 4 | 8 | 3 |
| Architecture (A-19—A-29) | 0 | 2 | 5 | 4 |
| Quality (Q-27—Q-41) | 0 | 1 | 7 | 7 |
| **Total** | **1** | **9** | **26** | **19** |

**Prioritized Remediation — Review #16**

### Immediate (before merge)
1. **B-23** `accounts.ts:116-124` — Wrap `createAccount`'s deactivate + insert in `withTransaction()`. **Effort: quick**
2. **S-29** `brc100/handlers.ts:191,287` — Pass `accountId` to `walletLockBSV`, `walletUnlockBSV`, and `getSpendableUTXOs`. **Effort: quick**
3. **S-30** `brc100/validation.ts:136-156` — Move lockBSV/unlockBSV into explicit always-approval-required case blocks. **Effort: quick**
4. **A-19** `wallet/locks.ts` — Complete the split: convert locks.ts to barrel re-export from lockCreation/lockQueries/lockUnlocking, update all imports. **Effort: medium**
5. **B-27** `useSyncData.ts:183` — Add `if (isCancelled?.()) return` before `setOrdBalance(0)`. **Effort: quick**
6. **B-24** `useWalletSend.ts:285` — Replace `activeAccountId!` with null guard. **Effort: quick**
7. **B-25/B-26** `marketplace.ts:193,280` — Ensure listing UTXO scripts populated before `toOrdUtxo`. **Effort: medium**

### High priority (before release)
8. **A-20** Consolidate `createWrootzOpReturn` to single shared utility. **Effort: quick**
9. **Q-27** Extract `buildUnlockTransaction()` shared by `unlockBSV` and `generateUnlockTxHex`. **Effort: medium**
10. **S-31** `brc100/handlers.ts:155-156` — Add runtime validation for satoshis/blocks params. **Effort: quick**
11. **S-34** `brc100/locks.ts:62-67` — Add input validation to `createLockTransaction`. **Effort: quick**
12. **S-35** `sdk/src/index.ts:212` — Verify HMAC over raw response text, not re-serialized JSON. **Effort: quick**
13. **S-36** `lockUnlocking.ts:196-218` — Return warning when spending txid doesn't match expected. **Effort: quick**
14. **B-28** `RestoreModal.tsx:144-193` — Call `storeKeysInRust()` after full backup restore. **Effort: quick**

### Next sprint
15. **S-32** — Use `validatePassword()` in `changePassword`. **Effort: quick**
16. **S-33** — BRC-100 lock: broadcast before DB write, or cleanup on failure. **Effort: medium**
17. **B-29** — Differentiate encrypted backup decrypt failure from JSON parse error. **Effort: quick**
18. **B-30** — Update React `sessionPassword` state after setting password in Settings. **Effort: quick**
19. **B-31** — Include account activation inside deleteAccount transaction. **Effort: medium**
20. **B-32** — Wrap `encryptAllAccounts` Phase 2 in try/catch returning `err()`. **Effort: quick**
21. **B-33** — Return sentinel for API failure in syncAddress, not 0. **Effort: quick**
22. **B-34** — Add `AND account_id` to phantom lock cleanup DELETE. **Effort: quick**
23. **B-35** — Copy `dbTxHistory` before in-place mutation. **Effort: quick**
24. **A-21** — Create `types.ts` in sync/ and tokens/ for shared types. **Effort: quick**
25. **Q-24** — Add tests for useWalletSend, useWalletLock, useBRC100. **Effort: major**

---

## Review #17 — 2026-02-24 (Comprehensive Deep Review)

46 new findings (0 critical, 4 high, 26 medium, 16 low). Full four-phase review: deep security audit, bug detection, architecture review, code quality analysis. All v16 fixes verified intact. 1748 tests passing, lint/typecheck clean.

### New Findings by Phase

**Phase 1 — Security (19 findings: 2 high, 11 medium, 6 low)**

| ID | Sev | File | Finding |
|----|-----|------|---------|
| S-42 | MED | `handlers.ts:401` | `ciphertext as number[]` — no runtime type check before ECIES decrypt |
| S-43 | HIGH | `brc100/types.ts:145` | `getParams<T>()` returns `params as T` — zero runtime validation on external input |
| S-44 | MED | `handlers.ts:437` | Unsanitized `request.origin` in tagged key derivation tag string |
| S-45 | LOW | `handlers.ts:201` | `includes('wrootz')` permissive substring match for basket routing |
| S-46 | MED | `brc100/utils.ts:21` | `Math.random()` for BRC-100 request IDs |
| S-47 | HIGH | `key_store.rs:398` | `get_wif_for_operation` returns raw WIF to JavaScript heap |
| S-48 | MED | `key_store.rs` | No rate limiting on Tauri IPC signing commands |
| S-49 | MED | `sdk/index.ts:207` | HMAC verification silently skipped when signature header missing |
| S-50 | MED | `brc100/script.ts:12` | `encodeScriptNum` integer overflow for values > 2^31 |
| S-51 | MED | `brc100/locks.ts:92` | CLTV lock uses `identityPubKey`; native unlock expects `walletPubKey` |
| S-52 | LOW | `accounts.ts:249` | Non-atomic account switch — brief dual-active window |
| S-53 | MED | `key_store.rs:103` | Raw mnemonic passes through JS heap before Rust store |
| S-54 | LOW | `http_server.rs:249` | 10MB response body limit in HMAC signing middleware |
| S-55 | LOW | `keyDerivation.ts:211` | Unbounded `KNOWN_SENDER_PUBKEYS` growth |
| S-56 | LOW | `keyDerivation.ts:226` | `loadKnownSenders` no JSON validation |
| S-57 | MED | `keyDerivation.ts:471` | `getKnownTaggedKey` returns root private keys for "yours" label |
| S-58 | MED | `handlers.ts:72` | No per-origin permission scoping — approved app gets full wallet access |
| S-59 | MED | `lib.rs:582` | Session token accessible from any JS context via Tauri command |
| S-60 | LOW | `crypto.ts:275` | `isLegacyEncrypted` parses untrusted data without size limits |

**Phase 2 — Bugs (15 findings: 2 high, 5 medium, 8 low)**

| ID | Sev | File | Finding |
|----|-----|------|---------|
| B-39 | MED | `App.tsx:165-193` | Payment listener not torn down on effect re-fire — orphaned listeners |
| B-40 | LOW | `App.tsx:244-301` | Double `setSyncPhaseRef.current(null)` — no error feedback on failed sync |
| B-41 | MED | `App.tsx:320-343` | Background sync for inactive accounts ignores `cancelled` flag |
| B-42 | HIGH | `tokens/transfers.ts:108-270` | Token transfer never calls `recordSentTransaction` or `markUtxosPendingSpend` |
| B-43 | HIGH | `tokens/transfers.ts:275-348` | `sendToken` single WIF — can't combine wallet + ord address UTXOs |
| B-44 | LOW | `LocksContext.tsx:94-111` | `detectLocks` ignores pre-fetched UTXOs, makes redundant API call |
| B-45 | MED | `App.tsx:468-485` | "Unlock All" no error short-circuit, always closes modal |
| B-46 | LOW | `useSyncData.ts:78` | Falsy check `activeAccountId` fails if ID is 0 |
| B-47 | MED | `App.tsx:362-372` | Discovery params cleared before cancel check — concurrent switch loss |
| B-49 | LOW | `App.tsx:396-416` | Post-discovery sync uses stale `activeAccountId` from closure |
| B-50 | LOW | `useBrc100Handler.ts:97` | BRC-100 listeners torn down/rebuilt on every render |
| B-53 | MED | `utxoRepository.ts:703-759` | `reassignAccountData` takes data from legitimate account 1 |

**Phase 3 — Architecture (5 findings: 0 high, 3 medium, 2 low)**

| ID | Sev | File | Finding |
|----|-----|------|---------|
| A-30 | MED | `AppProviders.tsx:58-65` | JSX indentation doesn't match logical provider nesting |
| A-31 | MED | `brc100/index.ts` | Barrel missing 5+ exports (`verifyDataSignature`, etc.) |
| A-32 | MED | 8 files | `isTauri()` copy-pasted — should be shared utility |
| A-33 | LOW | `SyncContext.tsx:59-65` | Raw state setters exposed in context API |
| A-34 | LOW | `ConnectedAppsContext.tsx` | O(n) array lookups via `includes()` — should use `Set` |

**Phase 4 — Quality (11 findings: 0 high, 7 medium, 4 low)**

| ID | Sev | File | Finding |
|----|-----|------|---------|
| Q-42 | MED | 10+ files | UTXO `lockingScript`→`script` mapping repeated 10+ times |
| Q-43 | MED | `useWalletSend.ts` | Derived address key resolution duplicated ~70 lines |
| Q-44 | MED | All components | Zero `React.memo` usage — every state change re-renders all tabs |
| Q-46 | MED | `src/contexts/` | 6 of 9 context providers lack tests |
| Q-47 | LOW | `src/services/brc100/` | 8+ BRC-100 sub-modules lack tests |
| Q-48 | LOW | `LocksContext.tsx:94` | Unused `_providedUtxos` parameter |
| Q-49 | MED | `SyncContext.tsx:130` | `ordinalContentCache` as `useState<Map>` triggers re-renders |
| Q-50 | LOW | `ModalContext.tsx:79-140` | Trivial `useCallback` wrappers around single `setState` |
| Q-51 | LOW | `migrations/010,011` | Legacy DML migrations lack clarifying comments |
| Q-52 | MED | `brc100/locks.ts:97-106` | Manual greedy coin selection instead of domain `selectCoins()` |

### Verification of Prior Fixes

All 37 fixes from Review #16 (commit `906c81f`) verified against current code:
- S-29 (accountId scoping) ✅ — `getActiveAccount()` calls at handlers.ts:173-174, 258-260
- S-30 (lockBSV/unlockBSV approval) ✅ — Explicit case blocks at validation.ts:125-137
- S-31 (param validation) ✅ — Runtime checks at handlers.ts:153-166
- B-23 (atomic account creation) ✅ — `withTransaction()` wrapper confirmed
- B-27 (isCancelled check) ✅ — Guard at useSyncData.ts:183
- A-19 (locks.ts barrel) ✅ — 30-line clean re-export
- A-25 (txDetailCache) ✅ — Getter/setter accessors at historySync.ts:32
- All others ✅ — Spot-checked, no regressions

**Prioritized Remediation — Review #17**

### Immediate (before next release)
1. **S-43** `brc100/types.ts:145` — Add runtime type validation to `getParams<T>()` using Zod schemas or manual checks. **Effort: medium**
2. **S-47** `key_store.rs:398` — Refactor `get_wif_for_operation` to sign in Rust, never return WIF to JS. **Effort: major**
3. **B-42** `tokens/transfers.ts` — Add `recordSentTransaction` + `markUtxosPendingSpend` to token transfer flow. **Effort: medium**
4. **B-43** `tokens/transfers.ts` — Support multi-address UTXO combination for token sends. **Effort: medium**

### High priority (next sprint)
5. **S-51** `brc100/locks.ts:92` — Resolve CLTV identity vs wallet key mismatch. **Effort: medium**
6. **S-48** `key_store.rs` — Add IPC command rate limiting (mirror HTTP rate limiter). **Effort: medium**
7. **S-58** `handlers.ts:72` — Implement per-origin permission scoping. **Effort: major**
8. **B-39** `App.tsx:165-193` — Return cleanup function from payment listener effect. **Effort: quick**
9. **B-53** `utxoRepository.ts:703-759` — Fix `reassignAccountData` to skip account 1 data. **Effort: quick**
10. **S-46** `brc100/utils.ts:21` — Replace `Math.random()` with `crypto.getRandomValues()`. **Effort: quick**
11. **Q-44** All components — Add `React.memo` to tab components and expensive list renders. **Effort: medium**

### Medium priority
12. **S-42** — Validate ciphertext array before ECIES decrypt. **Effort: quick**
13. **S-44** — Sanitize/hash origin in tagged key derivation. **Effort: quick**
14. **S-49** — Fail HMAC verification when signature header missing. **Effort: quick**
15. **S-50** — Add bounds check in `encodeScriptNum`. **Effort: quick**
16. **S-53** — Minimize mnemonic exposure in JS heap. **Effort: medium**
17. **S-57** — Don't return root keys for well-known labels. **Effort: quick**
18. **S-59** — Scope session token to BRC-100 server context. **Effort: medium**
19. **B-41** — Check cancelled flag in background sync loop. **Effort: quick**
20. **B-45** — Short-circuit "Unlock All" on first network error. **Effort: quick**
21. **B-47** — Move cancellation check before param clearing. **Effort: quick**
22. **A-31** — Add missing exports to brc100/index.ts barrel. **Effort: quick**
23. **A-32** — Extract shared `isTauri()` utility. **Effort: quick**
24. **Q-42** — Extract `toWalletUtxo()` mapping helper. **Effort: quick**
25. **Q-43** — Extract shared derived address key resolution. **Effort: medium**
26. **Q-49** — Move ordinalContentCache to `useRef` or dedicated context. **Effort: medium**
27. **Q-52** — Replace manual coin selection with domain `selectCoins()`. **Effort: quick**
28. **Q-24** — Add hook tests (useWalletSend, useBRC100, useWalletLock). **Effort: major**
29. **Q-46** — Add context provider tests. **Effort: major**

### Deferred
30. **S-27** — SDK CSRF nonce for read operations. **Effort: quick**
31. **A-30** — Fix JSX indentation. **Effort: quick**
32. Low-severity items (S-45,52,54-56,60, B-40,44,46,49,50, A-33,34, Q-35-41,47,48,50,51)

---

## Review #18 — 2026-02-25 (Post-Remediation Verification + Deep Review)

34 new findings (0 critical, 5 high, 21 medium, 8 low). Verified v17 remediation: 28 previously-open issues confirmed fixed. All 1749 tests passing, lint/typecheck clean.

### Phase 0: v17 Remediation Verification
28 previously-open issues verified as fixed against commit `562784e`:
- **Security (14):** S-43 ✅, S-47 ✅ (mitigated), S-27 ✅, S-42 ✅, S-44 ✅, S-46 ✅, S-48 ✅, S-49 ✅, S-50 ✅, S-51 ✅, S-53 ✅, S-57 ✅ (accepted), S-58 ✅ (partial), S-59 ✅ (accepted)
- **Bugs (7):** B-39 ✅, B-41 ✅, B-42 ✅, B-43 ✅, B-45 ✅, B-47 ✅, B-53 ✅
- **Architecture (3):** A-30 ✅, A-31 ✅, A-32 ✅
- **Quality (4):** Q-31 ✅, Q-33 ✅ (intentional), Q-49 ✅, Q-52 ✅

### Phase 1 — Security (12 findings: 3 high, 7 medium, 2 low)

| ID | Sev | File | Finding |
|----|-----|------|---------|
| S-61 | HIGH | `brc100/listener.ts:92-102,155-187` | Listener auto-response bypasses handler validation — fast-path has no runtime type checking for getPublicKey, lockBSV, unlockBSV params |
| S-62 | HIGH | `tokens/transfers.ts:103-119` | Token transfer missing `isValidBSVAddress()` — invalid toAddress causes permanent irreversible token loss |
| S-63 | HIGH | `brc100/handlers.ts:90-96,360-365,411-415` | No size limits on byte arrays in encrypt/decrypt/sign — memory exhaustion DoS from approved apps |
| S-64 | MED | `wallet/marketplace.ts:75-83,240-247` | Marketplace skips address validation for payAddress/ordAddress |
| S-65 | MED | `tokens/transfers.ts:170,249` | Token transfer fee uses estimated output count, not actual |
| S-66 | MED | `brc100/handlers.ts:378-382` | Public key regex-validated but not checked on secp256k1 curve |
| S-67 | MED | `brc100/handlers.ts:111` | Unbounded outputs array in createAction — no limit |
| S-68 | MED | `crypto.ts:382-389` | Ciphertext min size not validated — short buffer produces empty slices |
| S-69 | MED | `brc100/handlers.ts:437-442` | Tag parameter unbounded length in getTaggedKeys |
| S-70 | MED | `wallet/marketplace.ts:82,89` | Marketplace price/fee not validated (0, NaN, excessive allowed) |
| S-71 | LOW | `brc100/handlers.ts:168-177` | No satoshis upper bound in lockBSV (no BSV supply cap) |
| S-72 | LOW | `domain/transaction/builder.ts:586-647` | Multi-output send no output count limit |

### Phase 2 — Bugs (10 findings: 2 high, 7 medium, 1 low)

| ID | Sev | File | Finding |
|----|-----|------|---------|
| B-54 | HIGH | `tokens/transfers.ts:169-183` | Fee calculated for max 2 funding inputs but actual loop adds N — fee underestimated when N>2 |
| B-55 | HIGH | `wallet/marketplace.ts:162,240` | `cancelOrdinalListing`/`purchaseOrdinal` throw instead of returning Result — breaks error contract |
| B-56 | MED | `wallet/marketplace.ts:268-287` | Purchase pending-spend rollback silently fails — UTXOs stuck 5 min |
| B-57 | MED | `wallet/transactions.ts:458,468` | Consolidation missing accountId — records to wrong account |
| B-58 | MED | `wallet/marketplace.ts:130-143,207-220,291-304` | Post-broadcast DB errors silently swallowed |
| B-59 | MED | `wallet/lockCreation.ts:61-68` | lockBSV missing accountId validation unlike sendBSV |
| B-60 | MED | `useSyncData.ts:164-167,323-324` | Concurrent syncs race on contentCacheRef — cache corruption |
| B-61 | MED | `useSyncOrchestration.ts:103-108` | Stale sync error persists after account switch |
| B-62 | MED | `OrdinalImage.tsx:51-86` | Effect incomplete dependencies — cachedContent changes not detected |
| B-63 | LOW | `Header.tsx:31-54` | useEffect triggers on every balance change — unnecessary re-fetches |

### Phase 3 — Architecture (2 findings: 0 high, 2 medium, 0 low)

| ID | Sev | File | Finding |
|----|-----|------|---------|
| A-35 | MED | `brc100/handlers.ts:73-489` | Response object mutation pattern — 41+ assignments across switch cases |
| A-36 | MED | `brc100/index.ts:102-106` | Undocumented module split between actions.ts and handlers.ts |

### Phase 4 — Quality (10 findings: 0 high, 6 medium, 4 low + deferred)

| ID | Sev | File | Finding |
|----|-----|------|---------|
| Q-53 | MED | `brc100/handlers.ts:277-287` | Outpoint parsing allows malformed input via split('.') |
| Q-54 | MED | `tokens/transfers.ts:137-141` | BigInt validation incomplete — BigInt('abc') throws SyntaxError |
| Q-55 | MED | `brc100/handlers.ts,validation.ts` | 41+ magic JSON-RPC error codes, no centralized constants |
| Q-56 | MED | `src/utils/tauri.ts` | No tests for new shared utility module |
| Q-57 | MED | `brc100/handlers.ts` | No tests for extracted handler module (400+ lines) |
| Q-58 | MED | `tokens/transfers.ts:119-141` | Redundant dual validation between sendToken and transferToken |

**Prioritized Remediation — Review #18**

### Immediate (before next release)
1. **S-62** `tokens/transfers.ts` — Add `isValidBSVAddress(toAddress)` check at function entry. **Effort: quick**
2. **S-61** `brc100/listener.ts` — Mirror handler validation in listener auto-response path. **Effort: medium**
3. **B-54** `tokens/transfers.ts:169-183` — Fix fee calc to use actual input count, not capped estimate. **Effort: quick**
4. **B-55** `wallet/marketplace.ts` — Convert throw-based functions to return Result pattern. **Effort: medium**
5. **S-63** `brc100/handlers.ts` — Add `MAX_PAYLOAD_SIZE` checks for byte arrays (1MB encrypt, 10KB sign). **Effort: quick**

### High priority (next sprint)
6. **S-64** `marketplace.ts` — Add `isValidBSVAddress()` for payAddress/ordAddress. **Effort: quick**
7. **S-65** `transfers.ts:170,249` — Use actual output count for fee calculation. **Effort: quick**
8. **B-57** `transactions.ts:458,468` — Pass accountId to consolidation record functions. **Effort: quick**
9. **B-59** `lockCreation.ts:61-68` — Add accountId validation guard. **Effort: quick**
10. **Q-54** `transfers.ts:137` — Validate amount string before BigInt conversion. **Effort: quick**
11. **Q-53** `handlers.ts:277` — Use strict regex for outpoint format. **Effort: quick**
12. **Q-57** `brc100/handlers.ts` — Create handlers.test.ts test suite. **Effort: major**

### Medium priority
13. **S-66-70** — Input validation improvements (curve check, array limits, size caps). **Effort: medium**
14. **B-56,58** — Marketplace error handling improvements. **Effort: medium**
15. **B-60,61,62** — Sync race conditions and dependency fixes. **Effort: medium**
16. **A-35,36** — Architecture cleanup in BRC-100 handlers. **Effort: medium**
17. **Q-55,56,58** — Error constants, tests for tauri.ts, validation consolidation. **Effort: medium**
18. **Q-24,46** — Hook and context provider test coverage. **Effort: major**
