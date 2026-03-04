# Simply Sats — Full Review v26
**Date:** 2026-03-04
**Rating:** 8.5 / 10
**Tests:** 1891 passing | **Lint:** 0 errors (53 warnings) | **Typecheck:** clean

## Baseline
- `npm run lint`: 0 errors, 53 warnings (all `no-restricted-imports` + `react-refresh`)
- `npm run typecheck`: clean
- `npm run test:run`: 1891/1891 pass (81 test files)

## Phase 1: Security Audit

### New Issues (6: 1 Medium, 5 Low)

**S-115 (Medium) — identityKey type mismatch between listener and handler**
- `brc100/listener.ts:96` validated `identityKey` as `string`, while `handlers.ts:99` validated as `boolean`
- A truthy string like `"false"` would bypass the identity key disclosure gate
- **Fixed in v26:** Changed listener validation to `'boolean'`

**S-116 (Low) — encrypt/decrypt auto-approve bypass**
- `brc100/validation.ts:148-161`: encrypt/decrypt fell through to default (auto-approve) case
- A trusted app with autoApprove could silently decrypt user ciphertexts
- **Fixed in v26:** Added encrypt/decrypt to explicit approval block

**S-117 (Low) — Zero-sat output inconsistency**
- JS-side rejects `satoshis < 1` but Rust `build_custom_output_tx` allows zero-sat outputs
- Mitigated: JS validation runs first in all current paths

**S-118 (Low) — get_mnemonic_once IPC boundary exposure**
- Mnemonic passes through serde/IPC/V8 creating multiple unzeroized copies
- Inherent to IPC design; `useMnemonicAutoClear` provides best available mitigation

**S-119 (Low) — BRC-100 createLockTransaction uses P2PKH not CLTV**
- Locks created through BRC-100 `createAction` path are "soft locks" (DB-only)
- Native `lockBSV` path correctly uses `build_lock_tx_from_store` (on-chain CLTV)

**S-120 (Low) — check_address_balance path injection**
- `lib.rs:558` interpolates unvalidated address into WoC URL
- Limited impact: host is fixed, only path traversal possible

### Positive Observations
- Key isolation architecture strong (WIFs in Rust for all major ops)
- CSRF nonce system well-implemented with HMAC binding
- Rate limiter tamper-resistant with per-installation HMAC key
- Session token rotation with TOCTOU protection
- DNS rebinding protection via Host header validation

## Phase 2: Bug Detection

### New Issues (8: 3 Medium, 5 Low)

**B-99 (Medium) — autoLock resume silently fails after stop**
- `resumeAutoLock` early-returns if `state.isEnabled` is false (set by `stopAutoLock`)
- Duplicated interval logic between init and resume is maintenance hazard
- Not currently exploitable (pause/resume not used in production)

**B-100 (Medium) — Stale networkInfo in LocksContext**
- `handleLock`/`handleUnlock` closed over `networkInfo` from render time
- If networkInfo was null when callback was captured, unlock fails even after block height loads
- **Fixed in v26:** Added `networkInfoRef` pattern, removed `networkInfo` from dependency arrays

**B-101 (Medium) — Doubled API calls for inactive accounts**
- `syncInactiveAccountsBackground` syncs then clears sync times → next account switch re-syncs
- Wastes bandwidth, risks WoC rate limiting with many accounts

**B-102 (Low) — Stale activeAccount in unlockWallet** — mitigated by DB fallback
**B-103 (Low) — Stale wallet in deleteAccount** — low risk concurrent race
**B-104 (Low) — Stale selectedOrdinal after modal close**
- **Fixed in v26:** Added `clearSelectedOrdinal` to OrdinalSelectionContext
**B-105 (Low) — autoLock isPaused ordering** — **Fixed in v26**
**B-106 (Low) — knownUnlockedLocks passed by snapshot** — brief lock reappearance race

## Phase 3: Architecture Review

### New Issues (8: 4 Medium, 4 Low)

**A-55 (Medium) — 37 raw SQL calls bypass repository layer**
- `accounts.ts` (14), `tokens/state.ts` (11), `certificates.ts` (8), `orchestration.ts` (4)
- Dual data-access paths make schema changes risky

