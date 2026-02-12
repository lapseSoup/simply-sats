# Simply Sats Code Review — Post-Remediation Re-Review

**Date:** 2026-02-11
**Reviewer:** Claude Opus 4.6
**Codebase:** Simply Sats BSV Wallet v0.1.0
**Stack:** Tauri 2 + React 19 + TypeScript 5.9 + Vite 7 + Rust backend
**Baseline:** 0 type errors, 0 lint errors, 657 tests passing, 42+ Rust tests passing
**Context:** Fresh 4-phase review after all 51 prior findings were remediated
**Scope:** Full project — security, bugs, architecture, code quality

---

## Overall Health Rating: 6.5/10

**Strengths:**
- Rust key store with zeroize-on-drop, `_from_store` command variants
- PBKDF2 100k iterations + AES-256-GCM encryption
- Rate limiting with HMAC integrity and exponential backoff
- Structured logging throughout Rust backend (`log` + `env_logger`)
- API versioning under `/v1/` with legacy backward compat
- Session isolation per account with token rotation
- Response HMAC signing on BRC-100 responses
- CryptoKey TTL refresh (6-hour rotation)
- 657 passing TS tests + 42 Rust tests
- Cancellation token pattern for async operations
- Multi-endpoint broadcast fallback (WoC → ARC → mAPI)

**Key gaps:** WIFs still transit IPC, WalletContext God Object, layer violations, test coverage gaps for contexts/Rust, encrypted data lost on restart.

---

## Phase 1: Security Audit (13 findings)

### HIGH (3)

| ID | Issue | Location | Fix Approach | Effort |
|----|-------|----------|-------------|--------|
| H-1 | **WIFs still transit IPC via `store_keys_direct`** — WIF strings pass through Tauri's invoke IPC channel during unlock/account-switch. They exist momentarily in JS memory. | `WalletContext.tsx:~384,~474` | Derive keys entirely in Rust via `store_keys(mnemonic, account_index)` — requires storing account index with encrypted wallet data | Medium |
| H-2 | **CSRF nonces not cryptographically bound to session** — `csrf_secret` is generated but never used. Nonces are validated only by presence in HashSet. Any format-matching string is accepted. | `lib.rs`, `http_server.rs` | Compute nonce as `HMAC-SHA256(csrf_secret, timestamp + random)` and verify binding on validation | Medium |
| H-3 | **`get_session_token` exposes bearer token to JS** — Tauri command returns session token to frontend, putting it in JS-reachable memory | `lib.rs` | Internal-only token flow where HTTP server validates without JS involvement | Medium |

### MEDIUM (5)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| M-1 | `get_wif()` returns `clone()` — clone not zeroized after use by signing commands | `key_store.rs:73-80` | Medium |
| M-2 | `store_keys` clones mnemonic before storing — copy not explicitly zeroized | `key_store.rs:110` | Quick fix |
| M-3 | Token rotation race condition — double `rotate_session_for_account` calls could overlap | `lib.rs` | Quick fix |
| M-4 | Rate limiter HMAC uses static hardcoded key — tamper detection but not real integrity | `rate_limiter.rs` | Medium |
| M-5 | Session password held in React state for duration of session | `WalletContext.tsx` | Medium |

### LOW (5)

| ID | Issue | Location |
|----|-------|----------|
| L-1 | Origin port stripping edge case | `http_server.rs` |
| L-2 | SDK signature verification is warn-only | `sdk/src/index.ts` |
| L-3 | Nonce cleanup timing window | `lib.rs` |
| L-4 | `get_mnemonic_once` returns clone before zeroizing original | `key_store.rs` |
| L-5 | Predictable timestamp component in request IDs | `sdk/src/index.ts` |

---

## Phase 2: Bug Detection (15 findings)

### HIGH (3)

