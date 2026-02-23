# Simply Sats — Full Code Review v9 (Review #12)
**Date:** 2026-02-23
**Rating:** 9.1 / 10
**Focus:** Deep dive on extracted sync hooks (useSyncData, useSyncOrchestration, useOrdinalCache)
**Baseline:** 0 lint errors, 55 warnings, typecheck passes, 1643/1643 tests pass (67 test files)

## Review Methodology

This review focuses on areas not fully covered by Review #11 (v8), specifically the three hooks extracted from SyncContext during A-13 remediation. The v8 review identified the extraction as successful (877 to 208 lines) but was conducted in the same session as the refactoring — this review provides independent verification.

Four review phases executed: Security, Bug Detection, Architecture, Code Quality.

Previous open items (ST-4, ST-6, U-6, U-12, U-13, S-17) verified — all remain in prior status.

---

## Phase 1: Security Audit

### Summary
No new security findings. The codebase maintains strong security fundamentals.

### Verification Checks
- **Zero `as any` / `@ts-ignore`** in production code (grep confirmed)
- **CSP, CORS, CSRF** unchanged since v8 — all verified present and correct
- **Rust key store** unchanged — WIFs in Rust memory, zeroized on drop
- **PBKDF2 600K iterations** enforced, AES-GCM 256-bit encryption intact
- **Parameterized SQL queries** throughout — no string interpolation in WHERE clauses
- **Account ID enforcement** in all critical write paths (B-3 hard throw still present)

### Carry-Forward
- **S-17 (Accepted):** `SENSITIVE_KEYS` still empty in secureStorage — XSS in Tauri requires code execution, accepted risk
- **S-3 (Moot):** Session key rotation race irrelevant while SENSITIVE_KEYS empty

### Positive Notes
- The extracted hooks (`useSyncData`, `useSyncOrchestration`, `useOrdinalCache`) do not introduce any new security surface — they only reorganize existing code
- `syncLogger` is used consistently for error logging in the hooks (with two exceptions noted in Phase 4)
- The `services/ordinalCache.ts` facade correctly restores the architecture layer boundary

---

## Phase 2: Bug Detection

### Summary
No new bugs found. The extracted hooks preserve the correctness properties of the original SyncContext code. The `isCancelled` guard pattern is correctly replicated across all state update paths.

### Carry-Forward Stability Items

**ST-4 (Medium, Open)** — No AbortController for inflight network requests.
- Now in `hooks/useSyncData.ts` (was SyncContext.tsx)
- `fetchData` calls `Promise.allSettled([getOrdinals, getBalance, getUTXOs])` without abort signals
- `CancellationController` exists in `src/services/cancellation.ts` with AbortSignal support, but the signal is not threaded through to the HTTP layer
- Impact: Wasted bandwidth when account switches cancel a sync mid-flight
- Effort: 45 min (thread AbortSignal from cancellation token through API calls)

**ST-6 (Medium, Open)** — performSync DB writes not cancellable.
- Now in `hooks/useSyncOrchestration.ts` (was SyncContext.tsx)
- `isCancelled()` checks at lines 140, 158, 183, 203 protect state updates
- But `syncWallet()` / `restoreFromBlockchain()` (lines 126-133) perform DB writes that continue even after cancellation
- Mitigated: writes are account-scoped so wrong-account corruption cannot occur
- Impact: Wasted I/O, not data corruption
- Effort: 20 min (add isCancelled checks inside syncWallet)

### Verified Correct
- `sendingRef` guard in SendModal is sound — the "redundant" check at line 211 is actually defense-in-depth since `executeSendMulti` is reachable from both the handler (line 175) and the confirmation modal callback
- `accountId ?? 1` fallback pattern (18 occurrences in DB layer) is known technical debt, not a bug — critical callers all pass explicit accountId after B-3 fix
- Ordinal cache merge logic handles empty results, missing heights (sentinel -1), and partial API failures correctly

---

## Phase 3: Architecture Review

### Summary
One new finding: the extracted sync hooks have zero test coverage (868 lines). The extraction itself was well-executed — clean separation of concerns, proper callback interfaces — but the DRY principle was violated during the copy.

### New Finding

**A-15 (Medium)** — 868 lines of extracted sync logic have zero test coverage.

| Hook | Lines | Testability |
|------|-------|-------------|
| `useSyncData.ts` | 465 | Module-level utilities easily testable; callback hooks harder |
| `useSyncOrchestration.ts` | 228 | Similar pattern — extract-and-test utilities first |
| `useOrdinalCache.ts` | 175 | `cacheOrdinalsInBackground` is a standalone exported function, directly testable |

The pure utility functions (`compareTxByHeight`, `mergeOrdinalTxEntries`) are the highest-value test targets since they're used in multiple code paths and contain non-trivial sorting/merging logic.

