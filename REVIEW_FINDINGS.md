# Simply Sats Code Review — 2026-02-15

**Reviewer:** Claude Opus 4.6
**Codebase:** Simply Sats BSV Wallet
**Stack:** Tauri 2 + React 19 + TypeScript 5.9 + Vite 7 + Rust backend
**Baseline:** 0 type errors, 0 lint errors, 938 tests passing
**Scope:** Full project — security, bugs, architecture, code quality

## Overall Health Rating: 7.5/10

The wallet demonstrates strong security engineering (proper AES-256-GCM, backend-enforced rate limiting, constant-time token comparison, CSRF protection) but has significant architectural debt (god-object WalletContext, 40+ untested files) and several correctness bugs in multi-account flows.

---

## Critical Issues — Must Fix

| # | Issue | File:Line | Category | Effort |
|---|-------|-----------|----------|--------|
| 1 | `withTransaction()` race condition — concurrent async calls corrupt `transactionDepth` global, leaving DB transactions open | `src/services/database/connection.ts:44-79` | Bug | Medium |
| 2 | Cross-account derived address leak — `getDerivedAddresses()` called without `accountId` in multi-key send, could sign with wrong account's addresses | `src/services/wallet/transactions.ts:209` | Security/Bug | Quick fix |
| 3 | Empty password fallback in account deletion — `sessionPassword ?? ''` silently passes empty string when session expired | `src/hooks/useAccountSwitching.ts:217` | Bug | Quick fix |
| 4 | Unvalidated fee rate API response — `JSON.parse()` on GorillaPool response without schema validation; NaN/Infinity could propagate | `src/infrastructure/api/feeService.ts:72-75` | Security | Quick fix |

---

## High Priority — Should Fix Soon

| # | Issue | File:Line | Category | Effort |
|---|-------|-----------|----------|--------|
| 5 | Fire-and-forget `clear_keys` — wallet shows "locked" while Rust may still hold keys in memory | `src/hooks/useWalletLock.ts:81-83` | Security | Quick fix |
| 6 | Silent catch on lock block update — `updateLockBlock().catch(() => {})` swallows DB errors | `src/contexts/WalletContext.tsx:352` | Bug | Quick fix |
| 7 | Cross-account lock contamination — lock merge runs between version checks during account switch | `src/contexts/WalletContext.tsx:318-334` | Bug | Medium |
| 8 | Account ID coercion inconsistency — `|| 1` vs `|| undefined` across codebase | `WalletContext:296`, `sync.ts:165` | Bug | Medium |
| 9 | Broadcast txid not format-validated — arbitrary strings pass as valid txids | `src/services/wallet/transactions.ts:77-80` | Bug | Quick fix |
| 10 | PBKDF2 at 100K iterations — below 2026 OWASP recommendation of 600K+ | `src/services/crypto.ts:75` | Security | Medium |
| 11 | WalletContext god object — 38 properties, 77-item useMemo dep array, all consumers re-render on any change | `src/contexts/WalletContext.tsx:39-107` | Architecture | Major |
| 12 | 40+ files with zero test coverage — all hooks, most services, all contexts, all DB repositories | Multiple | Quality | Major |
| 13 | Mixed error handling patterns — Result<T,E> defined but used in only 2 files; 95% uses ad-hoc `{success, error}` | Multiple | Architecture | Major |
| 14 | Duplicated broadcast logic — 4 separate implementations | Multiple | Architecture | Medium |

---

## Medium Priority — Good to Improve

