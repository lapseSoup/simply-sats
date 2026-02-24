# Simply Sats — Full Review Report v16

**Date:** 2026-02-23
**Review:** #16 — Architectural Refactoring Review
**Rating:** 8.2 / 10 (down from 9.7)
**Baseline:** 0 lint errors, 0 type errors, 1748/1748 tests passing

---

## Executive Summary

This review covers the largest single set of uncommitted changes in the project's history: a complete architectural refactoring that splits 4 monolithic services into 14+ focused modules, extracts heavy logic from contexts into hooks, rewrites the multi-account system with per-account encryption, and adds significant new test coverage.

**The refactoring direction is excellent.** The codebase is moving toward better separation of concerns, testability, and maintainability. However, the execution has gaps that need addressing before merge:

- **1 critical bug** (account creation not atomic)
- **2 high-severity security issues** (BRC-100 handlers not account-scoped, auto-approve for financial operations)
- **2 high-severity architecture issues** (locks.ts not cleaned up — 870 LOC duplication, `createWrootzOpReturn` in 3 files)
- **8 medium-severity bugs** in modals, accounts, and sync modules
- **6 medium-severity security gaps** in BRC-100 input validation and lock management

The rating drops from 9.7 to 8.2 because while 6 prior issues were confirmed fixed, 55 new findings were introduced by the refactoring. Most are addressable with quick fixes; the critical and high items should be resolved before merge.

---

## Phase 0: Status Check (6 of 11 prior issues fixed)

| ID | Previous Status | Current Status | Details |
|----|----------------|----------------|---------|
| S-25 | Open-High | **Fixed (v16)** | `strictVerification` defaults to `true` (line 135), throws `SimplySatsError` on HMAC mismatch |
| B-21 | Open-Medium | **Fixed (v16)** | `allOrdinalApiCallsSucceeded` flag at line 371 guards DB replacement |
| A-17 | Open-Medium | **Fixed (v16)** | All 4 monoliths split into focused modules |
| S-28 | Open-Low | **Fixed (v16)** | CSP restricted to `https://ordinals.gorillapool.io` |
| Q-25 | Open-Low | **Fixed (v16)** | `batchUpsertOrdinalCache(cacheEntries)` replaces sequential writes |
| Q-26 | Open-Low | **Fixed (v16)** | `coverage` added to `globalIgnores` |
| Q-24 | Open-Medium | **Partial** | Was 13/17 untested, now 11/16 untested (new tests for useAccountSwitching, useSyncData, useOrdinalCache) |
| B-22 | Open-Low | **Mitigated** | Now logs `syncLogger.warn` instead of silent catch |
| S-27 | Open-Medium | **Still open** | listOutputs still missing nonce |
| A-16 | Backlog | **Still open** | 52 warnings (was 51) |
| A-18 | Open-Low | **Still open** | Error pattern fragmentation continues |

---

## Phase 1: Security Audit (13 new findings)

### HIGH: S-29 — BRC-100 handlers missing accountId

**File:** `brc100/handlers.ts:191-199, 164, 287-288`

The BRC-100 lock/unlock handlers don't pass `accountId` to the underlying wallet functions. This means:
- `getSpendableUTXOs()` returns UTXOs from ALL accounts
- `walletLockBSV()` creates locks without account scoping
- `walletUnlockBSV()` unlocks without verifying account ownership

**Impact:** A BRC-100 request from a connected app could spend UTXOs belonging to a different account than intended. In a multi-account wallet, this is a cross-account fund leak.

**Fix:** Pass active account ID from session state to all three functions.

### HIGH: S-30 — Auto-approve bypasses user confirmation for lock/unlock

**File:** `brc100/validation.ts:136-156`

`lockBSV`, `unlockBSV`, `encrypt`, and `decrypt` request types fall through to the `default` case. When `autoApprove` is true (trusted origin), they execute without user confirmation. Unlike `createAction` (which always requires approval at line 126), these fund-moving operations silently lock/unlock BSV.

**Impact:** A trusted-origin app can silently lock or unlock user funds.

**Fix:** Move lock/unlock operations into explicit always-approval-required case blocks.

### MEDIUM: S-31 through S-36

- **S-31** — BRC-100 `satoshis`/`blocks` params use `as number` without runtime validation
- **S-32** — `changePassword` bypasses `validatePassword()` complexity checks
- **S-33** — BRC-100 lock saves to DB before broadcast, creating phantom records on failure
- **S-34** — `createLockTransaction` (BRC-100 path) has no input validation
- **S-35** — SDK HMAC verification re-serializes JSON instead of using raw bytes
- **S-36** — Lock marked as unlocked even when spending txid doesn't match expected

### LOW: S-37 through S-41

Settings `parseInt` without NaN guard, trustedOrigins without type validation, plaintext localStorage in dev mode, getAllAccounts exposes encryptedKeys, no dust limit for locks.

---

## Phase 2: Bug Detection (16 new findings)

### CRITICAL: B-23 — Account creation not atomic

**File:** `accounts.ts:116-124`

`createAccount` performs two sequential operations without `withTransaction()`:
1. Line 117: `UPDATE accounts SET is_active = 0 WHERE is_active = 1`
2. Line 120: `INSERT INTO accounts ...`

If the INSERT fails (constraint violation, disk full), all accounts are deactivated. No active account exists. The app cannot recover without manual DB intervention.

**Fix:** Wrap both operations in `withTransaction()`.

