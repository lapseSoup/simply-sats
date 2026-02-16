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