| # | Issue | File:Line | Category | Effort |
|---|-------|-----------|----------|--------|
| 15 | Sync lock not scoped per account — cross-account send hangs | `transactions.ts:163` | Bug | Medium |
| 16 | Float precision in fee rate — `satoshis / bytes` produces floats | `fees.ts:52` | Bug | Quick fix |
| 17 | Negative satoshis not rejected — `btcToSatoshis()` allows negative input | `satoshiConversion.ts:11` | Bug | Quick fix |
| 18 | Auto-lock unhandled throw in visibility handler | `useWalletLock.ts:98-101` | Bug | Quick fix |
| 19 | UTXO tag insertion not transactional — partial writes on failure | `utxoRepository.ts:148-162` | Bug | Quick fix |
| 20 | Tauri commands lack auth at command level — JS `invoke()` bypasses HTTP server auth | `src-tauri/src/lib.rs:554-596` | Security | Medium |
| 21 | Session tokens in response headers — log exposure risk | `http_server.rs:163` | Security | Quick fix |
| 22 | Context values not memoized — SyncContext, LocksContext cause unnecessary re-renders | `SyncContext.tsx`, `LocksContext.tsx` | Performance | Quick fix |
| 23 | 33-prop drilling to AppModals | `App.tsx:447-486` | Architecture | Medium |
| 24 | Dynamic import in hot path (performSync) | `SyncContext.tsx:160` | Performance | Quick fix |

---

## Low Priority — Nice to Have

| # | Issue | File:Line | Category | Effort |
|---|-------|-----------|----------|--------|
| 25 | `Math.random()` in certificate serials — should use crypto.getRandomValues() | `certificates.ts:287` | Security | Quick fix |
| 26 | SQLite not encrypted at rest (no private keys stored, only tx history) | `lib.rs:547-549` | Security | Major |
| 27 | CSRF nonce eviction by count not time | `lib.rs:206` | Security | Quick fix |
| 28 | Audit log allowlist approach — fragile against new field names | `auditLog.ts:47-48` | Security | Medium |
| 29 | SDK response signature verification only warns | `sdk/index.ts:208` | Security | Quick fix |
| 30 | `any` type in backup recovery | `backupRecovery.ts:122-123` | Quality | Quick fix |
| 31 | Type cast bypass `setLocks as (locks: never[]) => void` | `WalletContext.tsx:252` | Quality | Quick fix |
| 32 | Migration helper duplication | `utxoRepository.ts:28-57` | Quality | Quick fix |
| 33 | Fee calculation spread across 4 files | Multiple | Architecture | Medium |
| 34 | Double fetchVersionRef increment — fragile ordering | `useAccountSwitching.ts:84,155` | Bug | Quick fix |

---

## Secure Areas (No Issues Found)

- AES-256-GCM encryption: Fresh random IV+salt per encryption, proper key derivation
- BIP-39 mnemonic handling: Never logged, processed in Rust only, zeroized after use
- Rate limiting: Backend-enforced with HMAC integrity, exponential backoff (5 attempts, up to 5 min lockout)
- DNS rebinding protection: Host header whitelist with case-insensitive matching
- CSRF: HMAC-bound nonces with 5-min expiry and reuse prevention
- Constant-time token comparison via `subtle` crate (prevents timing attacks)
- Zero SQL injection risk: All queries parameterized throughout all 10 repositories
- No XSS vectors: No `dangerouslySetInnerHTML`, no `innerHTML` usage
- Input validation: Address checksum verification, amount overflow checks, origin URL validation
- No hardcoded secrets or API keys
- Session key rotation: 6-hour TTL, non-extractable, in-memory only
- Legacy plaintext detection: Auto-detects and removes unencrypted wallet data

---

## Prioritized Remediation Plan

### Sprint 1: Critical Fixes (1-2 days)
1. Pass `accountId` to `getDerivedAddresses()` in `transactions.ts:209`
2. Guard `sessionPassword` null in `useAccountSwitching.ts:217` — throw if null instead of empty string
3. Validate fee rate API response structure before parsing in `feeService.ts:72`
4. Make `transactionDepth` in `connection.ts` use a proper async mutex or queue

### Sprint 2: High-Priority Security & Bugs (3-5 days)
5. Await `invoke('clear_keys')` in `lockWallet`
6. Add error logging to all silent `.catch(() => {})` blocks
7. Validate broadcast txid format (64-char hex)
8. Standardize account ID handling — replace all `|| 1` / `|| undefined` with explicit null checks
9. Move version check before lock merge logic in WalletContext

### Sprint 3: Architecture (1-2 weeks)
10. Split WalletContext into WalletStateContext + WalletActionsContext + WalletSettingsContext
11. Consolidate broadcast logic into single `broadcastService.ts`
12. Memoize all context provider values
13. Move modal state to dedicated ModalContext to eliminate prop drilling

