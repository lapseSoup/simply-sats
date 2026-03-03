# Simply Sats — Full Review v23

**Date:** 2026-03-03
**Rating:** 8.5 / 10 (was 8.5 in v22)
**Test baseline:** 1803 passing (was 1791 in v22), 0 lint errors, 50 warnings, typecheck clean

---

## Executive Summary

Review #23 covers ~3,600 lines of changes across 64 files since v22, including new components (QRScannerModal, AddressPicker, FeeEstimation), a new restore service extraction, a new addressBookRepository, and significant SendModal refactoring. Found 11 issues: 2 high-severity security (cross-account data leak), 3 medium, and 6 low. All 11 fixed in this review.

The most critical finding was a **cross-account data leak in BRC-100 endpoints** — the `listOutputs`, `listLocks`, and discover functions returned locks and UTXOs from ALL accounts instead of scoping to the active account. This is the same class of bug as S-29 (fixed in v16) but in different code paths added later.

---

## Phase 1: Security Audit

### S-99 (HIGH) — Cross-account lock leak in BRC-100 `listOutputs`
- **File:** `src/services/brc100/outputs.ts:61`
- **Issue:** `getLocksFromDB(currentHeight)` called WITHOUT `accountId`. When an external BRC-100 app calls `listOutputs` with `basket: 'wrootz_locks'`, it received locks from ALL accounts — leaking txids, amounts, and unlock blocks across multi-account boundaries.
- **Fix:** Added `getActiveAccount()` import, passed `activeAccountId` to `getLocksFromDB(currentHeight, activeAccountId)`.

### S-100 (HIGH) — Cross-account lock leak in BRC-100 listener
- **File:** `src/services/brc100/listener.ts:138`
- **Issue:** Same pattern — `getLocksFromDB(currentHeight)` in `listLocks` auto-response handler had no account scoping.
- **Fix:** Added `getActiveAccount()` import, passed `activeAccount?.id` to `getLocksFromDB()`.

### S-101 (MEDIUM) — Cross-account UTXO leak in BRC-100 discover functions
- **File:** `src/services/brc100/outputs.ts:119,170`
- **Issue:** `getUTXOsByBasket()` and `getSpendableUTXOs()` in `discoverByIdentityKey` and `discoverByAttributes` returned UTXOs from all accounts.
- **Fix:** Threaded `activeAccountId` through both discover functions.

### S-102 (MEDIUM) — Missing accountId in `brc100/locks.ts` getLocks export
- **File:** `src/services/brc100/locks.ts:40`
- **Issue:** The `getLocks()` export function called `getLocksFromDB(currentHeight)` without accountId.
- **Fix:** Added `getActiveAccount()`, passed `activeAccount?.id` to `getLocksFromDB()`.

### S-103 (LOW) — `addressExists()` queries all accounts
- **File:** `src/infrastructure/database/addressBookRepository.ts:170-178`
- **Issue:** `SELECT id FROM address_book WHERE address = $1` had no account filter. While not exploitable via BRC-100 (not exposed to external apps), it leaked address existence across accounts.
- **Fix:** Added optional `accountId` parameter. When provided, adds `AND account_id = $2` to WHERE clause.

---

## Phase 2: Bug Detection

### B-89 (MEDIUM) — Silent error swallowing in restore.ts Tauri invoke
- **File:** `src/services/restore.ts:115-117, 140-157`
- **Issue:** Two `catch (_e) { /* non-fatal */ }` blocks on `invoke('store_keys')` and `invoke('store_keys_direct')` had zero logging. If the Rust key store failed during restore, there was no diagnostic trail whatsoever.
- **Fix:** Added `walletLogger.warn()` calls with error details in both catch blocks. Comment clarifies the non-fatal nature (unlock will re-populate).

### B-90 (LOW) — Silent account discovery error in restore.ts
- **File:** `src/services/restore.ts:193`
- **Issue:** `.catch(() => {})` swallowed all discovery errors after restore. If account discovery failed, the user received no feedback about potentially missing accounts.
- **Fix:** Added `walletLogger.warn('Account discovery failed after restore', ...)` in catch block.

---

## Phase 3: Architecture Review

No new architectural concerns found. Positive observations:
- The `restore.ts` extraction (A-41 from v21) follows established service patterns correctly.
- The adapter removal (`walletAdapter.ts`) was clean — no broken imports.
- New database types (`row-types.ts`, `types.ts`) properly separate concerns.
- Context hierarchy is sound after v21 refactoring.

---

## Phase 4: Code Quality

### Q-78 (LOW) — AddressRow missing React.memo
- **File:** `src/components/shared/AddressPicker.tsx:162`
- **Issue:** `AddressRow` was a plain function component rendered in a list without memoization. Every parent state change triggered unnecessary re-renders of all address rows.
- **Fix:** Wrapped with `memo()` from React.

### Q-79 (LOW) — Missing test file for `base58.ts`
- **File:** `src/domain/shared/base58.ts` (new 45-line module)
- **Issue:** No dedicated test file. Tested indirectly through address validation but no edge case coverage.
- **Fix:** Created `src/domain/shared/base58.test.ts` with 10 tests covering: empty string, leading zeros, known address decode, strict/lenient modes, invalid characters, alphabet validation.

### Q-80 (LOW) — Missing boundary tests in FeeEstimation
- **File:** `src/components/shared/FeeEstimation.test.tsx`
- **Issue:** No tests for rate clamping at `MIN_FEE_RATE` (0.001) and `MAX_FEE_RATE` (1.0) boundaries.
- **Fix:** Added 2 boundary tests verifying clamping behavior for sub-minimum and above-maximum values.

### Q-81 — AddressPicker act() warnings (False positive)
- **Issue:** Initially flagged as needing `waitFor()` wrappers, but upon inspection the tests already use `waitFor()` correctly. No changes needed.

---

## Verification Results

- **Typecheck:** Clean (0 errors)
- **Lint:** 0 errors, 50 warnings (unchanged from baseline)
- **Tests:** 1803 passing (78 test files) — 12 new tests added
- **Manual check:** All `getLocksFromDB()` calls now include `accountId` parameter — verified via grep, only old docs reference the un-scoped version
