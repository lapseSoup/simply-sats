# Simply Sats — Full Review #30

**Date:** 2026-03-05
**Scope:** 5 commits (`999995b..5810238`), ~122 source files changed
**Baseline:** 0 lint errors, typecheck passes, 1961/1961 tests pass
**Rating:** 7.8 / 10

---

## Executive Summary

28 new issues found: 0 critical, 2 high, 11 medium, 15 low. Significant security improvements this cycle (Zeroizing wrapper migration, store-based payment listener, WIF/address validation), but the mnemonic-in-JS-heap exposure widened with the new `get_mnemonic` command, and the `contentCacheSnapshot` mutable ref regression is the most impactful new bug.

---

## Phase 1: Security Audit (6 findings)

### S-138 — `get_mnemonic` returns mnemonic to JS without clearing (High)
**Files:** `key_store.rs:229-235`, `SettingsSecurity.tsx:39,135`, `SettingsBackup.tsx:45`, `App.tsx:292`

The new `get_mnemonic` Tauri command (replacing `get_mnemonic_once` for multi-function workflows) does not clear the mnemonic from Rust after retrieval. 4 call sites store the returned mnemonic in React state or local JS variables. The `useMnemonicAutoClear` hook clears state after 5 minutes, but V8 GC doesn't deterministically zero freed strings. This expands the S-118 exposure window — the old `get_mnemonic_once` at least cleared Rust-side after one read.

**Fix:** Move export-keys and show-mnemonic flows entirely to Rust commands that never send the mnemonic over IPC. For unavoidable JS display, overwrite state with fixed-length string before clearing to null.

### S-139 — `get_wif()` returns plain String from Zeroizing (Medium)
**File:** `key_store.rs:64-74`

`KeyStoreInner::get_wif()` clones the inner `&str` from `Zeroizing<String>` into a plain `String`. Most callers wrap in `Zeroizing::new()`, but `get_wif_for_operation` (line 646) returns plain `String` to IPC. Additionally, signing commands like `sign_message_from_store` (line 304) call `(*wif).clone()` to pass to signing functions, creating non-zeroized copies.

**Fix:** Have `get_wif()` return `Zeroizing<String>`. Update signing functions to accept `&str` to avoid cloning out of the wrapper.

### S-140 — `exportKeysToFile` constructs plaintext key material in JS heap (Medium)
**File:** `SettingsSecurity.tsx:30-65`

Gathers 3 WIFs + mnemonic into a JS object, JSON.stringify's it, encrypts it. The intermediate plaintext strings (WIFs, mnemonic, JSON) are never overwritten and persist as GC-collectible heap objects.

**Fix:** Create an `export_keys_encrypted_from_store` Rust command that handles encryption entirely in Rust.

### S-141 — `check_address_balance` returns Ok(-1) for API errors (Low)
**File:** `lib.rs:601-612`

Error paths return `Ok(-1)` instead of `Err(...)`, making the `Result` type semantically misleading. Account discovery treats -1 as null, so persistent API failures (rate limiting) could cause `discoverAccounts` to miss legitimate accounts during wallet restore.

### S-142 — No audit logging for `get_mnemonic` command (Low)
**File:** `key_store.rs:229-235`

Unlike `get_wif_for_operation` which logs a `warn!` on every retrieval, `get_mnemonic` has no audit trail. Mnemonic retrieval is more sensitive than WIF retrieval.

### S-143 — Payment listener shared `isListening` race (Low)
**File:** `messageBox.ts:506-541`

`isListening` and `currentListenerCleanup` are shared between WIF-based and store-based listener functions. Also, no in-flight guard prevents concurrent `checkForPayments` calls when interval ticks overlap with initial check.

### Positive Security Changes
1. **Zeroizing wrapper migration** — all `KeyStoreInner` fields now use `Zeroizing<String>`
2. **Store-based payment listener** — closes S-121, identity WIF never enters JS
3. **WIF validation in `store_keys_direct`** — rejects malformed WIFs
4. **BSV address validation** — prevents URL injection in `check_address_balance`
5. **Zero-sat output guard** — prevents unspendable dust in Rust builder
6. **Notification cap** — MAX_NOTIFICATIONS=1000 prevents unbounded growth

---

## Phase 2: Bug Detection (9 findings)

### B-129 — `contentCacheSnapshot` returns mutable ref directly (High)
**File:** `WalletContext.tsx:439`