| ID | Issue | Location | Fix Approach | Effort |
|----|-------|----------|-------------|--------|
| B-1 | **Stale `locks` closure in handleLock/handleUnlock** — concurrent operations or sync updates overwrite each other | `LocksContext.tsx:112,142` | Use functional updater `setLocks(prev => ...)` | Quick fix |
| B-2 | **`deleteAccount` uses empty password for new active account** — `getKeysForAccount(active, '')` always fails to decrypt | `WalletContext.tsx:629` | Use `sessionPassword` instead of `''` | Quick fix |
| B-8 | **Encrypted data unreadable after app restart** — session CryptoKey generated fresh each session, encrypted localStorage data becomes undecryptable | `secureStorage.ts:46-68` | Persist key, use Tauri secure storage, or accept session-scoped values | Medium |

### MEDIUM (7)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| B-3 | `restoreFromBlockchain` force-unwraps potentially undefined result (`result!`) | `sync.ts:776` | Quick fix |
| B-4 | `getFeeRateAsync` missing fee rate clamping (inconsistent with `getFeeRate`) | `fees.ts:99-108` | Quick fix |
| B-5 | Inconsistent change output threshold between fee estimator (`> 0`) and builder (`> 100`) | `transaction.rs:96` vs `fees.ts:241` | Quick fix |
| B-6 | `handleSend` mixes DB and live UTXOs; coin control leaks derived address UTXOs | `WalletContext.tsx:1030-1074` | Medium |
| B-9 | OP_RETURN script byte order `[0x6a, 0x00]` differs from BSV `OP_FALSE OP_RETURN` convention `[0x00, 0x6a]` | `locks.ts:72-74` | Quick fix |
| B-12 | BRC-100 encrypt handler `String.fromCharCode(...arr)` crashes on large payloads (stack overflow) and corrupts bytes >127 | `brc100.ts:994` | Quick fix |
| B-14 | CSRF nonces accept any format-matching string (overlaps H-2) | `lib.rs:122-161` | Medium |

### LOW (5)

| ID | Issue | Location |
|----|-------|----------|
| B-7 | Lock duration based on potentially stale `networkInfo.blockHeight` | `LocksContext.tsx:102` |
| B-10 | `onLocksDetected` called twice with different parameter shapes | `SyncContext.tsx:296,374` |
| B-11 | Inconsistent indentation around sync lock in `consolidateUtxos` | `transactions.ts:406-442` |
| B-13 | `rejectRequest` calls `resolve` instead of `reject` (semantically wrong but functionally OK) | `brc100.ts:1409` |
| B-15 | Lock coin selection stops too early with static 500-sat buffer | `locks.ts:121` |

---

## Phase 3: Architecture Review (13 findings)

### CRITICAL (1)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| AR-1 | **WalletContext is a God Object (1,327 lines)** — consumes all 6 other contexts, re-exports 50+ fields, single `useMemo` with 40+ deps. Every `useWallet()` consumer re-renders on any field change. | `WalletContext.tsx` | Major |

### HIGH (2)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| AR-2 | **29 components import services directly** — bypasses `Components → Hooks → Contexts → Services` layering. RestoreModal imports 6 service modules. | 29 component files | Major |
| AR-3 | **Domain layer depends on services layer (inverted)** — `domain/repositories/index.ts` imports from `services/wallet` and `services/database` | `domain/repositories/`, `domain/ordinals/` | Medium |

### MEDIUM (7)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| AR-4 | Duplicate type definitions between `domain/types.ts` and `services/wallet/types.ts` with subtle field differences | Both type files | Medium |
| AR-5 | Infrastructure layer depends on services layer (`wocClient` imports from `services/errors`, `httpClient` from `services/logger`) | `infrastructure/api/` | Medium |
| AR-6 | Connected apps state managed in 3 places (WalletContext, unused ConnectedAppsContext, useBrc100Handler with different storage) | 3 files | Medium |
| AR-7 | BRC-100 global mutable state (`setWalletKeys`) — module-level WIF storage duplicates Rust key store's purpose | `brc100/state.ts` | Medium |
| AR-8 | Direct `fetch()` calls bypass infrastructure layer in 10+ service files — no consistent retry/backoff | Multiple service files | Major |
| AR-9 | Domain layer contains Tauri IPC calls (`keyDerivation.ts` calls `invoke()`) — domain is impure | `domain/wallet/keyDerivation.ts` | Medium |
| AR-10 | Missing error boundary architecture — 14-step sequential init, no graceful degradation | `WalletContext.tsx`, `SyncContext.tsx` | Medium |