### Sprint 4: Test Coverage (2-3 weeks)
14. Add tests for wallet core operations (send, lock, unlock, transfer)
15. Add tests for sync engine (UTXO reconciliation, account-scoped sync)
16. Add tests for all database repositories (CRUD, account isolation)
17. Add tests for critical hooks (useWalletLock, useAccountSwitching, useWalletInit)

### Sprint 5: Long-term (ongoing)
18. Migrate error handling to Result<T,E> pattern (start with services layer)
19. Increase PBKDF2 to 600K iterations with migration path
20. Add auth checks at Tauri command level (not just HTTP layer)
21. Evaluate SQLCipher for optional database encryption

---

# Review #2: Polish, Stability & Windows Compatibility — 2026-02-16

**Scope**: Focused review on polish, stability, and Windows compatibility
**Baseline**: 0 type errors, 0 lint errors, 1098 tests passing

## Remediation Applied (12 items)

| ID | Severity | Issue | File | Fix |
|----|----------|-------|------|-----|
| S1 | CRITICAL | Lock creation DB writes non-atomic | `locks.ts:205-258` | Wrapped in `withTransaction()` |
| B1 | HIGH | Unhandled promise rejection in auto-lock | `autoLock.ts:81-90` | Added `.catch()` handler |
| B2 | HIGH | SyncContext swallows errors silently | `SyncContext.tsx:252-409` | Aggregate partial errors via `syncError` |
| B4 | LOW | Auto-lock timer 60s granularity | `autoLock.ts:81-90` | Reduced to 15s interval |
| W1 | MEDIUM | Backup path hardcoded `/` | `backupRecovery.ts:147` | Platform-aware separator |
| W2 | LOW | Missing .gitattributes | root | Created with LF normalization |
| A2 | MEDIUM | Toast lacks severity types | `UIContext.tsx`, `Toast.tsx` | success/error/warning/info types |
| P1 | LOW | No tab transition animations | `App.css` | CSS fade-in keyframe |
| P2 | LOW | Balance update no visual feedback | `BalanceDisplay.tsx` | `.updating` class during sync |
| P3 | LOW | No tooltips on truncated text | Multiple files | Added `title` attributes |
| P4 | LOW | Toast no dismiss or hover-pause | `Toast.tsx` | Dismiss button, hover reveal |
| P5 | LOW | Search not debounced | `OrdinalsTab.tsx` | 250ms debounce |

## Windows Compatibility: 95/100

Positive findings:
- Rust uses `PathBuf`/`dirs` crate correctly everywhere
- Tauri origins include `https://tauri.localhost` for Windows
- Keyboard shortcuts use cross-platform key names
- Font stack includes `Segoe UI`
- NSIS installer config present
- Icons include `.ico`

## Post-Fix Verification

```
npm run typecheck  -> Clean
npm run lint       -> 0 errors (3 warnings in coverage/)
npm run test:run   -> 1098/1098 passing
```

---

# Review #3: Code Review of Review #2 Changes — 2026-02-16

**Reviewer:** Claude Opus 4.6
**Scope:** All 19 uncommitted files from Review #2 remediation
**Baseline:** 0 type errors, 0 lint errors, 1098 tests passing

## Overall Health Rating: 8.5/10 (up from 7.5/10)

Review #2 remediation was well-executed. The critical atomicity fix (S1) is correct. Toast severity system is clean and consistent across 24 call sites. No new bugs or security vulnerabilities introduced.

## Findings

| # | Severity | Issue | File:Line | Status |
|---|----------|-------|-----------|--------|
| S2 | MEDIUM | Unlock path DB writes not atomic | `locks.ts:423-443` | **FIXED** — wrapped in `withTransaction()` |
| B2 | LOW | Outer exception overwrites partial error detail | `SyncContext.tsx:418` | **FIXED** — preserves partial errors |
| S3 | LOW | No path traversal validation in backup | `backupRecovery.ts:148` | **FIXED** — rejects `..` in path |
| B3 | LOW | Inconsistent promise pattern in autoLock | `autoLock.ts` | N/A — false positive (already unified) |
| Q1 | LOW | Missing `prefers-reduced-motion` media query | `App.css:556` | **FIXED** — disables animation for reduced-motion |