### Architecture Health
- SyncContext refactoring (A-13) successfully reduced the god-object from 877 to 208 lines
- Layer boundary restored via `services/ordinalCache.ts` facade (A-14)
- Provider hierarchy in AppProviders.tsx correctly ordered with ErrorBoundary wrappers on all providers
- No new layer violations detected in the extracted hooks

---

## Phase 4: Code Quality

### Summary
4 new findings. All are DRY violations or logging inconsistencies introduced during the A-13 SyncContext extraction. None affect correctness — they affect maintainability.

### New Findings

**Q-17 (Medium)** — `compareTxByHeight()` and `mergeOrdinalTxEntries()` duplicated identically.

Both functions appear as module-level helpers in two files:
- `src/hooks/useSyncData.ts` lines 31-67
- `src/hooks/useSyncOrchestration.ts` lines 22-55

The implementations are character-for-character identical. This happened because both hooks were extracted from the same SyncContext file, and each took a copy of the shared utilities.

**Fix:** Extract to `src/utils/syncHelpers.ts` and import in both hooks. 15 minutes.

**Q-18 (Low)** — `executeSend` and `executeSendMulti` in `SendModal.tsx:179-245` share ~95% identical try/catch/finally skeleton.

Both functions:
1. Set `sendingRef.current = true`, dismiss confirmation, set sending state
2. Call a handler (`handleSend` or `handleSendMulti`)
3. Check `isOk(result)` — show toast + close + sync on success
4. Check `errorMsg.includes('broadcast succeeded')` — same success path
5. Otherwise `setSendError(errorMsg)`
6. Finally: reset sending state

Could extract a shared `executeWithSendGuard(handler, successToast)` helper. The benefit is marginal for a two-occurrence pattern in a single file.

**Q-19 (Low)** — `console.warn` instead of `syncLogger.warn` in catch blocks.

Two catch blocks use `console.warn` while every other catch in the same files uses `syncLogger.warn`:
- `useSyncData.ts:59`: `console.warn('[SyncContext] mergeOrdinalTxEntries failed:', e)`
- `useSyncOrchestration.ts:47`: `console.warn('[SyncContext] mergeOrdinalTxEntries failed:', e)`

Also uses stale `[SyncContext]` prefix — this code now lives in hooks, not SyncContext. 5-minute fix.

**Q-20 (Low)** — Silent `catch (_err)` on `get_mnemonic_once` at `App.tsx:594`.

```typescript
} catch (_err) {
  showToast('Failed to retrieve recovery phrase', 'error')
}
```

The error is caught but not logged. In a wallet app, mnemonic retrieval failures could indicate key store corruption or Tauri RPC failures — these should be logged for diagnostics. 5-minute fix: add `logger.error('get_mnemonic_once failed', { error: String(_err) })`.

### Positive Findings
- **Zero `as any`** in production code — excellent type discipline
- **1,643 tests passing** across 67 test files — strong coverage baseline
- **React hooks rules** followed perfectly — no hook calls inside conditionals or loops across all 51 components
- **Consistent error handling** with Result<T, E> pattern throughout services layer
- **Well-commented code** — the extracted hooks have clear JSDoc explaining their purpose and extraction context

---

## Rating Breakdown

| Dimension | Score | Notes |
|-----------|-------|-------|
| Security | 9.5/10 | No new issues. Strong crypto, CSRF, key management. One accepted risk. |
| Correctness | 9.0/10 | No new bugs. ST-4/ST-6 remain open but mitigated. |
| Architecture | 9.0/10 | Successful refactor but introduced duplication. 868 lines untested. |
| Code Quality | 9.0/10 | Zero `as any`, 1643 tests. Two DRY violations and logging inconsistencies from refactor. |
| UX | 9.5/10 | All functional issues resolved. 3 cosmetic deferrals. |
| **Overall** | **9.1/10** | Mature, production-grade wallet. Minor quality regressions from refactoring. |

---

## Comparison with Previous Reviews

| Review | Date | Rating | Key Theme |
|--------|------|--------|-----------|
| v5 / #4-8 | 2026-02-17 | 7.5 | Initial security + architecture audit |
| v6 / #9 | 2026-02-18 | 8.0 | WIF storage removal, error handling |
| v7 / #10 | 2026-02-17 | 8.5 | UI polish, SpeedBump, icon standardization |
| v8 / #11 | 2026-02-23 | 9.2 | Multi-send safety, SyncContext extraction, accessibility |
| **v9 / #12** | **2026-02-23** | **9.1** | **Deep dive on extracted hooks — DRY regression + test gap** |

The 0.1 point dip reflects that the A-13 SyncContext extraction, while architecturally successful, introduced two quality regressions: duplicated utilities (Q-17) and untested code (A-15). These are easily remediable — the quick wins (Q-19, Q-17, Q-20) total 25 minutes of effort.
