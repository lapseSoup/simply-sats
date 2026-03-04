# Simply Sats — Full Review v26

**Date:** 2026-03-03
**Reviewer:** Claude Opus 4.6 (automated)
**Rating:** 6.5 / 10
**Tests:** 1807 passing (79 test files), 0 failures
**Lint:** 0 errors, 53 warnings (all `no-restricted-imports` + minor HMR)
**Typecheck:** Clean

---

## Executive Summary

This review found **54 new issues** including 3 critical security findings that significantly downgrade the overall rating from v25's 8.4 to 6.5. The critical finding: the Rust key store security architecture is undermined by legacy code paths that still expose private keys to JavaScript. Together, S-115 (legacy direct-WIF commands), S-116 (`get_wif_for_operation` bridge), and S-117 (`withGlobalTauri: true`) mean any XSS vulnerability in the webview provides full access to wallet private keys, defeating the purpose of the Rust key store migration.

Beyond the critical security issues, the review identified high-severity bugs (double-counting unlock attempts locks users out after 3 tries; inscription feature broken due to empty WIF), significant architecture concerns (782-line App.tsx orchestrator, context re-render cascades), and quality improvements needed (60+ instances of duplicated error handling pattern, missing test coverage for critical modules).

**Positive findings:** 1807 tests passing with zero failures is excellent. Error boundary coverage is thorough. The WalletContext state/actions split is well-designed. Cancellation and stale-data guards show strong defensive programming. The codebase has clearly improved significantly across 25 prior review cycles.

---

## Phase 1: Security Audit

### Critical Issues (3)

**S-115: Legacy Direct-WIF Tauri Commands Still Registered AND Called**
The `_from_store` Rust key store pattern was introduced to keep private keys out of the JS heap. However, 9 legacy commands that accept raw WIFs remain registered in `lib.rs` lines 742-751, and **8 active call sites** pass WIFs from JavaScript:
- `backupRecovery.ts:444` — `build_multi_key_p2pkh_tx`
- `tokens/transfers.ts:121` — `build_token_transfer_tx`
- `wallet/ordinals.ts:287` — `build_ordinal_transfer_tx`
- `wallet/inscribe.ts:48` — `build_inscription_tx`
- `SignMessageModal.tsx:25` — `sign_message`
- `certificates.ts:328` — `sign_message`
- `messageBox.ts:106` — `sign_data`

**S-116: `get_wif_for_operation` Returns Raw WIF to JavaScript**
At `key_store.rs:621-635`, this command returns a raw WIF string. The `operation` parameter is free-text for audit logging only — no access control. Any code in the webview can extract wallet/ord/identity WIFs.

**S-117: `withGlobalTauri: true` in Production**
At `tauri.conf.json:13`, this setting places `__TAURI_INTERNALS__` on the global scope, making every registered command callable without imports. This amplifies S-115/S-116: any script injection can immediately call `get_wif_for_operation` to extract keys.

### High Issues (5)

**S-118:** `check_address_balance` SSRF — address parameter interpolated into URL without validation (`lib.rs:558-562`).

**S-119:** `KeyStoreInner` uses `Option<String>` instead of `Option<Zeroizing<String>>` — `.clone()` creates unzeroized copies that persist in freed heap memory (`key_store.rs:21-28`).

**S-120:** Mnemonic cloned out of `Zeroizing` wrapper via `(*mnemonic).clone()` at lines 114, 116, 136 — creates plain String copies. Supersedes S-111.

**S-121:** `fee_rate: f64` unbounded in all Rust transaction builders. `NaN` becomes 0 via `as u64`, creating zero-fee transactions. Extremely large values drain wallet to miners.

**S-122:** Deep link `action` handler passes attacker-controlled `description` to approval UI. User sees misleading text while actual outputs may specify different amounts/destinations.

### Medium Issues (5)

S-123 (timestamp leak in request IDs), S-124 (store_keys_direct no address-WIF consistency check), S-125 (identityKey type check inconsistency between listener and handler), S-126 (100-sat change threshold silently donates to miners), S-127 (SENSITIVE_KEYS empty — no localStorage encryption).

### Low Issues (3)

S-128 (isLegacyEncrypted parses controlled data — mitigated by length limit), S-129 (deep link sign accepts empty data), S-130 (tauri_plugin_fs no explicit scope).

---

## Phase 2: Bug Detection

### High Issues (2)

**B-99: Double-Counting Failed Unlock Attempts**
When the user enters a wrong password, `recordFailedUnlockAttempt()` is called twice: once in `useWalletLock.ts:234` and again in `LockScreenModal.tsx:89`. Each wrong password consumes 2 of 5 allowed attempts. Users get locked out after 3 wrong passwords instead of 5. Fix: remove one of the two calls.

**B-100: InscribeModal Passes Empty WIF**
`InscribeModal.tsx:80` passes `wallet.walletWif` to `buildInscriptionTx`, but in the Rust key store architecture, `walletWif` is an empty string in React state. The inscription feature is broken — empty WIF produces invalid transactions.

### Medium Issues (5)

**B-101:** ConnectedAppsContext stale closure in `addTrustedOrigin`/`connectApp` — rapid sequential calls close over old state, second call overwrites first.

**B-102:** `AccountsContext.tsx:80` uses `active.id || null` (falsy check) instead of `active.id ?? null` — treats `id === 0` as no active account.

**B-103:** Fee estimation (`fees.ts:237-245`) uses unsorted coin selection while actual transaction (`coinSelection.ts:86`) sorts smallest-first — different UTXOs selected, different fee than displayed.

**B-104:** User-edited fee rate in SendModal not passed to transaction builder — `sendBSVMultiKey` reads from localStorage, not modal state.