## Secure Areas Confirmed

- Lock atomicity: Both lock and unlock paths now use `withTransaction()` ✅
- Toast system: No XSS vectors, type-safe, stack-limited ✅
- React hooks: All 12 component files follow rules of hooks ✅
- Error handling: No silent failures in new code ✅
- Architecture: No layer violations ✅

## Post-Fix Verification (Review #3)

```
npm run typecheck  -> Clean
npm run lint       -> 0 errors (3 warnings in coverage/)
npm run test:run   -> 1098/1098 passing
```

---

# Review #4: Full Codebase Review — 2026-02-16

**Reviewer:** Claude Opus 4.6
**Scope:** Full 4-phase review (security, bugs, architecture, quality)
**Baseline:** 0 lint errors, 0 type errors, 1098/1098 tests passing
**Phase ratings:** Security 7.5/10, Bugs 5.5/10, Architecture 7.0/10, Quality 7.0/10

## Overall Health Rating: 6.5/10

Strong cryptographic foundations and thoughtful architecture, but the security model is undermined by WIFs still living in the JavaScript heap despite the Rust key store. Multi-account feature introduced several correctness bugs around account scoping. BRC-100 handler has significant DRY violations and test coverage gaps in security-critical modules remain.

---

## Critical Issues (5)

| # | Phase | Issue | File(s) | Effort |
|---|-------|-------|---------|--------|
| C1 | Security | WIFs exposed in JS heap — React state holds `walletWif`, `ordWif`, `identityWif` despite Rust key store | `useWalletSend.ts`, `LocksContext.tsx`, `TokensContext.tsx`, `SettingsModal.tsx`, `brc100/signing.ts`, `brc100/cryptography.ts` | Major |
| C2 | Security | Rate limiter fails open — returns `isLimited: false` when Tauri backend errors | `rateLimiter.ts:44-48, 74-78` | Quick fix |
| C3 | Bug | Coin-control mode signs all UTXOs with `walletWif` regardless of actual owner address | `useWalletSend.ts:59-66` | Medium |
| C4 | Bug | Account index derivation uses DB auto-increment ID — fragile after deletion | `AccountsContext.tsx:155-159` | Medium |
| C5 | Arch | No global handler for unhandled promise rejections — async failures silently vanish | Missing from codebase | Quick fix |

## High Priority (12)

| # | Phase | Issue | File(s) |
|---|-------|-------|---------|
| H1 | Security | WIFs in plaintext JSON backup before encryption | `SettingsModal.tsx:196-198` |
| H2 | Security | Auto-lock "Never" contradicts 60min max policy | `autoLock.ts:221` |
| H3 | Security | No URL encoding on API path parameters | `wocClient.ts:139,156,192` |
| H4 | Security | Legacy migration has plaintext + data-loss window | `wallet/storage.ts:177-207` |
| H5 | Bug | `activeAccountId \|\| undefined` treats account 0 as falsy | `useWalletSend.ts:70`, `txRepository.ts:393` |
| H6 | Bug | `getBalanceSafe` can return negative balance | `wocClient.ts:137-152` |
| H7 | Bug | `performSync` continues after account switch (no cancellation) | `WalletContext.tsx:230-233` |
| H8 | Bug | `repairUTXOs` un-freezes intentionally frozen UTXOs | `utxoRepository.ts:530-560` |
| H9 | Arch | 40+ components bypass contexts with direct service imports | SettingsModal, RestoreModal, SendModal, etc. |
| H10 | Arch | N+1 API pattern in lock detection — sequential HTTP per tx | `locks.ts:638-737` |
| H11 | Quality | 15+ security-critical service files have zero tests | `secureStorage.ts`, `brc100/signing.ts`, `certificates.ts`, `backupRecovery.ts`, etc. |
| H12 | Quality | BRC-100 `listOutputs` and `getPublicKey` duplicated 2-3x | `brc100.ts` |

## Medium Priority (17)

