# Simply Sats — Full Review v12 (Review #15)
**Date:** 2026-02-23
**Focus:** Deep Semantic Dive
**Rating:** 9.7 / 10 (down from 9.8 — 1 high-priority SDK security gap)
**Findings:** 10 new (1 high, 4 medium, 5 low) — none fixed yet (read-only review)
**Cumulative:** 146 total issues tracked, 135 fixed (1 accepted risk, 1 backlog, 10 new open)

---

## Pre-Review Baseline

- **TypeScript:** 0 errors (`npm run typecheck`)
- **ESLint:** 0 errors, 55 warnings (51 `no-restricted-imports` + 3 coverage directory + 1 other)
- **Tests:** 1670/1670 passing
- **Previous rating:** 9.8/10 after 14 reviews, 136 issues (135 fixed)

---

## Review Scope

This review intentionally targeted **deep semantic correctness** rather than surface-level scanning. After 14 prior reviews reaching 9.8/10, most surface-level issues are resolved. This review focused on:

1. **SDK security surface** — the `@simply-sats/sdk` package hadn't been deeply audited for its HMAC verification and CSRF nonce behavior
2. **Subtle race conditions** in account switching and sync orchestration
3. **Data integrity under partial failure** — what happens when some API calls succeed and others fail
4. **Architecture debt accumulation** — which service files have grown past maintainability thresholds
5. **Test coverage gaps** — where the most complex logic lives without any test coverage

The review was read-only — no code changes were made.

---

## Phase 1: Security Audit

### S-25 (HIGH) — SDK response signature verification non-blocking
**File:** `sdk/src/index.ts:207-208`

The SDK computes an HMAC-SHA256 over the response body using the shared secret, then compares it against the `x-response-signature` header. However, on mismatch, the code only calls `console.warn` and proceeds to process the potentially tampered response:

```typescript
if (!valid) {
  console.warn('[SimplySats SDK] Response signature verification failed')
}
// execution continues — response is used anyway
```

**Impact:** A man-in-the-middle on localhost (e.g., a malicious browser extension, compromised local proxy, or rogue process) could modify HTTP responses between the Tauri backend and SDK consumers. The SDK would warn in the console but trust the modified data. For a wallet application, this could mean:
- Fabricated balance responses showing incorrect amounts
- Modified UTXO lists leading to double-spend attempts
- Altered transaction data

**Recommendation:** Make verification blocking. Either throw an error on mismatch (breaking change) or add a `strictVerification` option that defaults to `true`, rejecting responses with invalid signatures.

### S-27 (MEDIUM) — SDK/Server nonce mismatch for read-only operations
**Files:** `sdk/src/index.ts:346-353`, `http_server.rs:565-575`

The SDK's `listOutputs()` and `listLocks()` methods call `this.request()` without including a CSRF nonce in the request body. However, the server routes these through `handle_list_outputs` and `handle_list_locks`, which call `validate_and_parse_request` — a function that requires a valid nonce:

```rust
// http_server.rs: all handlers use this validation
let (request, _nonce_used) = validate_and_parse_request(&state, &body)?;
```

**Impact:** External SDK consumers calling `listOutputs()` or `listLocks()` will receive authentication failures. This is currently masked because the wallet itself uses internal React state/context for these operations rather than going through the SDK. But any external app using the published SDK package will hit this.

**Recommendation:** Exempt read-only operations from nonce validation in the server. These operations don't mutate state, so CSRF protection is unnecessary. Add a `validate_and_parse_request_readonly` variant that skips nonce checking.

### S-28 (LOW) — CSP img-src wildcard allows IP tracking
**File:** `tauri.conf.json:26`

The Content Security Policy includes `img-src 'self' data: blob: https:`. The `https:` wildcard allows loading images from any HTTPS origin. When displaying ordinal preview images, the app fetches from external URLs — this reveals the user's IP address to any server hosting ordinal content.

**Impact:** Privacy concern rather than security vulnerability. An attacker who inscribes a tracking pixel as an ordinal could identify when specific wallet addresses view their ordinals. Low severity because: (a) the user is already making API calls to GorillaPool which reveals their IP, and (b) Tauri apps don't send cookies cross-origin.

**Recommendation:** Restrict to known CDN domains: `img-src 'self' data: blob: https://ordinals.gorillapool.io`.

### S-29 (INFO — not tracked) — WIF leakage surface assessment

Counted all `get_wif_for_operation` call sites: 24+ locations in JS that receive a WIF from Rust. Each WIF lives in the JS heap as a plain string until garbage collected. This is the expected tradeoff of the transitional bridge architecture (keys derive in Rust, but BSV.js signing requires WIF in JS). The long-term fix is moving all signing to Rust — not actionable as a single finding.

---

## Phase 2: Bug Detection

### B-21 (MEDIUM) — Partial ordinal display on API failure
**File:** `useSyncData.ts:369`

The ordinal sync uses a ternary to decide whether to use API results or DB cache:

