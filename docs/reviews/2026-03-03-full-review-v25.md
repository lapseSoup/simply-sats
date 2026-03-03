# Simply Sats — Full Code Review v25

**Date:** 2026-03-03
**Reviewer:** Claude Code (Review #25)
**Rating:** 8.0 / 10
**Baseline:** 0 lint errors, 53 lint warnings, typecheck clean, 1803/1803 tests passing
**Scope:** Full 4-phase codebase review (Security, Bugs, Architecture, Quality)

---

## Phase 1: Security Audit

9 new findings (2 High, 5 Medium, 2 Low). The most impactful are S-106 (createAction ignores custom locking scripts) and S-107 (DevTools enabled in production).

### S-106 | High | `formatting.ts:115-126` — createAction ignores custom locking scripts

`buildAndBroadcastAction` receives `CreateActionRequest` outputs with custom `lockingScript` values but passes `toAddress: fromAddress` to the Rust `build_p2pkh_tx_from_store` command. The Rust function creates a single P2PKH output to the sender's own address — it never uses the caller-specified locking scripts. Every createAction transaction sends funds back to self rather than to the BRC-100 app's intended outputs. The DB records track phantom outputs at vout indices that don't exist in the broadcast transaction.

### S-107 | High | `Cargo.toml:56` + `tauri.conf.json:22` — DevTools enabled in production

`default = ["devtools"]` in Cargo.toml and `"devtools": true` in tauri.conf.json enable Chromium DevTools in release builds. An attacker with local access can inspect the JS heap, call `tauriInvoke('get_wif_for_operation', ...)`, manipulate DOM state to bypass approval modals, and read localStorage.

### S-108 | Medium | `rate_limiter.rs:166` — Non-constant-time HMAC comparison

Rate limit state HMAC comparison uses `String::eq` (early-return on mismatch) instead of `subtle::ConstantTimeEq` (which is already in Cargo.toml). A local attacker could theoretically forge rate limit state to bypass unlock throttling.

### S-109 | Medium | `formatting.ts:73` — Zero-satoshi outputs allowed in createAction

Validation checks `satoshis < 0` but permits `satoshis: 0`. Zero-value P2PKH outputs are unspendable and pollute the UTXO set.

### S-110 | Medium | `builder.ts:486-504` — Malformed addresses silently zero-padded

`p2pkhLockingScriptHex` has a fallback that zero-pads decoded addresses shorter than 21 bytes, creating locking scripts to unspendable addresses. Funds would be burned.

### S-111 | Medium | `key_store.rs:114,136` — Mnemonic cloned outside Zeroizing wrapper

`(*mnemonic).clone()` creates plain String copies that bypass `Zeroizing` memory protection. The mnemonic persists in freed heap memory until overwritten.

### S-112 | Medium | `useWalletLock.ts:66-68` — Auto-lock timeout not validated against bounds

No validation against `MAX_AUTO_LOCK_MINUTES`. localStorage manipulation can set timeout to 0 (disabling auto-lock) or extremely large values.

### S-113 | Low | `key_store.rs:143-178` — store_keys_direct accepts unvalidated WIFs

The Tauri command accepts WIF strings from the frontend without verifying they match the provided addresses/public keys.

### S-114 | Low | `secureStorage.ts:21-23` — SENSITIVE_KEYS set is empty, encryption is dead code

The session-key encryption infrastructure never executes because no keys are in the set.

---

## Phase 2: Bug Detection

6 new findings (1 High, 3 Medium, 2 Low).

### B-93 | High | `useWalletLock.ts:68` — NaN auto-lock minutes disables auto-lock

If localStorage `auto_lock_minutes` contains a non-numeric string (e.g., `"abc"`), `parseInt` returns NaN. Since `NaN > 0` is false, `initAutoLock` is never called. The wallet silently stops auto-locking.

### B-94 | Medium | `transactions.ts:300,314` — getAllSpendableUTXOs ignores accountId

The `accountId` parameter is never passed to `getSpendableUtxosFromDatabase()` for default or derived basket queries. Returns UTXOs from ALL accounts. Currently unused in production paths but is a public API.

### B-95 | Medium | `useSyncData.ts:177` — NaN ordBalance from corrupted localStorage

`Number(cachedOrdBal)` without `Number.isFinite()` guard. Corrupted cache value causes "NaN BSV" display. The API path has the guard but the DB path does not.

### B-96 | Medium | `App.tsx:348` — Background sync runs after wallet lock

Background sync captures `sessionPwd` at line 348, waits 10 seconds, then syncs. If the user locks the wallet during the delay, the sync continues with decrypted keys after the wallet is "locked."

### B-97 | Low | `SettingsSecurity.tsx:241` — parseInt without radix in select handler

`parseInt(e.target.value)` missing radix parameter. Low practical risk since the select has hardcoded numeric options.

### B-98 | Low | `RequestManager.ts:36` — Cleanup interval leaks on re-instantiation

No protection against multiple instances. HMR during development creates orphaned intervals.

---

## Phase 3: Architecture Review

6 new findings (0 High, 4 Medium, 2 Low).

### A-49 | Medium | 27 files bypass PlatformAdapter

`@tauri-apps/*` imports appear in 27 non-test files across components, hooks, contexts, and services — completely bypassing the `src/platform/` abstraction layer. This blocks Chrome extension parity.

### A-50 | Medium | 4 circular dependency chains between sync/ and wallet/

`lockCreation.ts` and `transactions.ts` import from `services/sync`, while `historySync.ts` imports from `services/wallet/locks`. Creates bidirectional runtime dependencies.

### A-51 | Medium | WalletStateContext bundles 25 fields

`WalletStateContextType` exposes 25 fields in a single context. Any change to any field re-renders all consumers. Components that only need `activeAccountId` re-render on every balance/UTXO/history update.

### A-54 | Medium | contentCacheSnapshot full Map copy on every bump

`new Map(contentCacheRef.current)` creates a full shallow copy on every `cacheVersion` increment. With 600+ ordinals, this causes GC pressure during sync.

### A-52 | Low | 11 components query infrastructure/database directly

Components import directly from `infrastructure/database` and `infrastructure/api`, bypassing the service layer.

### A-53 | Low | Unbounded getAllTransactions/getAllUTXOs queries

No pagination or LIMIT clause on "getAll" queries. Memory grows linearly with wallet age.

---

## Phase 4: Code Quality

13 new findings (0 High, 5 Medium, 8 Low).

### Medium Priority
- **Q-65**: Duplicated `formatTimeRemaining` in LocksTab and LockDetailModal
- **Q-68**: 11 sequential try/catch blocks in `clearDatabase()`
- **Q-69**: Missing ARIA attributes on OrdinalTransferModal form inputs
- **Q-71**: Silent error swallowing in SignMessageModal verify
- **Q-72**: 5 service modules with zero test coverage (ordinalContent, ordinalCacheManager, lockReconciliation, backupReminder, messageBox)
- **Q-73**: `accountId || undefined` converts 0 to undefined in lockReconciliation
- **Q-77**: `accountId ?? 1` default in 18+ repos without validation warning

### Low Priority
- **Q-66**: Duplicated formatBytes/formatCacheSize
- **Q-67**: Duplicated time-estimation logic between LockModal and LocksTab
- **Q-70**: Missing aria-describedby on LockModal block input
- **Q-74**: LockModal hook-after-conditional-return pattern (borderline, not a violation)
- **Q-75**: 22 `as any` casts in useOrdinalCache.test.ts for bumpCacheVersion mock
- **Q-76**: Inline styles scattered across modals

---

## Prioritized Remediation — Review #25

### Immediate (before next release)
1. **S-107** `Cargo.toml` + `tauri.conf.json` — Disable DevTools in production. **Effort: quick**
2. **B-93** `useWalletLock.ts` — Add `Number.isFinite()` guard for auto-lock minutes. **Effort: quick**
3. **B-96** `App.tsx` — Re-check session password after 10s delay. **Effort: quick**
4. **S-112** `useWalletLock.ts` — Clamp auto-lock timeout to [1, MAX_AUTO_LOCK_MINUTES]. **Effort: quick**

### High Priority (next sprint)
5. **S-106** `formatting.ts` — Implement custom output support in createAction or document limitation. **Effort: major** (requires new Rust command)
6. **S-108** `rate_limiter.rs` — Use `subtle::ConstantTimeEq` for HMAC comparison. **Effort: quick**
7. **S-109** `formatting.ts` — Reject zero-satoshi non-OP_RETURN outputs. **Effort: quick**
8. **S-110** `builder.ts` — Remove zero-padding fallback, throw on short addresses. **Effort: quick**
9. **S-111** `key_store.rs` — Wrap mnemonic clones in Zeroizing. **Effort: medium**
10. **B-94** `transactions.ts` — Pass accountId to getSpendableUtxosFromDatabase. **Effort: quick**
11. **B-95** `useSyncData.ts` — Add Number.isFinite guard on cached ord balance. **Effort: quick**

### Medium Priority (sprint after)
12. **A-49** — Route Tauri imports through PlatformAdapter. **Effort: major**
13. **A-50** — Break circular dependencies between sync/ and wallet/. **Effort: medium**
14. **A-51** — Split WalletStateContext into focused contexts. **Effort: major**
15. **A-54** — Replace Map copy with lazy snapshot or useSyncExternalStore. **Effort: medium**
16. **Q-65** — Extract shared formatTimeRemaining utility. **Effort: quick**
17. **Q-68** — Refactor clearDatabase sequential try/catch. **Effort: quick**
18. **Q-69** — Add ARIA attributes to OrdinalTransferModal. **Effort: quick**
19. **Q-71** — Fix silent error in SignMessageModal verify. **Effort: quick**
20. **Q-72** — Add tests for 5 untested service modules. **Effort: medium**
21. **Q-73** — Fix `||` to `??` in lockReconciliation. **Effort: quick**
22. **Q-77** — Add debug warnings for implicit accountId defaults. **Effort: quick**

### Low Priority
23-34. S-113, S-114, B-97, B-98, A-52, A-53, Q-66, Q-67, Q-70, Q-74, Q-75, Q-76