### LOW (3)

| ID | Issue | Location |
|----|-------|----------|
| AR-11 | Flat Rust module structure with duplicated validation boilerplate in 6 handlers | `http_server.rs`, `lib.rs` |
| AR-12 | Dual `wallet.ts` re-export facade files (unnecessary indirection) | `services/wallet.ts` + `services/wallet/index.ts` |
| AR-13 | Infrastructure layer mostly empty — architecture diagram doesn't match reality | `infrastructure/` |

---

## Phase 4: Code Quality (17 findings)

### HIGH (3)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| CQ-1 | **WalletContext duplicates ConnectedAppsContext** — `ConnectedAppsContext.tsx` is complete dead code, never wired into AppProviders | `ConnectedAppsContext.tsx`, `WalletContext.tsx` | Medium |
| CQ-5 | **Unsafe `result!` non-null assertion** — `syncWallet` can return `undefined` when cancelled | `sync.ts:776` | Quick fix |
| CQ-12 | **No test coverage for contexts, most components, or Rust backend** — zero tests for 7 context providers, critical user flows, or Rust modules | All context files, Rust backend | Major |

### MEDIUM (8)

| ID | Issue | Location | Effort |
|----|-------|----------|--------|
| CQ-2 | Duplicated `store_keys_direct` invoke with identical 10-field params in 2 places | `WalletContext.tsx:384,474` | Quick fix |
| CQ-3 | Lock-to-LockedUTXO mapping pattern repeated 3 times | `WalletContext.tsx`, `SyncContext.tsx` | Quick fix |
| CQ-4 | Deprecated `_sendBSVInner` and `_sendBSVMultiKeyInner` share near-identical logic | `transactions.ts` | Medium |
| CQ-6 | `as Ordinal[]` unsafe type assertion on partial database results | `WalletContext.tsx:525`, `SyncContext.tsx:309` | Quick fix |
| CQ-8 | 7 silent catch blocks in tokens service swallow all errors | `tokens.ts` | Quick fix |
| CQ-10 | Duplicated HTTP request parsing/validation boilerplate in 6 Rust handlers | `http_server.rs` | Medium |
| CQ-11 | `showToast` setTimeout without cleanup on unmount | `UIContext.tsx:84` | Quick fix |
| CQ-14 | `handleSend` fetches UTXOs from live API during send instead of using DB | `WalletContext.tsx:1047-1062` | Medium |

### LOW (6)

| ID | Issue | Location |
|----|-------|----------|
| CQ-7 | `AnyPrivateKey = any` workaround in marketplace | `marketplace.ts:14` |
| CQ-9 | `any[]` for SQL row mapping in backup recovery | `backupRecovery.ts:122` |
| CQ-13 | Price fetch without timeout in NetworkContext | `NetworkContext.tsx:88` |
| CQ-15 | `WalletErrorBoundary` duplicates `ErrorBoundary` with cosmetic differences | `ErrorBoundary.tsx` |
| CQ-16 | Missing `aria-describedby` for amount validation in SendModal | `SendModal.tsx` |
| CQ-17 | Duplicated ordinal operation setup/teardown in WalletContext | `WalletContext.tsx` |

---

## Consolidated Summary

| Severity | Count | Breakdown |
|----------|-------|-----------|
| **Critical** | 1 | Architecture: 1 (AR-1) |
| **High** | 11 | Security: 3, Bugs: 3, Architecture: 2, Quality: 3 |
| **Medium** | 27 | Security: 5, Bugs: 7, Architecture: 7, Quality: 8 |
| **Low** | 19 | Security: 5, Bugs: 5, Architecture: 3, Quality: 6 |
| **Total** | **58** | |

