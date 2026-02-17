# Simply Sats — Comprehensive Code Review

**Baseline:** Lint clean (0 errors), TypeScript clean, 1560/1560 tests passing (64 files)

---

## Phase 1: Security Audit — Rating: 9/10

**No critical vulnerabilities found.** Security posture is excellent for a desktop wallet.

### Strengths
- **Crypto**: AES-256-GCM, PBKDF2 600k iterations, 12-byte IV, 16-byte salt, Web Crypto API
- **Key isolation**: Private keys stay in Rust memory via Tauri commands; JS fallback only in dev mode
- **Rate limiting**: 5 max attempts, exponential backoff (1s-5min), state in Rust (not clearable via browser)
- **CSRF**: HMAC-SHA256 nonces, 5-min expiry, single-use, max 1000 tracked
- **SQL injection**: All queries use parameterized `$1, $2` placeholders — zero injection vectors found
- **Transaction atomicity**: UTXOs marked pending BEFORE broadcast, rolled back on failure
- **HTTP server**: DNS rebinding protection, constant-time token comparison, host header validation
- **Auto-lock**: 10-min default (max 60), 15s check interval, proper event tracking

### Minor Observations (LOW priority)
| # | Issue | File | Severity |
|---|-------|------|----------|
| S1 | Rate limit HMAC key hardcoded in Rust binary (extractable) | `src-tauri/src/rate_limiter.rs:27` | Low |
| S2 | Mnemonic briefly in JS memory during `deriveWalletKeys()` fallback | `src/domain/wallet/keyDerivation.ts:121` | Low (dev-only path) |
| S3 | Session key rotation: no concurrency guard during rotation | `src/services/secureStorage.ts` | Low |

---

## Phase 2: Bug Detection — Rating: 7.5/10

### Critical/High Bugs

| # | Issue | File:Line | Severity | Fix Effort |
|---|-------|-----------|----------|------------|
| B1 | **Unhandled promise rejection** in payment listener setup | `src/App.tsx:127-135` | High | Quick — add `.catch()` |
| B2 | **SyncContext: state set after cancellation** — `setTxHistory`, `setOrdinals` called between `isCancelled()` checks during long-running ordinal content fetch | `src/contexts/SyncContext.tsx:305-428` | Medium | Quick — add `isCancelled()` guard before setters at lines ~390, ~404 |
| B3 | **WalletContext: fetchVersionRef race condition** — concurrent `fetchData()` calls can both check against a stale version after account switch, discarding valid results | `src/contexts/WalletContext.tsx:51,239-279` | Medium | Medium — increment version atomically at call start |
| B4 | **LocksContext: state inconsistency window** in `handleUnlock` — lock removed from state before `onComplete()` succeeds, brief period where UI and chain state disagree | `src/contexts/LocksContext.tsx:153-156` | Low | Quick — move `setLocks` filter after `onComplete()` |

### Medium Bugs

| # | Issue | File:Line | Severity |
|---|-------|-----------|----------|
| B5 | `toggleTheme` callback recreated on every theme change — causes unnecessary re-renders of all UIContext consumers | `src/contexts/UIContext.tsx:74` | Low-Med |
| B6 | `knownUnlockedLocks` in `detectLocks` dependency array causes re-render cascade on lock operations | `src/contexts/LocksContext.tsx:88-95` | Low-Med |
| B7 | Toast timeout Set can accumulate stale entries when >5 toasts queued rapidly | `src/contexts/UIContext.tsx:104-111` | Low |

---

## Phase 3: Architecture Review — Rating: 8/10

### Strengths
- **Clean layered architecture**: Domain (pure) -> Services (orchestration) -> Infrastructure (I/O) -> Contexts (state) -> Components (UI)
- **No circular dependencies** across major modules
- **Context values properly memoized** with `useMemo()` in all 9 providers
- **Error hierarchy** is well-designed: `AppError` base with domain-specific subclasses + `Result<T,E>` pattern
- **Broadcast resilience**: Multi-endpoint cascade (WoC -> ARC JSON -> ARC text -> mAPI)
- **Database transactions**: Serialized queue with SAVEPOINT for nested calls

### Issues