| # | Phase | Issue |
|---|-------|-------|
| M1 | Security | Crypto fallback from Rust to Web Crypto silently degrades |
| M2 | Security | `sql:allow-execute` grants frontend broad SQL access |
| M3 | Security | Mnemonic stored in React state, not cleared by GC |
| M4 | Security | Rate limiter HMAC key hardcoded in binary |
| M5 | Security | Session token returned to frontend JS |
| M6 | Security | `fs:allow-write-text-file` unscoped |
| M7 | Bug | `amount: row.amount \|\| undefined` maps 0 to undefined |
| M8 | Bug | `handleLock` dedup uses stale `locks` state |
| M9 | Bug | `transactionDepth` module-level global |
| M10 | Bug | Two conflicting `WocTransaction` types with unsafe cast |
| M11 | Arch | WalletContext god-object (473 lines, 22+22 properties) |
| M12 | Arch | 3 inconsistent error return patterns |
| M13 | Arch | Infrastructure imports from services (upward dependency) |
| M14 | Quality | SettingsModal monolith (1,058 lines) |
| M15 | Quality | Structured error types defined but never used |
| M16 | Quality | localStorage abstraction bypassed by 17 files |
| M17 | Quality | `useWallet()` merges all state causing excessive re-renders |

## Low Priority (15+)

Password validation inconsistency, block height estimation fallback, `getPublicKey` skips CSRF, trusted origins in plaintext, no max tx amount, `btcToSatoshis` silent on negatives, `cancellableDelay` listener leak, toast timeout no cleanup, ordinal grid no virtualization, 136 non-null assertions, inline styles, dead `_messageBoxStatus` state, `beforeunload` no cleanup, `BASKETS` duplicated, `handleKeyDown` duplicated 24x.

---

## Positive Observations

1. **Cryptography:** AES-256-GCM, 600K PBKDF2 iterations, random IVs/salts via CSPRNG
2. **Rust Key Store:** Zeroization via `zeroize` crate, `get_mnemonic_once`, `_from_store` variants
3. **BRC-100 Server:** DNS rebinding protection, constant-time comparison, CSRF nonces, HMAC signing, rate limiting
4. **Domain Layer:** Pure — zero imports from infrastructure/services/components
5. **Broadcast:** 4-endpoint fallback with "txn-already-known" detection
6. **ErrorBoundary:** Every tab and modal wrapped with custom fallback
7. **Accessibility:** 108 ARIA attributes, focus trapping, keyboard nav, screen reader support
8. **No XSS:** Zero `dangerouslySetInnerHTML`
9. **SQL Safety:** All queries parameterized
10. **Tests:** 1098 passing with good domain coverage

---

## Remediation Plan

### Phase 1: Critical Security & Quick Wins (1-2 days)
1. Rate limiter fail-closed (C2)
2. Global unhandled rejection handler (C5)
3. URL encoding in wocClient (H3)
4. `||` to `??` for account ID checks (H5)
5. Negative balance guard (H6)
6. Remove "Never" auto-lock (H2)

### Phase 2: Key Management Migration (1-2 sprints)
7. Remove WIFs from frontend `WalletKeys` type (C1)
8. Migrate all call sites to `_from_store` Tauri commands (C1)
9. Build encrypted backups in Rust (H1)
10. Disable crypto fallback in production (M1)

### Phase 3: Multi-Account Correctness (1 sprint)
11. Add `derivation_index` column to accounts (C4)
12. Fix coin-control WIF assignment (C3)
13. Pass cancellation token through sync flow (H7)
14. Fix `repairUTXOs` frozen handling (H8)

### Phase 4: Architecture & Quality (2-3 sprints)
15. Extract BRC-100 handler duplication (H12)
16. Write tests for security-critical modules (H11)
17. Begin `Result<T,E>` migration at service boundaries (M12/M15)
18. Batch lock detection API calls (H10)
19. Break SettingsModal into sub-components (M14)
20. Migrate localStorage calls to abstraction layer (M16)

## Post-Review Verification (Review #4)

```
npm run typecheck  -> Clean
npm run lint       -> 0 errors (3 warnings in coverage/)
npm run test:run   -> 1098/1098 passing
```
