# Simply Sats — Full Review v22 (2026-03-02)

**Rating:** 8.5 / 10
**Scope:** Full 4-phase codebase review (Security, Bugs, Architecture, Quality)
**Findings:** 10 new issues (1 high, 5 medium, 4 low) — 9 fixed, 1 noted
**Tests:** 1791 passing (77 test files)
**Lint:** 0 errors, 50 warnings (all pre-existing `no-restricted-imports` warnings)
**TypeScript:** Clean (0 errors)

## Context

Review #21 closed all 356 issues and rated 8.5/10. This review (#22) examines the same codebase at commit `344a26a` to verify stability and catch any remaining issues across all four dimensions.

---

## Phase 1: Security Audit

### S-96 (HIGH) — Origin Subdomain Matching Spoofing
**File:** `src/services/brc100/handlers.ts:240-243`

The BRC-100 lock handler determines the lock basket (`wrootz_locks` vs `locks`) based on origin hostname. The check used `hostname.endsWith('wrootz.com')`, which matches any domain ending in those characters — including `evilwrootz.com` or `fake-wrootz.com`.

The comment on line 239 said "S-45: Exact hostname match" but the implementation was permissive.

**Fix:** Changed to `hostname === 'wrootz.com' || hostname.endsWith('.wrootz.com')`, which correctly matches only the root domain and its subdomains.

### S-97 (MEDIUM) — getTaggedKeys Origin Validation
**File:** `src/services/brc100/handlers.ts:521`

The `getTaggedKeys` handler passes `request.origin` directly to `deriveTaggedKeyFromStore` as the `domain` field in the derivation tag. While tag strings are validated (S-69: max 256 chars), the origin was not similarly constrained. A malicious app could send an excessively long origin string, causing:
- Excessive memory in key derivation
- Oversized audit log entries

**Fix:** Added validation requiring origin to be a string of 256 characters or fewer. Invalid origins return `RPC_INVALID_PARAMS` error.

### S-98 (LOW) — Block Height Integer Bounds Check
**File:** `src/services/brc100/handlers.ts:154`

The unlock block is parsed from lock tags with `parseInt()`. While `Number.isFinite()` and `> 0` checks exist, values exceeding safe integer range (> 2^53-1) could lose precision. Bitcoin block heights are uint32 (max ~4.3 billion).

**Fix:** Added `parsedBlock <= 0xFFFFFFFF` bound check to reject unreasonable block heights.

---

## Phase 2: Bug Detection

### B-85 (MEDIUM) — lockReconciliation accountId Fallback
**File:** `src/services/wallet/lockReconciliation.ts:270`

`reconcileLocks` called `autoLabelLockTransactions(mergedLocks, accountId || 1)`, defaulting to account 1 when `accountId` is undefined. Line 269 used `accountId || undefined` for `persistLocks` — an inconsistency. If reconciliation ran without an account context, labels would be written to account 1, polluting another user's transaction labels.

**Fix:** Replaced `accountId || 1` with a guard clause: skip auto-labeling entirely when `accountId` is missing.

### B-86 (MEDIUM) — NetworkContext Price Backoff Reset
**File:** `src/contexts/NetworkContext.tsx:103`

The price fetch function called `scheduleNext(0)` unconditionally after every fetch attempt, even when the response data failed validation. This meant malformed API responses (e.g., `{ rate: "invalid" }`) would reset the backoff counter instead of increasing it.

**Fix:** Moved `scheduleNext(0)` inside the valid-data branch. Malformed responses now increment the failure counter and back off exponentially.

### B-87 (LOW) — Toast Timeout Cleanup on Dismiss
**File:** `src/contexts/UIContext.tsx:107-121`

When a user manually dismisses a toast, `dismissToast` filtered the toast from state but didn't clear the associated `setTimeout`. The orphaned timeout would later fire, attempting to filter an already-removed toast — a harmless but unnecessary state update.

