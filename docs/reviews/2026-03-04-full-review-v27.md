# Simply Sats — Full Review #27 (v27)
**Date:** 2026-03-04
**Rating:** 8.5 / 10
**Tests:** 1891 passing (81 files), 0 failures
**Lint:** 0 errors, 53 warnings (pre-existing, all `no-restricted-imports` and `react-refresh`)
**Typecheck:** Clean

## Scope

Full 4-phase review (Security, Bugs, Architecture, Quality) plus investigation and fix of the ordinals display regression. Covers all changes since v26 review (commit `26ef56f`).

## Changes Since v26

The v26 remediation commit addressed 13 issues. Key architectural improvements:
- **App.tsx decomposition** (782→420 lines): Extracted `useCheckSync`, `usePaymentListener`, `useUnlockHandler`, `useMnemonicAutoClear`
- **ModalContext split**: Domain state split into `OrdinalSelectionContext`, `WalletSetupContext`, `LockWorkflowContext`
- **CSS monolith split**: 7,257-line `App.css` → 7 domain-specific files under `src/styles/`
- **NetworkContext split**: Separate `NetworkInfoContext` (stable) and `SyncStatusContext` (frequent changes)
- **Platform utilities**: New `utils/dialog.ts`, `utils/opener.ts`, `utils/window.ts`, `utils/errorMessage.ts`, `utils/fs.ts`

## Fixes Applied During This Review

### B-107 (CRITICAL — Fixed): Ordinals not showing on startup/account switch

**Root cause:** `fetchDataFromDB` in `useSyncData.ts` tried loading ordinals from the `ordinal_cache` table. When empty (common for first startup, restored wallets, new accounts), ordinals were NOT set in Phase 1. The fallback to the UTXOs table was a fire-and-forget async (Phase 2) that could be cancelled by subsequent state changes. Ordinals only appeared after slow GorillaPool API calls completed in background `fetchData`.

**Fix:**
1. Moved ordinals DB fallback from fire-and-forget Phase 2 into synchronous Phase 1 in `fetchDataFromDB` — ordinals from UTXOs table display instantly
2. Always set ordinals (even to `[]`) when cache is empty — prevents stale ordinals from previous account persisting
3. Removed `ordinalsRef.current.length === 0` guard in `fetchData` that prevented DB ordinals from being shown after account switches

**Files:** `src/hooks/useSyncData.ts`, `src/hooks/useSyncData.test.ts`

### B-108 (CRITICAL — Fixed): Set<string> serializes as {} over IPC

**Root cause:** The v26 Q-90 refactor changed `KNOWN_SENDER_PUBKEYS` from `string[]` to `Set<string>`, but the `getDerivedAddressesFromKeys` and `getDerivedAddressesFromStore` functions still used it as the default parameter with type `string[]`. At runtime, `Set.length` is `undefined` (not 0), so the early return guard was skipped. `JSON.stringify(set)` produces `{}`, so Rust received no sender public keys. BRC-42 derived address scanning silently failed.

**Fix:** Changed defaults from `= KNOWN_SENDER_PUBKEYS` to `= [...KNOWN_SENDER_PUBKEYS]` to spread the Set into an array.

**File:** `src/services/keyDerivation.ts`

---

## Phase 1: Security Audit

### New Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| S-121 | HIGH | `usePaymentListener.ts:61-62` | Identity WIF pulled into JS heap for payment listener lifetime. `getWifForOperation('identity', ...)` returns WIF that persists in closure until wallet locks. Should use `_from_store` Tauri command instead. |
| S-122 | MEDIUM | `SettingsSecurity.tsx:81,122,185` | `get_mnemonic_once` called from 3 different functions. First call clears mnemonic from Rust store. Second call returns None — user sees "Mnemonic not available" error. Mnemonic lost for rest of session. |
| S-123 | MEDIUM | `key_store.rs:21-26` | `KeyStoreInner` WIF fields are `Option<String>`, not `Option<Zeroizing<String>>`. `get_wif()` returns plain `String` clone. Extends S-111 scope. |
| S-124 | MEDIUM | `brc100/listener.ts:206-232` | No queue depth limit on pending BRC-100 requests. Malicious app could flood with approval requests causing memory exhaustion. HTTP rate limit allows 60/min to accumulate. |

### Existing Issues Status

All 7 existing open security issues (S-111, S-113, S-114, S-117, S-118, S-119, S-120) confirmed still present. No regressions.

---

## Phase 2: Bug Detection

### New Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| B-109 | HIGH | `usePaymentListener.ts:56` | `fetchDataRef.current()` returns Promise but not awaited and no `.catch()`. Unhandled rejection if fetchData throws (network error, account switch, DB locked). |
| B-110 | MEDIUM | `OrdinalsTab.tsx:328` | Inline arrow function as `rowComponent` causes react-window to treat it as NEW component type on every render. All visible rows unmount/remount, causing thumbnail flicker with 50+ ordinals. ActivityTab correctly avoids this pattern. |
| B-111 | MEDIUM | `ModalContext.tsx:91-94` | `closeModal` clears `selectedOrdinal` (B-104 fix) but not `ordinalToTransfer`/`ordinalToList`. Stale reference survives if modal closed via X button instead of complete/cancel. |
| B-112 | MEDIUM | `SearchTab.tsx:155-158` | `if (amount && amount > 0)` evaluates false when `amount === 0`. Zero-amount txs (self-send, ordinal transfer) show as "Transaction" instead of proper classification. ActivityTab correctly uses `!= null`. |
| B-113 | LOW | `useSyncData.ts:536` | `ordinalsRef` in `fetchData` dependency array but unused in function body after B-107 fix. Dead dependency. |
| B-114 | LOW | `ActivityTab.tsx:95` | `formatTxDate` called twice per row — once for truthiness check, once for render. Doubles date calculation work. |