Changed from `new Map(contentCacheRef.current)` to `contentCacheRef.current` (tagged A-54 optimization). This exposes the internal mutable `Map` reference to all context consumers. Any `.set()`, `.delete()`, or `.clear()` call corrupts the shared cache without triggering re-renders. Multiple sync pipeline locations (`useOrdinalCache.ts:110`, `useSyncData.ts:247,403`) mutate `contentCacheRef.current` directly, making these mutations visible mid-render.

**Fix:** Restore defensive copy or type as `ReadonlyMap<string, OrdinalContentEntry>`.

### B-130 — Dead cancellation in Header.tsx fetchAccountBalances (Medium)
**File:** `Header.tsx:33-53`

`useCallback`-wrapped function declares `let cancelled = false` and returns cleanup `() => { cancelled = true }`, but this is not a `useEffect` — the cleanup is never invoked. The `cancelled` variable is always false, making the guards dead code. Rapid open/close of dropdown races concurrent fetches.

### B-131 — `formatSatoshis` doesn't handle negative amounts (Medium)
**File:** `formatting.ts:11-22`

Uses `sats >= ONE_BSV` threshold, but negative amounts like -200M sats evaluate to `false`, displaying "-200,000,000 sats" instead of "-2.00 BSV". Currently only used for positive values, but the function name doesn't indicate this constraint.

### B-132 — `resumeAutoLock` can resurrect stopped auto-lock (Medium)
**File:** `autoLock.ts:221-232`

Changed to force `state.isEnabled = true` on resume, even after `stopAutoLock()` set it to `false`. A visibility-change handler calling `resumeAutoLock` after `stopAutoLock` would unexpectedly re-enable auto-lock.

### B-133 — `accountIndex` fallback 0 collides with first account (Medium)
**File:** `useAccountSwitching.ts:311-315`

`const accountIndex = keys.accountIndex ?? 0` falls back to BIP-44 derivation index 0 (the first account). If a newly created account returns null for `accountIndex`, keys derived for index 0 would overwrite the first account's keys. Previous fallback of `accounts.length` was safer.

### B-134 — TransactionItemRow BSV display loses negative sign (Low)
**File:** `TransactionItemRow.tsx:102`

BSV mode uses `Math.abs(tx.amount)` for formatting but doesn't prepend '-' for negative values. Sent transactions show "0.50 BSV" instead of "-0.50 BSV".

### B-135 — Ordinal self-heal UPDATE runs on every getCachedOrdinals call (Low)
**File:** `ordinalRepository.ts:78-96`

The self-heal query (un-marking incorrectly-transferred ordinals) runs before every SELECT. This correlated subquery executes on every account switch, app start, and sync cycle. Should be debounced or moved to sync completion.

### B-136 — closeModal clears ordinal state for all modals (Low)
**File:** `ModalContext.tsx:102-107`

`closeModal` calls `clearSelectedOrdinal()`, `completeTransfer()`, `completeList()` for every modal close, including Settings, Send, etc. Causes unnecessary state updates and re-renders for `OrdinalSelectionContext` consumers.

### B-137 — setIsLocked(true) fires before clear_keys completes (Low)
**File:** `useWalletLock.ts:95-120`

`setIsLocked(true)` triggers UI re-render showing locked state before `await tauriInvoke('clear_keys')` finishes. Brief window where UI shows locked but keys still exist in Rust memory.

---

## Phase 3: Architecture Review (5 findings)

### A-77 — Duplicate TxHistoryItem type definition (Medium)
**Files:** `TransactionItemRow.tsx:5`, `SyncContext.tsx:30`

`TxHistoryItem` defined in two locations with structural divergence — SyncContext version includes `address?` field. TypeScript structural typing masks the mismatch today. A component-layer file exports a domain-level type, violating layered architecture.

**Fix:** Move `TxHistoryItem` to `src/domain/types.ts` and import everywhere from there.

### A-78 — messageBox.ts expanded to 622 lines with 8 near-duplicate functions (Medium)
**File:** `messageBox.ts`

Store-based migration (S-121) added 4 full copies of WIF-based functions. The 8 functions do the same 4 operations with only auth mechanism differing. Any bug fix must be applied to both variants.

**Fix:** Factor shared logic into generic internal functions accepting a signing strategy, or remove deprecated WIF variants since `usePaymentListener` now uses store-based exclusively.