**Fix:** Changed `toastTimeoutsRef` from `Set<TimeoutId>` to `Map<string, TimeoutId>` (mapping toast ID to timeout ID). `dismissToast` now clears the timeout before removing the toast from state.

### B-88 (LOW — Noted) — Background Sync Silent Failures
**File:** `src/contexts/WalletContext.tsx:398-419`

`syncInactiveAccountsBackground` uses a fire-and-forget `void (async () => {})()` pattern. All sync failures are caught per-account with `walletLogger.warn`, but no user-facing feedback is provided if all accounts fail.

**Assessment:** Acceptable for background work. The active account's sync uses proper error handling. Background sync is best-effort.

---

## Phase 3: Architecture Review

### A-47 (MEDIUM) — Header.tsx Layer Violation + Missing Cleanup
**File:** `src/components/wallet/Header.tsx:8,31-56`

The Header component imports directly from `infrastructure/database` (line 8: `getBalanceFromDB`), bypassing the services/contexts layer. This violates the architecture's dependency direction. Additionally, the async `useEffect` that fetches account balances had no cleanup — if the component unmounted mid-fetch, stale state updates would continue.

**Fix:** Added `isMounted` guard with cleanup function. The layer violation is documented as a lint warning (ESLint `no-restricted-imports` rule already flags it) — a proper fix would expose account balances through a context hook, but that's a larger refactor.

---

## Phase 4: Code Quality

### Q-76 (MEDIUM) — SendModal Fragile String Matching
**File:** `src/components/modals/SendModal.tsx:248`, `src/hooks/useWalletSend.ts:172`

The `executeWithSendGuard` function in SendModal detected "broadcast succeeded but DB write failed" by checking `errorMsg.includes('broadcast succeeded')`. This relied on the exact prose of error messages — fragile and prone to breakage if error wording changes. The second check `errorMsg.includes('BROADCAST_SUCCEEDED_DB_FAILED')` was dead code (the error code is numeric `-32018`, never in the message string).

**Fix:** Moved detection to `useWalletSend.ts` where the `AppError` is still available. Both `handleSend` and `handleSendMulti` now check `sendResult.error.code === ErrorCodes.BROADCAST_SUCCEEDED_DB_FAILED` and convert to `ok({ txid, warning })`. SendModal's success branch already handles `result.ok`, so the string matching was removed entirely.

### Q-77 (LOW) — SendModal useCallback Wrapper
**File:** `src/components/modals/SendModal.tsx:166`

`handleFeeRateChange` was an inline arrow function passed to the `FeeEstimation` component on every render. If FeeEstimation uses `React.memo`, this would defeat memoization.

**Fix:** Wrapped in `useCallback` with empty dependency array.

---

## Verification

After all fixes:
- `npm run typecheck` — 0 errors
- `npm run lint` — 0 errors (50 pre-existing warnings)
- `npm run test:run` — 1791 tests passing (77 files)

---

## Summary

The codebase remains in excellent shape at 8.5/10. This review found 10 issues — predominantly in BRC-100 handler validation and minor state management. The most significant finding (S-96) was a hostname matching issue that could allow an attacker to influence lock basket selection via origin spoofing. All actionable findings have been fixed with surgical changes.

### Issue Breakdown
| Severity | Found | Fixed | Noted |
|----------|-------|-------|-------|
| High | 1 | 1 | 0 |
| Medium | 5 | 5 | 0 |
| Low | 4 | 3 | 1 |
| **Total** | **10** | **9** | **1** |

### Files Modified
1. `src/services/brc100/handlers.ts` — S-96, S-97, S-98
2. `src/services/wallet/lockReconciliation.ts` — B-85
3. `src/contexts/NetworkContext.tsx` — B-86
4. `src/contexts/UIContext.tsx` — B-87
5. `src/components/wallet/Header.tsx` — A-47
6. `src/hooks/useWalletSend.ts` — Q-76
7. `src/components/modals/SendModal.tsx` — Q-76, Q-77