---

## Prioritized Remediation Plan

### Sprint 1: Quick Wins — High-Impact Bug Fixes (6 items)

| Priority | ID | Fix | Effort |
|----------|----|-----|--------|
| 1 | B-1 | Use functional updater `setLocks(prev => ...)` in LocksContext | Quick fix |
| 2 | B-2 | Use `sessionPassword` instead of `''` in deleteAccount | Quick fix |
| 3 | CQ-5 | Handle undefined in `restoreFromBlockchain` instead of `result!` | Quick fix |
| 4 | B-4 | Add fee rate clamping to `getFeeRateAsync` | Quick fix |
| 5 | B-12 | Fix encrypt handler: use `TextDecoder` instead of `String.fromCharCode` spread | Quick fix |
| 6 | B-9 | Swap OP_RETURN byte order to `[0x00, 0x6a]` for BSV convention | Quick fix |

### Sprint 2: Security Hardening (5 items)

| Priority | ID | Fix | Effort |
|----------|----|-----|--------|
| 7 | H-2 / B-14 | HMAC-bind CSRF nonces to `csrf_secret` | Medium |
| 8 | H-1 | Complete WIF removal from IPC — derive entirely in Rust | Medium |
| 9 | M-1 | Zeroize WIF clones after signing operations | Medium |
| 10 | M-2 | Zeroize mnemonic clone in `store_keys` | Quick fix |
| 11 | B-8 | Fix encrypted data persistence across restarts | Medium |

### Sprint 3: Architecture — WalletContext Decomposition (3 items)

| Priority | ID | Fix | Effort |
|----------|----|-----|--------|
| 12 | AR-1 | Allow direct context consumption; extract `useWalletActions()` hook | Major |
| 13 | CQ-1 / AR-6 | Wire ConnectedAppsContext into AppProviders, remove duplicate from WalletContext | Medium |
| 14 | AR-7 | Replace BRC-100 global mutable state with parameterized operations | Medium |

### Sprint 4: Code Quality & DRY (8 items)

| Priority | ID | Fix | Effort |
|----------|----|-----|--------|
| 15 | CQ-2 | Extract `storeKeysInRust()` helper | Quick fix |
| 16 | CQ-3 | Extract `mapDbLockToLockedUTXO()` utility | Quick fix |
| 17 | CQ-8 | Add logging to tokens service silent catches | Quick fix |
| 18 | CQ-10 | Extract shared request parsing middleware in Rust handlers | Medium |
| 19 | CQ-6 | Fix `as Ordinal[]` unsafe casts with proper partial types | Quick fix |
| 20 | B-5 | Align change output threshold between fee estimator and builder | Quick fix |
| 21 | B-6 | Skip derived address UTXO fetching in coin control mode | Medium |
| 22 | CQ-14 | Use database UTXOs instead of live API in `handleSend` | Medium |

### Sprint 5: Testing & Layer Fixes (5 items)

| Priority | ID | Fix | Effort |
|----------|----|-----|--------|
| 23 | CQ-12 | Add context provider tests and Rust backend unit tests | Major |
| 24 | AR-2 | Route component service imports through contexts/hooks | Major |
| 25 | AR-3 / AR-5 | Fix inverted domain/infra dependencies on services | Medium |
| 26 | AR-4 | Consolidate duplicate type definitions | Medium |
| 27 | AR-8 | Route fetch() calls through infrastructure layer | Major |

---

## Top 5 Priority Fixes (Start Here)

1. **B-1** — Stale locks closure → data loss on concurrent operations
2. **B-2** — deleteAccount empty password → user stranded after account deletion
3. **H-2** — CSRF nonces unbounded to session → protection is cosmetic only
4. **B-8** — Encrypted data lost on restart → trusted origins/connected apps reset every session
5. **AR-1** — WalletContext God Object → cascade re-renders, untestable, single point of failure