```typescript
const finalOrdinals = apiOrdinals.length > 0 ? apiOrdinals : dbOrdinals
```

The `apiOrdinals` array is built from multiple API calls (list inscriptions, fetch content, fetch metadata). If the first call succeeds but subsequent calls fail, `apiOrdinals` will be non-empty but incomplete. The ternary will choose the partial API set over the complete DB set, causing some ordinals to temporarily disappear from the UI.

**Impact:** Users may see ordinals vanish during intermittent API failures, then reappear on the next successful sync. Not a data loss issue (DB cache is preserved), but a confusing UX.

**Recommendation:** Track whether ALL ordinal API calls succeeded. Only replace DB cache with API data when the full pipeline completes without error.

### B-22 (LOW) — localStorage quota silently swallowed
**Files:** `useSyncData.ts:92,229,251`

Three `localStorage.setItem()` calls are wrapped in bare `try/catch` blocks with no logging:

```typescript
try { localStorage.setItem('cachedBalance', String(balance)) } catch { /* quota exceeded */ }
```

If the browser's localStorage quota is full, these writes silently fail. On the next cold start, the app reads `null` from localStorage, showing a 0 balance flash until the first API sync completes.

**Impact:** Minor UX degradation. The 0-balance flash is typically <1 second on a good connection. Only affects users with full localStorage (unlikely on a desktop Tauri app).

**Recommendation:** Add `walletLogger.warn('localStorage quota exceeded')` to catch blocks. Consider checking `navigator.storage.estimate()` periodically.

### ESLint suppression audit (no finding)

Verified all 17 `eslint-disable` comments across the codebase:
- 9 `react-refresh/only-export-components` — hook files that export both the hook and utility functions
- 2 `react-hooks/exhaustive-deps` — verified both are safe (stable refs)
- 2 `react-hooks/set-state-in-effect` — verified both are necessary (async effects)
- 2 `@typescript-eslint/no-explicit-any` — dual SDK version workaround (inscribe.ts, marketplace.ts)
- 1 `no-control-regex` — legitimate control character detection
- 1 `@typescript-eslint/no-unused-vars` — underscore convention

All suppressions are justified. None are masking real bugs.

### Account switch race condition (no finding)

Investigated the queued switch fire-and-forget in `useAccountSwitching.ts:282-293`. The `finally` block clears `switchingRef.current = false` and then fire-and-forgets the queued switch. There's a brief window where `switchInProgress` is false but a new switch hasn't started yet.

However, this is mitigated by `switchJustCompleted()` which returns true for 2 seconds after any switch. The `checkSync` effect in App.tsx checks both `isAccountSwitchInProgress()` and `switchJustCompleted()`, covering the gap. Not a finding.

---

## Phase 3: Architecture Review

### A-17 (MEDIUM) — Four monolithic service files exceed 800 LOC
**Files:**
- `src/services/sync.ts` — 1351 lines
- `src/services/tokens.ts` — 1057 lines
- `src/services/brc100/actions.ts` — 957 lines
- `src/services/wallet/locks.ts` — 838 lines

These files have grown through successive feature additions and are now difficult to navigate. Each has natural splitting seams:

| File | Lines | Suggested Split |
|------|-------|-----------------|
| `sync.ts` | 1351 | Orchestration (~400) + Address sync (~300) + UTXO sync (~300) + History sync (~350) |
| `tokens.ts` | 1057 | Token fetching (~400) + Token state management (~300) + Token transfers (~350) |
| `brc100/actions.ts` | 957 | Action handlers (~400) + Message formatting (~300) + Validation (~250) |
| `locks.ts` | 838 | Lock creation (~300) + Lock unlocking (~300) + Lock queries (~238) |

**Impact:** Maintenance burden. New developers need to understand 1000+ line files to make targeted changes. IDE performance also degrades with very large files.

**Recommendation:** Split along the natural seams above. No behavioral changes — just file reorganization with barrel re-exports for backwards compatibility.

### A-18 (LOW) — Error handling pattern fragmentation
**Files:** Across service layer

The codebase uses three different error handling patterns:
1. `Result<T, E>` type with `ok()`/`err()` constructors — ~60% of service methods
2. `{ success: boolean; error?: string }` objects — ~30% (older code)
3. Raw `throw` — ~10% (infrastructure layer)

The planned migration to `Result<T, E>` is about 60% complete. The remaining 40% creates cognitive overhead for developers who must remember which pattern each method uses.

**Impact:** Low — all three patterns work correctly. The inconsistency is a maintenance concern, not a correctness issue.

**Recommendation:** Continue the gradual migration. Prioritize converting methods that are called from multiple contexts, as these benefit most from a consistent return type.

### A-16 update — ESLint warnings assessment

The 55 lint warnings break down as:
- 51 `no-restricted-imports` — components importing from `services/` directly instead of through context hooks. These are functional but violate the layered architecture convention.
- 3 spurious warnings from `coverage/` directory (instrumented files)
- 1 other warning

The 51 import warnings represent real architectural debt but are stable (not growing). Tracked as backlog item.