| # | Issue | Location | Priority |
|---|-------|----------|----------|
| A1 | **Logger cross-cutting concern**: `infrastructure/api/httpClient.ts` imports from `services/logger` (acknowledged in comment but breaks layering) | `src/infrastructure/api/httpClient.ts` | Low |
| A2 | **Inconsistent error pattern adoption**: Many services still use ad-hoc `{ success, error }` instead of `Result<T,E>` | Various in `src/services/` | Medium |
| A3 | **ConnectedAppsProvider** positioned high in hierarchy with no deps on outer providers — could be moved lower | `src/AppProviders.tsx` | Low |
| A4 | **No offline queue**: All broadcast endpoints depend on network connectivity — failed broadcasts are lost | `src/infrastructure/api/broadcastService.ts` | Medium |

---

## Phase 4: Code Quality — Rating: 7/10

### Performance

| # | Issue | Location | Priority |
|---|-------|----------|----------|
| Q1 | **Zero `React.memo` usage** across 51 component files — no protection against unnecessary re-renders from parent state changes | `src/components/**/*.tsx` | Medium |
| Q2 | **Insufficient `useCallback`/`useMemo`** in components — `BalanceDisplay.tsx` recalculates on every render | Various components | Medium |
| Q3 | **Potential N+1 queries**: `getDerivedAddresses()` then loop calling `getUTXOs()` for each | `src/services/sync.ts` | Low-Med |

### TypeScript Quality

| # | Issue | Location | Priority |
|---|-------|----------|----------|
| Q4 | **151 uses of `any` type** across codebase — mostly tests/legacy but some in infrastructure/BRC-100 modules | Codebase-wide | Medium |
| Q5 | **SendModal imports from domain layer directly** bypassing service layer | `src/components/modals/SendModal.tsx` | Low |

### DRY Violations

| # | Issue | Priority |
|---|-------|----------|
| Q6 | Fee calculation logic in 3 places (domain, service, component) | Low |
| Q7 | Balance calculation duplicated across SyncContext and BalanceDisplay | Low |

### Test Coverage Gaps

| # | Issue | Priority |
|---|-------|----------|
| Q8 | No component tests (only 2 test files for shared components: `ConfirmationModal.test.tsx`, `Modal.test.tsx`) | Medium |
| Q9 | No integration tests for end-to-end flows (wallet creation -> send -> receive) | Medium |
| Q10 | Context providers have no tests | Low-Med |

### Accessibility
- Good: `useKeyboardNav`, `useFocusTrap`, `useModalKeyboard`, `ScreenReaderAnnounce`, `SkipLink`
- Missing: No ARIA role/label audit done; 0 component-level a11y tests

---

## Final Summary

### Overall Health Rating: 7.5/10

Strong security foundation, clean architecture, comprehensive service-layer testing. Main gaps are in React rendering performance (no `React.memo`), component-level test coverage, and some state management race conditions.

### Prioritized Remediation Plan

#### Must Fix Before Release (Critical)
1. **B1**: Add `.catch()` to payment listener promise in `App.tsx:127` — prevents unhandled rejection
2. **B2**: Add `isCancelled()` guards in `SyncContext.tsx` before state setters after async operations

#### Should Fix Soon (High)
3. **B3**: Fix fetchVersionRef race condition in `WalletContext.tsx` — increment at call start
4. **Q1**: Add `React.memo` to frequently-rendered components (`BalanceDisplay`, `TransactionList`, modals)
5. **A2**: Continue `Result<T,E>` migration in services (currently ad-hoc `{success, error}` pattern mixed in)

#### Good to Improve (Medium)
6. **Q4**: Audit and replace `any` types in non-test files, especially `broadcastService.ts` and `RequestManager.ts`
7. **Q8/Q9**: Add component tests and at least one integration test for send flow
8. **A4**: Consider offline broadcast queue for resilience
9. **B4**: Move lock state removal after `onComplete()` succeeds in `LocksContext.tsx`

#### Nice to Have (Low)
10. **S1**: Derive rate limit HMAC key from OS keychain instead of hardcoding
11. **B5**: Optimize `toggleTheme` callback to avoid re-renders
12. **A1**: Move logger to shared utilities layer
13. **Q6/Q7**: Consolidate duplicated fee/balance calculation logic

---

## Verification

After implementing fixes, run:
```bash
npm run lint          # 0 errors
npm run typecheck     # clean compile
npm run test:run      # all 1560+ tests passing
npm run tauri:build   # desktop build succeeds
```

For race condition fixes (B2, B3), manually test:
- Rapid account switching during sync
- Lock/unlock operations during background sync
- Payment listener startup/teardown on wallet lock/unlock