**B-105:** Token send uses `activeAccountId ?? 1` for sync lock — acquires lock for wrong account during context refresh lag.

### Low Issues (3)

B-106 (dust threshold divergence between JS and Rust), B-107 (pauseAutoLock stale callback risk), B-108 (falsy activeAccountId check in ordinal transfer).

---

## Phase 3: Architecture Review

### High Issues (3)

**A-55: Pervasive Layer Violations**
40+ component files import directly from `services/` and `infrastructure/` layers — not just types, but runtime functions. Components call database repositories, API clients, and service methods directly, bypassing the context/hook abstraction layer.

**A-56: UIContext Toast Re-Render Cascade**
The `toasts` array is in the `useMemo` dependency array at `UIContext.tsx:163`. Every toast notification recreates the entire context value, causing all 32 `useUI()` consumers to re-render — including SendModal, ReceiveModal, and ActivityTab.

**A-57: App.tsx Monolith**
782 lines with 14 `useRef` calls (stale-closure workarounds) and 17 `useEffect` hooks. The `checkSync` function alone spans 230 lines with nested async IIFEs. The file acknowledges this at line 31: `// TODO(A-42): This component has 12 useRefs`.

### Medium Issues (4)

A-58 (ModalContext holds domain state including BIP-39 mnemonic), A-59 (NetworkContext recreates on every sync toggle), A-60 (getAllTransactions unbounded query), A-61 (getUnlockableLocks called during render creates unstable prop).

### Low Issues (4)

A-62 (O(n) array includes for origin lookups), A-63 (PlatformAdapter never consumed), A-64 (two usePlatform naming collision), A-65 (7,257-line CSS monolith).

---

## Phase 4: Code Quality

### High Issues (3)

**Q-95:** `getBalanceFromDB` returns `Promise<number>` but `validation.ts:86-103` checks `.ok` as if it's a Result — fallback balance never works.

**Q-96:** `storage.ts:123` uses `as unknown as EncryptedData` unsafe double-cast through `unknown`.

**Q-97:** `TokensTab.tsx:113` uses weak regex for BSV address validation instead of `isValidBSVAddress()` — doesn't verify Base58Check checksum.

### Medium Issues (9)

Q-98 (duplicated 26-line auto-lock interval callback), Q-99 (60+ instances of `error instanceof Error ? error.message : String(error)`), Q-100 (`as string` cast on unvalidated API response), Q-101 (response.json data accessed without type validation), Q-102 (TokensTab send form missing aria-describedby), Q-103 (messageBox.ts and restore.ts zero test coverage), Q-104 (console.warn instead of structured logger).

### Low Issues (5)

Q-105 (ordLogger alias adds no value), Q-106 (dead backup-reminder code in App.tsx), Q-107 (keysFromWif pass-through wrapper), Q-108 (infrastructure barrel export commented out), Q-109 (AccountSwitcher ARIA listbox pattern violation).

---

## Phase 0: Status Update on Previously Open Issues

| ID | Previous Status | Current Status | Notes |
|----|-----------------|----------------|-------|
| S-111 | Open-Medium | Open-Medium | Superseded by broader S-120 (High) |
| A-49 | Open-Medium | Open-Medium | Now 33 files (was 27) |
| A-50 | Open-Medium | Open-Medium | Unchanged |
| A-51 | Open-Medium | Open-Medium | Confirmed 25 fields |
| A-54 | Open-Medium | Open-Medium | Confirmed at WalletContext.tsx:448 |
| Q-68 | Open-Medium | Open-Medium | 11 try/catch blocks confirmed |
| Q-72 | Open-Medium | Open-Medium | 5 modules still untested |
| Q-77 | Open-Medium | ✅ Fixed | 0 matches for `accountId ?? 1` pattern |
| S-113 | Open-Low | Open-Low | Superseded by S-124 (Medium) |
| S-114 | Open-Low | Open-Low | Superseded by S-127 (Medium) |
| B-98 | Open-Low | Open-Low | Constructor manages interval, but no singleton guard |
| A-52 | Open-Low | Open-Low | Subsumed by broader A-55 finding |
| A-53 | Open-Low | Open-Low | Subsumed by A-60 |
| Q-66 | Open-Low | Open-Low | Now 3 files with duplicated formatBytes |
| Q-67 | Open-Low | Open-Low | Unchanged |
| Q-70 | Open-Low | Open-Low | Unchanged |
| Q-75 | Open-Low | Open-Low | Now 23 `as any` casts |
| Q-76 | Open-Low | Open-Low | 71 inline styles in modals |

---

## Remediation Priority

### URGENT (before any release)
1. Set `withGlobalTauri: false` (S-117) — 1 line change
2. Migrate 8 callers to `_from_store` commands, remove legacy WIF commands (S-115) — major effort
3. Remove `get_wif_for_operation` (S-116) — depends on #2

### High (next sprint)
4. Fee rate bounds validation in Rust (S-121)
5. Address validation in check_address_balance (S-118)
6. Deep link approval UI shows actual amounts (S-122)
7. Remove duplicate unlock attempt recording (B-99)
8. Fix inscription WIF flow (B-100)
9. Fix getBalanceFromDB Result/number mismatch (Q-95)
10. Zeroizing<String> for KeyStoreInner (S-119/S-120)

### Medium (sprint after)
11-19. Fee rate passthrough, coin selection sort fix, ConnectedApps stale closure, account ID null checks, UIContext split, App.tsx extraction, TokensTab validation, storage type safety

### Ongoing
20-24. Security hardening, PlatformAdapter migration, performance fixes, quality improvements
