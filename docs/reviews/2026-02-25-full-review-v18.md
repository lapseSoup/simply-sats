# Simply Sats — Full Review Report v18
**Date:** 2026-02-25
**Reviewer:** Claude Code (Opus 4.6)
**Commit:** `562784e` (Apply Review #17 remediation: 38 fixes)
**Rating:** 7.5 / 10 (up from 7.0)

## Executive Summary

This review verified the v17 remediation (38 fixes applied in commit `562784e`) and performed a fresh four-phase review. The remediation was comprehensive — 28 previously-open issues are now confirmed fixed, including all 4 high-priority items from Review #17. The codebase has improved significantly in security posture, particularly in BRC-100 handler validation.

However, the review uncovered 34 new findings (0 critical, 5 high, 21 medium, 8 low), primarily in areas adjacent to the v17 fixes: the BRC-100 listener (which was NOT updated with the same validation applied to handlers), token transfers (address validation gap), and marketplace operations (error handling contract violations).

**Key improvements since v17:**
- All BRC-100 handler params now have runtime validation
- `Math.random()` replaced with `crypto.getRandomValues()` for request IDs
- CLTV lock key mismatch fixed (identityPubKey → walletPubKey)
- Token transfers now record transactions and mark UTXOs spent
- `isTauri()` centralized to shared utility

**Key new concerns:**
- BRC-100 listener bypasses all handler validation (S-61)
- Token transfers have no address validation (S-62)
- Marketplace functions throw instead of returning Result (B-55)
- Multiple accountId propagation gaps in lock/consolidation operations

## Baseline

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors, 52 warnings (all `no-restricted-imports`) |
| `npm run typecheck` | Clean |
| `npm run test:run` | 1749 tests passing across 71 files |
| Working tree | Clean |

## Phase 0: v17 Remediation Verification

### Security Fixes Verified (14/14)
All security fixes from the v17 remediation are confirmed intact:

| ID | Verification | Notes |
|----|-------------|-------|
| S-43 | ✅ Verified | Runtime validation at handlers.ts:79-83, 90-94, 360-365, 412-415, 438-439 |
| S-47 | ✅ Mitigated | Security notes + warning log at key_store.rs:386-413. WIF still returned but documented as transitional |
| S-27 | ✅ Verified | SDK listOutputs accepts optional nonce at sdk/index.ts:365-374 |
| S-42 | ✅ Verified | Byte array validation at handlers.ts:412-415 |
| S-44 | ✅ Verified | Length-prefixed serialization at keyDerivation.ts:455 |
| S-46 | ✅ Verified | crypto.getRandomValues at brc100/utils.ts:21-26 |
| S-48 | ✅ Verified | Rate limiter module at rate_limiter.rs |
| S-49 | ✅ Verified | HMAC verification at sdk/index.ts:206-232 |
| S-50 | ✅ Verified | Bounds check at brc100/script.ts:13-19 |
| S-51 | ✅ Verified | walletPubKey at brc100/locks.ts:94 |
| S-53 | ✅ Verified | get_mnemonic_once with zeroization at key_store.rs:209-222 |
| S-57 | ✅ Accepted | Documented as intentional for BRC-42 interop |
| S-58 | ✅ Partial | Origin hostname checking at handlers.ts:207-213 |
| S-59 | ✅ Accepted | Documented trade-off with CSP mitigation |

### Bug Fixes Verified (7/7)
| ID | Verification |
|----|-------------|
| B-39 | ✅ Proper cleanup with stopListener at App.tsx:191 |
| B-41 | ✅ cancelled flag checked at App.tsx:325 |
| B-42 | ✅ markUtxosSpent + recordSentTransaction at transfers.ts:263-283 |
| B-43 | ✅ getTokenUtxosForSend fetches both addresses at transfers.ts:310-340 |
| B-45 | ✅ Short-circuit on failure at App.tsx:484-485 |
| B-47 | ✅ Cancellation check before param clearing at App.tsx:363-371 |
| B-53 | ✅ Safety check for account 1 at utxoRepository.ts:710-720 |

### Architecture/Quality Fixes Verified (7/7)
| ID | Verification |
|----|-------------|
| A-30 | ✅ JSX indentation fixed in AppProviders.tsx |
| A-31 | ✅ Comprehensive barrel exports in brc100/index.ts |
| A-32 | ✅ isTauri() centralized to src/utils/tauri.ts |
| Q-31 | ✅ Comprehensive marketplace test coverage |
| Q-33 | ✅ Sequential sync intentional (rate limiting) |
| Q-49 | ✅ Moved to useRef at SyncContext.tsx:133 |
| Q-52 | ✅ Uses domain selectCoins at brc100/locks.ts:102 |

## Phase 1: Security Audit

### High Priority

**S-61: BRC-100 Listener Bypasses Handler Validation**
The v17 remediation added comprehensive runtime validation to `handlers.ts` for all BRC-100 operations. However, the `listener.ts` auto-response path — which handles `getPublicKey`, `lockBSV` preflight, and `unlockBSV` preflight — was NOT updated. The listener uses raw `request.params || {}` without any of the type checking, range validation, or format verification present in handlers.

This creates a validation bypass: an HTTP client can send malformed params that pass through the listener's fast path without ever reaching the handler validation. While the listener only auto-responds to a subset of operations, those operations include balance-affecting lock/unlock actions.

**Fix:** Mirror the handler validation in listener.ts, or refactor to share validation functions between listener and handler.

**S-62: Token Transfer Missing Address Validation**
`transferToken()` in `tokens/transfers.ts` accepts `toAddress` without calling `isValidBSVAddress()`. Compare this to `sendBSV()` in `transactions.ts:72` which validates. A single-character typo in a token recipient address causes permanent, irreversible token loss with no on-chain recovery possible.

**Fix:** Add `isValidBSVAddress(toAddress)` check at the top of `transferToken()`.

**S-63: Unbounded Byte Arrays in BRC-100 Handlers**
While the v17 remediation correctly added format validation (array of 0-255 values) for `plaintext`, `ciphertext`, and `data` parameters, it added no size limits. A malicious-but-approved app can send multi-megabyte byte arrays that cause memory exhaustion in the wallet process. Affects `createSignature` (handlers.ts:90-96), `encrypt` (360-365), and `decrypt` (411-415).

**Fix:** Add `MAX_PAYLOAD_SIZE` checks (e.g., 1MB for encrypt/decrypt, 10KB for signatures).

### Medium Priority
- **S-64:** Marketplace address validation gap (payAddress, ordAddress unvalidated)
- **S-65:** Token transfer fee uses estimated output count, not actual
- **S-66:** Public key format-checked but not curve-validated (invalid ECDH keys accepted)
- **S-67:** Unbounded outputs array in createAction handler
- **S-68:** Ciphertext min size not checked (< 28 bytes = empty slices)
- **S-69:** Tag parameter unbounded length (expensive key derivation with large strings)
- **S-70:** Marketplace price not validated (0, NaN, excessive values allowed)

### Low Priority
- **S-71:** No satoshis upper bound in lockBSV (no BSV supply cap check)
- **S-72:** Multi-output send has no output count limit

## Phase 2: Bug Detection

### High Priority

**B-54: Token Transfer Fee Calculation Mismatch**
Fee calculation at `transfers.ts:171` uses `Math.min(fundingUtxos.length, 2)` to cap the estimated number of funding inputs at 2. However, the actual selection loop at lines 178-183 continues adding inputs until `totalFunding >= estimatedFee + 100`. When more than 2 inputs are needed, the actual transaction is larger than estimated, and the fee is underestimated. This can cause negative change or overpaid fees.

**B-55: Marketplace Error Handling Contract Violation**
`listOrdinal()` returns `Promise<Result<string, string>>`, but `cancelOrdinalListing()` and `purchaseOrdinal()` throw raw exceptions. Callers treating marketplace operations uniformly will crash on unhandled throws from cancel/purchase operations.

### Medium Priority
- **B-56:** Marketplace purchase pending-spend rollback silently fails (UTXOs stuck 5 min)
- **B-57:** Consolidation missing accountId in record functions (wrong account in multi-account)
- **B-58:** Post-broadcast DB errors silently swallowed in all 3 marketplace operations
- **B-59:** lockBSV accepts undefined accountId (unlike sendBSV which validates)
- **B-60:** Concurrent syncs race on contentCacheRef (one overwrites other's cache)
- **B-61:** Stale sync error persists after account switch (cancelled check prevents clearing)
- **B-62:** OrdinalImage effect has incomplete dependencies (stale content on cache changes)

### Low Priority
- **B-63:** Header useEffect triggers on every balance change (unnecessary re-fetches)

## Phase 3: Architecture Review

The v17 remediation improved architecture significantly by centralizing `isTauri()`, fixing barrel exports, and aligning JSX indentation. Two new medium-priority concerns:

- **A-35:** The `executeApprovedRequest` function (handlers.ts:73-489) mutates a single response object across 10+ switch cases with 41+ assignments. This pattern makes it hard to audit which cases set which fields and creates risk of returning both `result` and `error`.
- **A-36:** The module split between `actions.ts` (routing/approval) and `handlers.ts` (execution) is not documented in the barrel exports, making it unclear which module owns which part of the request lifecycle.

## Phase 4: Code Quality

Notable new quality findings:
- **Q-53:** Outpoint parsing via `split('.')` silently drops extra segments (should use regex)
- **Q-54:** `BigInt(amount)` throws unhandled SyntaxError for non-numeric strings
- **Q-55:** 41+ magic JSON-RPC error codes with no centralized constants
- **Q-56-57:** New `tauri.ts` utility and extracted `handlers.ts` both lack test files
- **Q-58:** Redundant dual validation between `sendToken()` and `transferToken()`

## Rating Justification: 7.5 / 10

**Improvements (+0.5):**
- Massive remediation effort (38 fixes) demonstrates strong engineering discipline
- All BRC-100 handler params now have runtime validation
- Critical bugs (token transfer state tracking, CLTV key mismatch) fixed
- Shared utilities (isTauri, generateRequestId) reduce duplication
- 1749 tests passing with zero type errors

**Remaining concerns (-2.5):**
- BRC-100 listener validation bypass (S-61) undermines the v17 security fixes
- Token transfer address validation gap (S-62) risks permanent fund loss
- Marketplace error handling inconsistency (B-55) breaks caller contracts
- Multiple accountId propagation gaps in multi-account operations
- Low test coverage for security-sensitive modules (handlers.ts, tauri.ts)
- 52 lint warnings still not addressed (A-16 backlog)

## Cumulative Statistics

| Metric | Value |
|--------|-------|
| Total issues tracked | 282 |
| Fixed/Verified/Accepted | 177 (63%) |
| Open High | 5 |
| Open Medium | 33 |
| Open Low | 36 |
| Test count | 1749 |
| Lint errors | 0 |
| Type errors | 0 |
