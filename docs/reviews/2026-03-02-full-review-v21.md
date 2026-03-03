# Simply Sats — Full Review Report v21
**Date:** 2026-03-02
**Review:** #21 — Full Codebase Review
**Rating:** 8.5 / 10
**Pre-checks:** Typecheck clean | Lint 0 errors (55 warnings) | 1762 tests pass (73 suites)
**New issues:** 37 (1 Critical, 8 High, 15 Medium, 13 Low)

---

## Executive Summary

Review #21 is a comprehensive 4-phase audit covering the full Simply Sats codebase after all 319 prior issues were resolved. The codebase is in excellent shape — strong security posture, comprehensive test coverage, and clean toolchain output. The most significant finding is a critical identity key exposure in the BRC-100 `getTaggedKeys` handler (S-84) where the identity WIF enters JavaScript despite a Rust key store command existing that keeps it server-side. Combined with auto-approval for trusted origins (S-86), this creates a realistic attack vector via XSS.

The 37 new findings break down as: 12 security (key management and sync coordination), 5 bugs (concurrency and validation), 7 architecture (layer violations and duplication), and 13 quality (DRY, accessibility, test coverage). Estimated total remediation: ~6 hours, with the critical and high items completable in ~2 hours.

---

## Phase 1: Security Audit

### Scope
Authentication flows, key management, BRC-100 request handling, input validation, cryptographic practices, auto-lock timing, SDK security, and Rust-side key store operations. ~35 files analyzed across `services/brc100/`, `services/`, `infrastructure/`, `sdk/`, and `src-tauri/src/`.

### Critical Finding

**S-84: Identity WIF exposed to JavaScript heap via `getTaggedKeys`**

The `getTaggedKeys` handler in `brc100/handlers.ts:501` calls `getWifForOperation('identity', 'getTaggedKeys', keys)` to pull the identity WIF into JavaScript, then passes it to `deriveTaggedKey(identityWif, tag)`. This defeats the entire Rust key store architecture for the most sensitive key. A `derive_tagged_key_from_store` Rust command already exists at `key_store.rs:569` but isn't being used.

The severity is elevated because `getTaggedKeys` falls through to the `default` auto-approve path in `validation.ts:147` — any connected app with `autoApprove=true` triggers this silently. This means any XSS vulnerability would allow an attacker to obtain the identity WIF without user interaction.

**Fix:** Replace `getWifForOperation` + `deriveTaggedKey` with `deriveTaggedKeyFromStore('identity', tag)`. ~15 minutes.

### High Findings

**S-85: Lock/action builders pass WIF via non-`_from_store` commands**

Both `createLockTransaction` (locks.ts:84-86) and `buildAndBroadcastAction` (formatting.ts:43-46) retrieve the wallet WIF into JS via `getWifForOperation`, then pass it back to Rust via `tauriInvoke('build_p2pkh_tx', { wif })`. The `build_p2pkh_tx_from_store` variant at `key_store.rs:339` exists specifically to avoid this round-trip. The wallet WIF sits in the JS heap for the duration of the transaction build.

**S-86: `getTaggedKeys` auto-approved without user consent**

Tagged keys are deterministic sub-identities derived from the identity key. Currently falls through to the `default` case in `handleBRC100Request`, which auto-approves when `autoApprove=true`. A compromised trusted-origin app could silently derive unlimited tagged keypairs. Should be added to the explicit approval-required list alongside `createAction`/`lockBSV`/`unlockBSV`.

**S-87: BRC-100 lock/action creation lacks sync lock**

Unlike `sendBSV`/`sendBSVMultiKey` in `transactions.ts` which acquire `acquireSyncLock(accountId)` before UTXO operations, `createLockTransaction` and `buildAndBroadcastAction` operate without sync lock protection. A concurrent background sync could modify the UTXO set mid-transaction, causing broadcast failure or inconsistent local state.

### Medium Findings

**S-88:** Session password stored as JS string (immutable, not zeroizable). Store as `Uint8Array` instead.

**S-89:** `resumeAutoLock` uses stale 15-second interval instead of the 5-second interval fixed in `initAutoLock`. 10-second physical-access window after modal close.

**S-90:** `isLegacyEncrypted` does full `JSON.parse()` on untrusted data. Add fast early-exit before parse.

**S-91:** SDK `encrypt`/`decrypt` passes CSRF nonce in request body instead of header. Server ignores body nonce.

### Low Findings

**S-92:** `inflightUnlocks` map unbounded — cap at 100 entries.
**S-93:** `formatLockoutTime` double-ceiling — 61s shows as "2 minutes".
**S-94:** `loadKnownSenders` bypasses `MAX_KNOWN_SENDERS` cap on load from localStorage.
**S-95:** `store_keys` IPC mnemonic parameter not wrapped in `Zeroizing` immediately.

---

## Phase 2: Bug Detection

### Scope
State management, race conditions, edge cases, data flow, React hooks ordering, async/await handling. Analyzed all contexts, hooks, services, and key components.

### High Finding

**B-80: Token send acquires sync lock for wrong account**

`sendTokenAction` in `TokensContext.tsx:89` calls `acquireSyncLock()` with no arguments. The default parameter is `accountId: number = 1`, so this always locks account 1's mutex. On account 2+, the token send and background sync hold different mutexes, allowing concurrent UTXO access. Every other call site (`transactions.ts`, `ordinals.ts`, `orchestration.ts`) correctly passes `accountId`.

**Trigger:** Send a BSV-20 token from account 2+ while a background sync is running.
**Fix:** Thread `accountId` through from `useWalletSend.handleSendToken`.

### Medium Findings

**B-81: Multi-send allows 0-sat output**