**A-56 (Medium) — Legacy WoC methods hide API failures**
- 37 call sites use legacy methods returning 0/[]/null on failure
- `getBalance()` returning 0 indistinguishable from zero balance vs API down

**A-57 (Low) — 3 providers lack ErrorBoundary**
- **Fixed in v26:** Wrapped OrdinalSelection, WalletSetup, LockWorkflow providers

**A-58 (Medium) — certificates.ts uses runtime DDL**
- `ensureCertificatesTable()` runs `CREATE TABLE IF NOT EXISTS` on every operation
- Bypasses migration system, makes future schema changes problematic

**A-59 (Low) — tokens/state.ts fat service (374 lines)**
**A-60 (Medium) — WalletContext God context (527 lines, 22-dep useMemo)**
**A-61 (Medium) — Phantom lock cleanup without transaction**
- 4 DELETEs across 4 tables not wrapped in `withTransaction()`
**A-62 (Low) — Inconsistent throw vs Result error handling**
- 133 `throw` sites vs 220 `return err()` sites across non-test files

### Architecture Strengths
- Clean dependency direction (domain → infra → services → contexts → components)
- ErrorBoundary-per-provider pattern
- State/Actions context split reduces re-renders
- PlatformAdapter abstraction for Tauri/Chrome/browser
- Cancellation token pattern in sync system

## Phase 4: Code Quality

### New Issues (13: 7 Medium, 6 Low)

**Q-85 (Medium) — Duplicated formatAmount/formatBalance**
**Q-86 (Medium) — 100+ `error instanceof Error` patterns** despite `toErrorMessage()` utility
**Q-87 (Low) — Repeated settings-row interactive div pattern** (20+ occurrences)
**Q-88 (Low) — Non-null assertions after .split()** — **Fixed in v26**
**Q-89 (Low) — as any for Chrome detection**
**Q-90 (Medium) — TokenCard role=button without onClick** — **Fixed in v26**
**Q-91 (Low) — useState(new Set()) without lazy initializer**
**Q-92 (Medium) — 6 critical files at 0-3% test coverage**
**Q-93 (Medium) — Missing Space key on role=button** — **Fixed in v26** across 5 files
**Q-94 (Low) — Token icon img missing onError fallback**
**Q-95 (Medium) — 22 silent catch blocks without logging**
**Q-96 (Medium) — Known senders mutable array** — **Fixed in v26** (migrated to Set)

## Phase 0: Open Issue Verification

| Issue | Previous Status | Current Status |
|-------|----------------|----------------|
| Q-66 | Open-Low | **Fixed** (duplication removed) |
| A-49 | Open-Medium (27 files) | **Partially fixed** (8 files remain) |
| A-53 | Open-Low | **Partially fixed** (txRepo has LIMIT) |
| Q-72 | Open-Medium (5 modules) | **Partially fixed** (1/5 has tests) |
| A-50 | Open-Medium (circular) | Reclassified: one-way sync→wallet (minor) |
| All others | Open | Still open |

## v26 Remediation Summary

**13 issues fixed:**
- S-115, S-116 (security)
- B-100, B-104, B-105 (bugs)
- A-57 (architecture)
- Q-66, Q-67, Q-88, Q-90, Q-93, Q-96 (quality)

**Verification:** 1891 tests pass, typecheck clean, 0 lint errors.

**Files modified:**
- `src/services/brc100/listener.ts` (S-115)
- `src/services/brc100/validation.ts` (S-116)
- `src/contexts/LocksContext.tsx` (B-100)
- `src/contexts/OrdinalSelectionContext.tsx` (B-104)
- `src/contexts/ModalContext.tsx` (B-104)
- `src/services/autoLock.ts` (B-105)
- `src/AppProviders.tsx` (A-57)
- `src/components/modals/LockModal.tsx` (Q-67)
- `src/components/modals/QRScannerModal.tsx` (Q-88)
- `src/components/tabs/TokensTab.tsx` (Q-90)
- `src/components/wallet/BalanceDisplay.tsx` (Q-93)
- `src/components/tabs/ActivityTab.tsx` (Q-93)
- `src/components/tabs/LocksTab.tsx` (Q-93)
- `src/components/tabs/SearchTab.tsx` (Q-93)
- `src/components/modals/OrdinalModal.tsx` (Q-93)
- `src/services/keyDerivation.ts` (Q-96)