### Existing Issues Status

B-98, B-99, B-101, B-102, B-103, B-106 all confirmed still present.

---

## Phase 3: Architecture Review

### New Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| A-63 | MEDIUM | `useCheckSync.ts` | 12 `useRef` + `useEffect` pairs to mirror callback refs. Moved complexity from App.tsx rather than solving it. Should extract `useLatestRef` utility. |
| A-64 | MEDIUM | `ModalContext.tsx` | `useModal()` backward-compat hook merges 4 contexts into 22-field object. Any change to any sub-context re-renders all `useModal()` consumers. Defeats purpose of context split. |
| A-65 | LOW | `useCheckSync.ts:337` | Dynamic `await import('../services/accounts')` inside fire-and-forget. Should be static import (it's an internal module). |
| A-66 | LOW | `App.tsx:268` | Dead backup reminder code references `@tauri-apps/api/core` directly instead of `tauriInvoke`. Should be deleted or updated. |

### Positive Changes

- App.tsx reduced 46% (782→420 lines)
- ModalContext split into 4 single-purpose contexts, all under 90 lines
- CSS monolith resolved (26-line App.css imports 7 domain files)
- NetworkContext split reduces re-render blast radius
- Platform abstraction utilities properly wrap Tauri APIs
- No circular dependencies detected

---

## Phase 4: Code Quality

### New Findings

| ID | Severity | File | Issue |
|----|----------|------|-------|
| Q-97 | MEDIUM | `SearchTab.tsx:216-218` | Search input has `role="combobox"` but missing `aria-controls`, suggestions have no `role="listbox"`/`role="option"`. Screen readers can't announce autocomplete. |
| Q-98 | MEDIUM | `brc100/listener.ts:252` | `setupHttpServerListener` catch block returns no-op cleanup without logging. Silent BRC-100 listener failure — app appears functional but no requests received. |
| Q-99 | MEDIUM | 12 new files with 0% coverage | `useCheckSync.ts` (377 lines), `usePaymentListener.ts`, `useUnlockHandler.ts`, `useMnemonicAutoClear.ts`, 3 new contexts, 5 utility wrappers. Most critical gap: `useCheckSync`. |
| Q-100 | LOW | `utils/opener.ts:19` | No URL scheme validation before opening external URLs. Should restrict to `https://` only. |
| Q-101 | LOW | `QRScannerModal.tsx:227-290` | Inline styles with hardcoded fontSize/color bypass CSS custom properties. Won't respond to user preferences. |
| Q-102 | LOW | `LocksTab.tsx:23` | Uses `||` instead of `??` for blockHeight default. Inconsistent with ActivityTab which uses `??`. |
| Q-103 | LOW | `SearchTab.tsx:258-289` | Duplicates ActivityTab's transaction item rendering. Should reuse or extract shared component. |

---

## Summary

### Overall Health: 8.5 / 10

The v26 refactoring was a significant improvement. The architecture is cleaner, contexts are more focused, and the CSS is properly modularized. Two critical bugs were found and fixed during this review (B-107 ordinals display, B-108 Set/IPC serialization).

### Issue Counts

| Category | New | Fixed (v27) | Still Open |
|----------|-----|-------------|------------|
| Security | 4 (1H, 3M) | 0 | 11 |
| Bugs | 6 (1H, 3M, 2L) | 2 (B-107, B-108) | 12 |
| Architecture | 4 (2M, 2L) | 0 | 14 |
| Quality | 7 (3M, 4L) | 0 | 19 |
| **Total** | **21** | **2** | **56** |

### Prioritized Remediation

#### Immediate (before next release)
1. **B-109** `usePaymentListener.ts:56` — Add `.catch()` to `fetchDataRef.current()`. **Effort: quick**
2. **S-122** `SettingsSecurity.tsx` — Fix `get_mnemonic_once` multi-call behavior. **Effort: medium**

#### Next Sprint
3. **S-121** `usePaymentListener.ts:61` — Migrate payment listener to `_from_store` pattern. **Effort: medium**
4. **S-124** `listener.ts:206` — Add MAX_PENDING_REQUESTS queue depth limit. **Effort: quick**
5. **B-110** `OrdinalsTab.tsx:328` — Extract rowComponent to module-level function. **Effort: quick**
6. **Q-99** New hooks/contexts — Add tests for `useCheckSync` and `useUnlockHandler`. **Effort: major**

#### Sprint After
7. **A-63** `useCheckSync.ts` — Extract `useLatestRef` utility to replace 12 ref/effect pairs. **Effort: medium**
8. **A-64** `ModalContext.tsx` — Deprecate `useModal()`, migrate consumers to granular hooks. **Effort: medium**
9. **Q-97** `SearchTab.tsx` — Add ARIA attributes for autocomplete combobox. **Effort: quick**
10. **Q-98** `listener.ts:252` — Log error in setupHttpServerListener catch. **Effort: quick**
