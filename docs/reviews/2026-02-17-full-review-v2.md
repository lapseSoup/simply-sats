# Simply Sats — Comprehensive Code Review v2

**Date:** 2026-02-17
**Baseline:** Lint clean (0 errors), TypeScript clean, **1606/1606 tests passing** (66 files)
**Overall Health Rating: 7.5/10**

---

## Phase 1: Security Audit (7.5/10)

### HIGH
- **SEC-1**: BRC-100 `buildAndBroadcastAction` bypasses coin selection — hardcoded 200-sat buffer (`src/services/brc100/actions.ts:691-893`)
- **SEC-2**: Overly broad filesystem permissions — `$DOWNLOAD/**`, `$DESKTOP/**` write access (`src-tauri/capabilities/default.json:22-29`)

### MEDIUM
- **SEC-3**: No output value validation in BRC-100 createAction (`src/services/brc100/actions.ts:718-719`)
- **SEC-4**: Locking script injection via BRC-100 outputs (`src/services/brc100/actions.ts:764-770`)
- **SEC-5**: WIF bridge exposes private keys to JS (`src-tauri/src/key_store.rs:369-384`)
- **SEC-6**: SQLite database unencrypted on disk (`src-tauri/src/lib.rs:234`)
- **SEC-7**: SQL plugin allows arbitrary queries (`src-tauri/capabilities/default.json:14-17`)
- **SEC-8**: Session token exposed to frontend JS (`src-tauri/src/lib.rs:469-475`)
- **SEC-9**: Rate limiter HMAC key hardcoded (`src-tauri/src/rate_limiter.rs:27`)

### LOW
- **SEC-10**: Rate limiter JS fallback resets on refresh
- **SEC-11**: `get_mnemonic` command doesn't clear (vs `get_mnemonic_once`)
- **SEC-12**: Legacy base64 migration path
- **SEC-13**: Common password list only ~30 entries

---

## Phase 2: Bug Detection (7/10)

### HIGH (Confirmed)
- **BUG-1**: `clearSessionPassword` before `getSessionPassword` in account switching (`src/hooks/useAccountSwitching.ts:156-157`)
- **BUG-2**: Unhandled promise rejection in payment listener (`src/App.tsx:127-135`)
- **BUG-3**: SyncContext state set after cancellation (`src/contexts/SyncContext.tsx:305-428`)

### MEDIUM
- **BUG-4**: Duplicate `LockedUTXO` type with incompatible fields
- **BUG-5**: `fetchVersionRef` race in WalletContext
- **BUG-6**: `syncAddress` zero-UTXO guard prevents genuine sweep detection
- **BUG-7**: `useBrc100Handler` effect tears down on every trust change
- **BUG-8**: Missing `getPublicKey` CSRF nonce in BRC-100

### LOW
- **BUG-9**: LocksContext state inconsistency window
- **BUG-10**: `toggleTheme` callback recreation
- **BUG-11**: Unhandled promise in auto-sync

---

## Phase 3: Architecture (8/10)

- **ARCH-1**: Mixed error pattern (Result vs ad-hoc) — Medium
- **ARCH-2**: No offline broadcast queue — Medium
- **ARCH-3**: WalletApp god component (~460 lines) — Medium
- **ARCH-4**: No Error Boundary around AppProviders — Low
- **ARCH-5**: Logger cross-cutting violation — Low
- **ARCH-6**: No runtime feature flag toggle — Low

---

## Phase 4: Code Quality (7/10)

- **QUAL-1**: Zero `React.memo` across 51 components — Medium
- **QUAL-2**: Full tx history re-fetch on every sync — Medium
- **QUAL-3**: `wocClient.getBalance` returns 0 on error — Medium
- **QUAL-4**: ~151 `any` types — Medium
- **QUAL-7**: No tests for 9 context providers — Medium
- **QUAL-8**: No tests for critical hooks — Medium
- **QUAL-10**: Dead `useNetworkStatus` hook — Low

---

## Remediation Priority

1. SEC-1: Fix BRC-100 coin selection (medium refactor)
2. SEC-2: Restrict filesystem permissions (quick fix)
3. SEC-3+SEC-4: Validate BRC-100 outputs (quick fix)
4. BUG-1: Fix session password order (quick fix)
5. BUG-2+BUG-11: Add .catch() handlers (quick fix)
6. SEC-5: Migrate WIF bridge to Rust (major change)
7. BUG-3: Add isCancelled() guards (quick fix)
8. BUG-5: Fix fetchVersionRef race (quick fix)
9. BUG-4: Consolidate LockedUTXO types (quick fix)
10. QUAL-1: Add React.memo to key components (medium)
