# Simply Sats — Full Code Review v5 (Review #8)
**Date:** 2026-02-17
**Previous review:** v4 (7.5/10)
**This review:** v5 (7.8/10)
**Reviewer:** Claude Sonnet 4.6 (automated)

---

## Pre-Review Checks

| Check | Result |
|-------|--------|
| `npm run lint` | 0 errors, 34 warnings (all `no-restricted-imports` in components — A-1 carry-over) |
| `npm run typecheck` | ✅ Clean |
| `npm run test:run` | ✅ 1593 passed, 64 files |

**Recent commits reviewed:**
- `2be28a0` — Merge fix/review-remediation: review 7 security hardening, bug fixes, resilience
- `8a79722` — fix: review 7 remediation — security hardening, bug fixes, and resilience
- `ed2e004` — fix: review 6 remediation — security, race conditions, and code quality

---

## Remediation Progress from v4

The review-7 remediation commit (`8a79722`) addressed a substantial number of v4 issues. Here is the confirmed status:

### ✅ Confirmed Fixed (14 items)

| ID | Fix |
|----|-----|
| B-1 | `isCancelled` check now before `setBalance` at `SyncContext.tsx:261` |
| B-2 | `lockWallet()` failure forces `setIsLocked(true)` at `useWalletLock.ts:127-130` |
| B-3 | `accountId ?? 1` replaced with hard throw at `transactions.ts:210-211` |
| B-4 | Duplicate UTXO error caught with `UNIQUE`/`duplicate` string check at `transactions.ts:174,365` |
| B-5 | Full null guard: `prevTx?.vout && Array.isArray(prevTx.vout)` at `balance.ts:113` |
| B-6 | `feeFromBytes` validates bytes and rate with `Number.isFinite` at `domain/transaction/fees.ts:97-103` |
| B-7 | `Math.max(1, Math.ceil(bytes * feeRate))` prevents zero/negative fee |
| B-8 | `decryptBackupAccount` validates keys post-decrypt at `backupRecovery.ts:177-179` |
| B-9 | Visibility `useEffect` cleanup properly removes listener in return function |
| B-11 | `Number.isFinite(totalBalance)` guard at `SyncContext.tsx:264` |
| B-12 | `isCacheValid()` requires `age >= 0` at `fees.ts:93-96` |
| B-13 | Ordinal array destructuring uses defaults: `[ordAddressOrdinals = [], ...]` |
| S-2 | Read-back verify present: `secure_storage_exists` invoked after save at `storage.ts:43-48` |
| S-4 | PBKDF2 minimum enforced: `Math.max(encryptedData.iterations, PBKDF2_ITERATIONS)` at `crypto.ts:239` |
| Q-1 | `getStoredFeeRate()` helper centralizes localStorage fee retrieval at `fees.ts:33-41` |
| Q-3 | `getUTXOsFromDB()` no longer swallows errors — explicit comment at `balance.ts:32-34` |
| Q-7a/b | `HIDDEN_LOCK_DELAY_MS` and fallback fee moved to config |
| A-4 | Most providers wrapped in `ErrorBoundary` (partial — `ConnectedAppsProvider` missed) |
| A-5 | Retry/backoff logic in `httpClient.ts` |

---

## Phase 1 — Security Audit

### Critical

**S-15 (NEW)** — `src/services/brc100/state.ts:19`
> Module-level `currentWalletKeys` can silently diverge from React state. If `setWalletKeys()` is not called after an account switch or wallet lock/unlock event, the BRC-100 HTTP server will sign requests with the **previous account's keys**. The module itself documents this as ARCH-6 and recommends refactoring.
> **Impact:** Cross-account BRC-100 signing. **Effort:** Medium (audit callers) / Major (full refactor)

### High

**S-1 (carry-over)** — `src/services/wallet/storage.ts:121`
> `saveWalletUnprotected()` stores WIF and mnemonic in the OS keychain without encryption. This is a deliberate design choice for passwordless wallets, but anyone with read access to the macOS Keychain (e.g., via another compromised process with same entitlements) can extract keys.

**S-16 (NEW)** — `src-tauri/src/http_server.rs:649`
> `tokio::time::timeout(Duration::from_secs(120), rx)` — 120 seconds is very long for a UI response. An attacker with a valid session token can hold connections open and exhaust Tokio threads, degrading responsiveness. **Recommend:** Reduce to 30s.

**S-17 (NEW)** — `src/services/secureStorage.ts:21-23`
> `SENSITIVE_KEYS` is intentionally empty. Comment explains that `trusted_origins` / `connected_apps` data caused issues when encrypted (key not persisted across sessions). However, these values **authorize BRC-100 operations** — an XSS attacker can read them from localStorage and replay them. **Consider:** Accept the loss-on-restart trade-off and encrypt these values.

### Medium

**S-3 (carry-over)** — `secureStorage.ts:47-114` — Session key rotation race (concurrent callers during TTL expiry get old key)

**S-6 (partial fix)** — `lib.rs:194-210` — `generate_nonce` now has capacity guard, but `validate_nonce` still runs cleanup inside the Mutex