### A-79 — useSyncData imports directly from infrastructure/database (Medium)
**File:** `useSyncData.ts:11-14`

Hook imports `getAllTransactions`, `getDerivedAddresses`, `getLocks`, `getOrdinalsFromDatabase` directly from infrastructure — a two-layer violation (hooks should go through services).

### A-80 — Stale log message references get_mnemonic_once (Low)
**File:** `App.tsx:300`

Error log says `'get_mnemonic_once failed'` but code now calls `get_mnemonic` (line 292). Also `platform/tauri.ts:280-283` still has `getMnemonicOnce()`.

### A-81 — exportKeysToFile business logic in component file (Low)
**File:** `SettingsSecurity.tsx:36-60`

Module-level function handles WIF retrieval, encryption, file I/O — belongs in a service module, not a component.

### Known Open Issues Status
- **A-49, A-51, A-56, A-58, A-59**: Unchanged
- **A-55**: Slight improvement — auditLog consolidated to shared getDatabase()
- **A-60**: Slight improvement — 521 lines, better structured with hook extraction
- **A-62, A-68**: Unchanged / slight improvement with new utility extractions

---

## Phase 4: Code Quality (8 findings)

### Q-121 — Duplicated closeModal compound action (Medium)
**Files:** `App.tsx:83-88`, `AppModals.tsx:122-127`

Same compound action (`rawCloseModal` + 3 ordinal cleanup calls) duplicated in both files. Any change must be synchronized.

### Q-122 — safeDeleteTable SQL interpolation without type protection (Medium)
**File:** `backup.ts:244-249`

`DELETE FROM ${tableName}` uses plain string interpolation. Enforced only by convention ("hardcoded table names only"). Use string literal union type for compile-time safety.

### Q-123 — Inconsistent indentation in AppProviders.tsx (Low)
**File:** `AppProviders.tsx:64-84`

New ErrorBoundary wrappers break the consistent nesting pattern used by other providers.

### Q-124 — Cache eviction logic duplicated in historySync.ts (Low)
**File:** `historySync.ts:47-51,119-123`

LRU eviction logic inlined in `calculateTxAmount` instead of using `setTxDetailCacheEntry()`.

### Q-125 — formatTimeRemaining output differs from previous LockModal format (Low)
**File:** `timeFormatting.ts`, `LockModal.tsx`

New utility produces `~30d 0h` instead of previous `~1 month`. Missing month/week granularity.

### Q-126 — Non-null assertions on selectedOrdinal in AppModals (Low)
**File:** `AppModals.tsx:214-215`

`ordinalCtx.selectedOrdinal!` in closures could theoretically execute after state changes during concurrent rendering.

### Q-127 — No tests for formatSatoshis utility (Low)
**File:** `formatting.ts`

New utility with branching logic for auto/short modes has no unit tests. Edge cases (negative, zero, NaN, boundary at 100M sats) untested.

### Q-128 — No tests for formatTimeRemaining utility (Low)
**File:** `timeFormatting.ts`

New utility with branching logic for days/hours/minutes has no tests.

### Q-129 — consumePendingDiscovery accepted but unused in useCheckSync (Low)
**File:** `useCheckSync.ts:67`

Parameter destructured as `_consumePendingDiscovery` (unused) but still required in interface. Should be removed.

---

## Overall Assessment

**Rating: 7.8 / 10**

**Strengths this cycle:**
- Rust key store hardened with `Zeroizing<String>` across all fields
- Store-based payment listener eliminates identity WIF from JS
- WIF validation and BSV address validation add defense-in-depth
- Synchronous ordinal merge eliminates visible count jumps
- `useLatestRef` hook reduces boilerplate significantly
- `TransactionItemRow` extraction improves component modularity

**Key concerns:**
- `get_mnemonic` widens mnemonic exposure to JS (S-138) — the fundamental architecture challenge of key-in-JS-heap remains the primary security limitation
- `contentCacheSnapshot` mutable ref regression (B-129) — most impactful new bug, could cause wrong ordinal display/transfer
- Growing code duplication in messageBox.ts (A-78) — store migration created 8 near-duplicate functions
- Several new utilities lack tests (Q-127, Q-128)

**Recommendation:** Fix B-129 (contentCacheSnapshot) and B-133 (accountIndex fallback) before next release. S-138 is architectural debt requiring a larger migration to Rust-side mnemonic handling.