In `handleMultiSubmitClick`, validation uses separate `continue` statements for missing address and missing amount. A recipient with a valid address but empty amount passes both loops. `executeSendMulti` then converts empty string to `parseFloat('0')` = 0 satoshis.

**B-82: Post-discovery sync ignores cancellation**

After account discovery, the background sync loop (App.tsx:415-434) has no cancellation checks. Unlike the inactive-accounts loop which checks `if (cancelled) break`, the post-discovery loop continues syncing all accounts even after the user switches accounts.

**B-83: Lock dedup guard blocks after clock skew**

The dedup guard in `LocksContext.tsx:124-134` computes `(now - l.createdAt) < DEDUP_WINDOW_MS`. If `createdAt` is in the future (from NTP resync after laptop sleep), the difference is negative, which is always less than 30,000ms. This permanently blocks identical locks until the clock catches up.

### Low Finding

**B-84:** Queued recursive `switchAccount` uses stale `accounts` closure. Mitigated by DB lookup in `accountsSwitchAccount`. Track for future refactor.

---

## Phase 3: Architecture Review

### Scope
Code organization, module coupling, layer violations, adherence to established patterns, scalability.

### High Findings

**A-40: Duplicate type definitions across layers**

`WalletKeys`, `UTXO`, `LockedUTXO`, `Ordinal`, and `TokenBalance` are defined independently in both `domain/types.ts` and `services/wallet/types.ts`. The definitions have diverged over time. The domain layer should be the single source of truth, with services importing from domain.

**A-41: RestoreModal contains 140+ lines of business logic**

`RestoreModal.tsx` is 502 lines with `handleRestoreFromFullBackup` containing 140+ lines of business logic and imports from 7 service modules. This is the worst layer violation in the codebase — business logic should be in a `services/restore.ts` module.

### Medium Findings

**A-42:** `App.tsx` has 12 `useRef` calls working around stale closures. The `checkSync` function alone is 230 lines. High coupling via refs suggests the component needs decomposition.

**A-43:** Contexts import types from `services/` instead of `domain/` — violates the dependency direction principle where outer layers should depend on inner layers.

**A-44:** `ModalContext.tsx` mixes UI visibility state (modal open/close) with domain state (mnemonic, ordinal selection, unlock workflow state).

### Low Findings

**A-45:** Settings components reach 3+ levels deep into the service layer, bypassing context abstractions.
**A-46:** `adapters/walletAdapter.ts` is a vestigial passthrough — only used by SendModal.tsx with no added value.

---

## Phase 4: Code Quality

### Scope
DRY violations, error handling, TypeScript best practices, performance, test coverage, accessibility.

### High Findings

**Q-63: Duplicate `base58Decode` implementations**

`base58Decode` and `BASE58_CHARS` are independently implemented in both `domain/wallet/validation.ts` and `domain/transaction/builder.ts`. Extract to a shared `domain/utils/base58.ts` module.

**Q-64: Amount parsing duplicated 4x in SendModal**

The pattern `Math.round(parseFloat(value) * 100_000_000)` appears 4 times in SendModal.tsx at lines 73-76, 85-88, 201-206, and 271-276. Extract to `parseAmountToSatoshis()` helper.

### Medium Findings

**Q-65:** No-op ternary `protocol === 'bsv21' ? ticker : ticker` at transfers.ts:197-198.
**Q-66:** Missing `aria-describedby` on multi-recipient address/amount inputs.
**Q-67:** Missing `aria-selected` on AddressPicker `role="option"` elements.
**Q-68:** No test files for QRScannerModal, AddressPicker, FeeEstimation.
**Q-69:** No tests for `sendToken`/`transferToken` in transfers.ts.

### Low Findings

**Q-70:** `deleteAddress`/`updateAddressLabel` in addressBookRepository lack `accountId` scoping.
**Q-71:** ~25 residual inline styles in SendModal after v20 extraction.
**Q-72:** Unnecessary `useCallback` wrapper with no consumer memoization benefit.
**Q-73:** ConfirmationModal imports directly from services layer.
**Q-74:** FeeEstimation fires `onFeeRateChange` on mount via useEffect.
**Q-75:** `isValidSatoshiAmount` uses inconsistent underscore formatting in max supply constant.

---

## Overall Assessment

| Metric | Value |
|--------|-------|
| **Health Rating** | 8.5 / 10 |
| **Pre-existing issues** | 319 (all resolved) |
| **New issues** | 37 |
| **Critical** | 1 (S-84: identity key exposure) |
| **High** | 8 (3 security, 1 bug, 2 architecture, 2 quality) |
| **Medium** | 15 |
| **Low** | 13 |
| **Tests** | 1762 passing (73 suites) |
| **TypeScript** | Clean (0 errors) |
| **ESLint** | 0 errors, 55 warnings (all `no-restricted-imports`) |

### Strengths
- All 319 prior issues resolved — exceptional remediation discipline
- Comprehensive test suite (1762 tests, 73 suites)
- Clean toolchain output (typecheck + lint)
- Rust key store architecture well-designed (issues are in JS callers not using it correctly)
- Consistent use of sync locks in core send paths

### Key Concerns
- **Identity key exposure** (S-84 + S-86) is the highest-priority fix
- **Sync lock gaps** in BRC-100 and token paths (S-87, B-80) could cause UTXO double-spend
- **WIF round-trip** pattern (S-85) partially defeats Rust key store benefit
- **Type duplication** (A-40) creates maintenance burden and divergence risk

### Estimated Remediation
- **Immediate (critical/high):** ~2 hours
- **Medium priority:** ~2.5 hours
- **Low priority:** ~1.5 hours
- **Total:** ~6 hours