**S-7 (carry-over)** — `utxoRepository.ts:83-89` — UTXO account migration lacks address ownership verification

**S-9, S-10, S-11, S-12, S-13, S-14** — See REVIEW_FINDINGS.md

---

## Phase 2 — Bug Detection

### High — All resolved from v4

B-1 through B-13 are confirmed fixed (see remediation table above).

### New Bugs Found

**B-14 (NEW, Medium)** — `src/contexts/SyncContext.tsx:334`
> `getOrdinalsFromDatabase(activeAccountId)` is awaited without a cancellation mechanism. The `isCancelled` check at line 338 runs **after** the DB call completes. During rapid account switches, the first account's DB results are briefly displayed before being overwritten. Adds visible flicker.

**B-15 (NEW, Low)** — `src/contexts/SyncContext.tsx:359-362`
> `contentCacheRef.current = newCache` is mutated directly, then `setOrdinalContentCache(new Map(newCache))` triggers a render. If two sync calls race (possible during background caching), the ref and state can briefly diverge. Low risk given single-threaded JS, but cleaner to update through state only.

**B-10 (carry-over, Medium)** — `SyncContext.tsx:369-380`
> When all `Promise.allSettled` ordinal calls fail, each returns `[]` with a warn log. The combined result is an empty array but no error state is set — user sees no ordinals without explanation. The DB cache fallback at lines 334-346 mitigates this, but the error condition is invisible.

---

## Phase 3 — Architecture Review

### High

**A-7 (NEW)** — `src/AppProviders.tsx:48`
> `ConnectedAppsProvider` is the only provider without an `ErrorBoundary`. Since it manages BRC-100 trusted origins and connected apps state, a crash propagates up to `UIProvider`. One-line fix: wrap in `<ErrorBoundary context="ConnectedAppsProvider">`.

### Medium

**A-8 (NEW)** — `src/services/brc100/state.ts` (ARCH-6)
> The file explicitly acknowledges this pattern needs refactoring. The `currentWalletKeys` module-level variable should be replaced with parameter injection so signing functions receive keys explicitly. This eliminates an entire class of cross-account key usage bugs.

**A-9 (NEW)** — `src/services/database/` vs `src/infrastructure/database/`
> The database repositories (10 files) live in `services/database/` but the architecture diagram shows they belong in `infrastructure/database/`. The infrastructure DB file is a stub. This violates the stated layered architecture.

**A-1, A-2, A-3, A-6** — Carry-overs from previous reviews (see REVIEW_FINDINGS.md)

---

## Phase 4 — Code Quality

### Fixed

- **Q-1** — `getStoredFeeRate()` helper eliminates duplication ✅
- **Q-3** — `getUTXOsFromDB()` no longer swallows errors ✅
- **Q-7a/b** — Magic numbers in config ✅

### Still Open

**Q-5 (carry-over)** — RestoreModal has zero tests. This is a security-critical flow (restores wallet from mnemonic) with no automated test coverage.

**Q-6 (carry-over)** — `ordinalContentCache` exists as both `useState` and `useRef` simultaneously. The ref (`contentCacheRef`) is passed to the background caching function while state (`setOrdinalContentCache`) is used for renders. Consolidating to one source of truth would simplify the code.

**Q-8 (NEW)** — `autoLock.ts:98` polls every 15 seconds. At 10-minute auto-lock, the maximum overshoot is 14 seconds. Acceptable, but 5 seconds would give better security/UX without meaningful CPU cost.

**Q-9 (NEW)** — `debugFindInvoiceNumber` at `keyDerivation.ts:267-368` brute-forces 7,000+ combinations. It is gated by `import.meta.env.DEV` only — verify this correctly evals to `false` in production builds.

---

## Overall Health Assessment

**Rating: 7.8 / 10** (up from 7.5)

**Strengths:**
- Excellent security fundamentals: PBKDF2-600K, AES-256-GCM, Tauri key store, CSRF nonces, DNS rebinding protection, constant-time token comparison
- Steady improvement: 14 issues resolved in this cycle
- 1593 tests, all green, covering critical crypto/wallet paths
- Cancellation token pattern well implemented for account switching
- Two-phase broadcast with atomic DB commit prevents lost funds

**Key risks remaining:**
- ARCH-6 (S-15): BRC-100 key state divergence — most actionable single fix
- Missing ErrorBoundary on ConnectedAppsProvider (A-7) — one-line fix
- 120s HTTP timeout (S-16) — one-line fix
- Empty SENSITIVE_KEYS (S-17) — requires a design decision
- RestoreModal untested (Q-5) — security-critical gap

---

## Quick Win List (can be fixed in < 1 hour total)

1. `AppProviders.tsx:48` — Wrap ConnectedAppsProvider in ErrorBoundary
2. `http_server.rs:649` — Change 120 to 30
3. `brc100/state.ts` — Audit all callers of `setWalletKeys()`, add assertions
4. `SyncContext.tsx:338` — Move `isCancelled` check before `setOrdinals(dbOrdinals)` call