---

## Phase 4: Code Quality

### Q-24 (MEDIUM) — 13 of 17 hooks have zero test coverage
**Directory:** `src/hooks/`

| Hook | Lines | Complexity | Tests |
|------|-------|------------|-------|
| useAccountSwitching | 381 | HIGH (Rust/password fallback, queued switches, mutex) | None |
| useWalletSend | ~200 | HIGH (fee calculation, guard patterns, multi-send) | None |
| useSyncData | 441 | HIGH (abort controllers, partial failure, caching) | None |
| useSyncOrchestration | ~150 | MEDIUM (interval management, cancellation) | None |
| useBRC100 | ~180 | MEDIUM (request/response handling) | None |
| useBrc100Handler | ~120 | MEDIUM (modal state, approval flow) | None |
| useKeyboardNav | ~80 | LOW | None |
| useFocusTrap | ~60 | LOW | None |
| useModalKeyboard | ~70 | LOW | None |
| useAutoScroll | ~40 | LOW | None |
| useUTXOPagination | ~60 | LOW | None |
| useNotifications | ~50 | LOW | None |
| useRecovery | ~90 | LOW | None |
| useOrdinalCache | 176 | MEDIUM | **13 tests** |
| useAddressValidation | ~40 | LOW | **19 tests** |
| useWalletActions | ~100 | MEDIUM | **19 tests** |
| useWalletLock | ~150 | MEDIUM | **12 tests** |

The three most complex hooks (useAccountSwitching, useWalletSend, useSyncData) collectively represent ~1000 lines of critical logic with zero test coverage. These hooks contain the most subtle race conditions and edge cases in the entire codebase.

**Recommendation:** Prioritize test coverage for useAccountSwitching (Rust vs password fallback paths, queued switch behavior), useWalletSend (guard pattern, fee edge cases), and useSyncData (abort handling, partial failure). Estimated effort: 3-5 hours.

### Q-25 (LOW) — Sequential ordinal DB writes
**File:** `useOrdinalCache.ts:45-59`

```typescript
for (const cached of cacheEntries) {
  await upsertOrdinalCache(cached)
}
```

Each ordinal is upserted individually with a separate `await`. For 620+ ordinals, this means 620+ sequential round-trips to SQLite. A batched INSERT with a single SQL statement would be significantly faster.

**Impact:** Performance — the sequential writes add ~2-3 seconds to ordinal sync on larger wallets. Not blocking (runs in background), but unnecessarily slow.

**Recommendation:** Create a `batchUpsertOrdinalCache(entries: OrdinalCacheEntry[])` function that builds a single INSERT statement with multiple value rows.

### Q-26 (LOW) — ESLint scans coverage directory
**File:** `eslint.config.js`

ESLint's ignore list doesn't include the `coverage/` directory. When coverage reports are generated, ESLint picks up the instrumented source files and reports 3 spurious warnings. These are noise in the lint output.

**Recommendation:** Add `{ ignores: ['coverage/'] }` to the ESLint config. One-line fix.

### Additional quality checks (no findings)

- **`as any` in production code:** Zero instances. All `as any` casts are in test files or the two justified ESLint suppressions for dual SDK versions. Excellent type discipline.
- **`console.log`/`console.error` in production:** All replaced with structured logger calls in previous reviews. Only `console.warn` remains in the SDK (which is a separate package with its own logging convention).
- **Unused exports:** No orphaned exports detected.
- **React hooks rules:** All hooks called at top level. No conditional hook calls found.

---

## Rating Justification

**9.7 / 10** (down 0.1 from 9.8)

The 0.1 decrease reflects two specific gaps:

1. **S-25** is a genuine security concern — the SDK's HMAC verification being non-blocking means response integrity is advisory, not enforced. For a wallet application handling financial data, this should be blocking.

2. **Q-24** — the most complex hooks having zero test coverage is a liability. The codebase has 1670 tests but they don't cover the critical coordination logic.

The rating remains very high because:
- All previous 135 issues are fixed or accepted
- Zero `as any` in production code
- Clean typecheck and lint (modulo the A-16 backlog)
- Strong security model (Rust key store, PBKDF2, CSRF nonces, token rotation)
- Well-structured layered architecture
- Comprehensive error handling with ongoing Result<T,E> migration

---

## Comparison with Review #14

| Metric | Review #14 | Review #15 |
|--------|-----------|-----------|
| Rating | 9.8 | 9.7 |
| New findings | 16 (UI/UX focused) | 10 (deep semantic) |
| Critical/High | 4 (all UI) | 1 (SDK security) |
| Tests passing | 1670 | 1670 |
| TypeScript errors | 0 | 0 |
| Lint warnings | 55 | 55 |
| Cumulative issues | 136 | 146 |
| Fix rate | 135/136 (99.3%) | 135/146 (92.5%) |

The fix rate dropped because this review intentionally surfaced deeper issues rather than fixing them. The 10 new findings are actionable but not urgent (except S-25).