### HIGH: B-24 through B-27

- **B-24** — `activeAccountId!` non-null assertion in `useWalletSend.ts:285` — can be null during initialization
- **B-25/B-26** — `marketplace.ts:193,280` — `toOrdUtxo` called without script or key for listing UTXOs
- **B-27** — `useSyncData.ts:183-184` — Missing `isCancelled` check before final state setters

### MEDIUM: B-28 through B-35

- **B-28** — Full backup restore doesn't store keys in Rust key store
- **B-29** — Encrypted backup decrypt failure silently falls through
- **B-30** — Settings password change doesn't update React state
- **B-31** — deleteAccount switches account outside transaction
- **B-32** — encryptAllAccounts unhandled exception instead of Result error
- **B-33** — syncAddress returns `totalBalance: 0` on API failure
- **B-34** — Phantom lock cleanup cross-account deletion
- **B-35** — React state mutation via in-place array push

### LOW: B-36 through B-38

Account naming duplicates, single-WIF token transfers, ordinal origin parseInt NaN.

---

## Phase 3: Architecture Review (11 new findings)

### HIGH: A-19 — locks.ts not cleaned up after split (870 LOC duplication)

**File:** `wallet/locks.ts` (839 LOC)

This is the most critical architecture finding. The original `locks.ts` file was NOT reduced after splitting into `lockCreation.ts`, `lockQueries.ts`, and `lockUnlocking.ts`. Every function exists in two places. The barrel exports still import from `locks.ts`, making the three split files **dead code**.

**Risk:** Bug fixes applied to one copy will not reach the other. Inevitable divergence.

**Fix:** Convert `locks.ts` to a barrel re-export file (like `brc100/actions.ts`). Update all consumers to import from the split files.

### HIGH: A-20 — createWrootzOpReturn duplicated across 3 files

Three copies of the Wrootz OP_RETURN builder in `wallet/locks.ts`, `wallet/lockCreation.ts`, and `brc100/script.ts`.

### MEDIUM: A-21 through A-25

- Submodules import types from own barrel (circular risk)
- Dynamic imports inconsistent with static patterns
- Two different `calculateTxAmount` implementations
- BRC-100 actions barrel missing key exports
- Module-level mutable state exported directly

### LOW: A-26 through A-29

Wide hook interface (9 params), bidirectional token module dependency, inconsistent error handling across modules, 210-line `syncTransactionHistory`.

---

## Phase 4: Code Quality (15 new findings)

### HIGH: Q-27 — Duplicated unlock transaction builder

Within `lockUnlocking.ts` itself, `unlockBSV` (lines 81-174) and `generateUnlockTxHex` (lines 274-359) share ~80 lines of identical code: script validation, fee calculation, BIP-143 preimage construction, and transaction assembly.

**Risk:** A fix to the unlock template in one function won't reach the other. Given this is Bitcoin transaction construction code, divergence could produce invalid transactions that lose funds.

### MEDIUM: Q-28 through Q-34

- Account row mapping duplicated 4x
- Promise approval queue duplicated 3x
- `type AnyPrivateKey = any` at SDK boundary
- Minimal purchaseOrdinal test coverage
- No race condition tests for concurrent sync
- Sequential tx history sync (performance)
- Silent catch-and-return-null in accounts (3 functions)

### LOW: Q-35 through Q-41

Hex-to-base64 duplication, conditional accountId pattern, type assertion workarounds, broad try/catch, generic error messages to BRC-100 callers.

### Positive Findings

- **Logger consistency is excellent** — no `console.log` violations in changed files
- **Error messages in wallet services are descriptive** without leaking secrets
- **Test coverage improved** — new test files for 3 previously untested hooks
- **Cancellation patterns are well-implemented** — AbortController threaded properly

---

## Overall Assessment

### Strengths of the Refactoring
1. Monolith splitting direction is correct — sync, tokens, BRC-100, locks all have cleaner boundaries
2. Hook extraction from contexts is well-structured — contexts manage state, hooks manage logic
3. Database-first approach for account switching provides instant UI
4. Batch upsert for ordinals significantly improves performance
5. Test coverage expanding in the right areas

### Critical Gaps
1. **locks.ts duplication** — The split was started but not completed. This is a ticking time bomb.
2. **BRC-100 not account-scoped** — Multi-account support was added to wallet services but not to the BRC-100 integration layer
3. **Account atomicity** — Several multi-step DB operations lack transaction wrappers
4. **Marketplace UTXO handling** — Listing UTXOs need script population before conversion

### Rating Breakdown
| Area | Score | Notes |
|------|-------|-------|
| Security | 7.5/10 | BRC-100 account scoping gaps, auto-approve bypass |
| Bugs | 7/10 | Critical account atomicity, several medium state management issues |
| Architecture | 7.5/10 | Good direction, incomplete execution (locks.ts duplication) |
| Quality | 8.5/10 | Strong logging, good error messages, expanding tests |
| UX/UI | 10/10 | All 40 UI issues from prior reviews remain fixed |
| Stability | 10/10 | All 13 stability issues from prior reviews remain fixed |
| **Overall** | **8.2/10** | |

### Recommended Merge Strategy

**Do not merge as-is.** Fix the 7 "Immediate" items from the remediation plan first (B-23, S-29, S-30, A-19, B-27, B-24, B-25/B-26). These are all quick-to-medium effort fixes that address the critical and high-severity items. The remaining medium/low items can be addressed in follow-up PRs.
