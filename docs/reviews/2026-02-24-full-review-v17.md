# Simply Sats — Full Review Report v17

**Date:** 2026-02-24
**Reviewer:** Claude (automated deep review)
**Rating:** 7.0 / 10 (down from 8.2 in v16)
**Scope:** Full four-phase comprehensive review — security, bugs, architecture, quality

---

## Executive Summary

Review #17 is a comprehensive deep review following the major refactoring session in Review #16. While all 37 fixes from v16 are verified intact and the codebase compiles cleanly with 1748 passing tests, this deep analysis uncovered **46 new findings** (4 high, 26 medium, 16 low) that were not visible in prior reviews.

The most significant discoveries are:

1. **S-43 (High):** `getParams<T>()` in BRC-100 types provides zero runtime validation — every external parameter from connected apps is an unvalidated type cast
2. **S-47 (High):** The Rust `get_wif_for_operation` command returns raw WIF private keys to JavaScript, meaning XSS extracts all wallet keys
3. **B-42 (High):** Token transfers never record transactions or mark UTXOs as spent, creating double-spend risk on rapid follow-up sends
4. **B-43 (High):** Token sends can only use UTXOs from a single address, causing sends to fail when tokens span wallet and ordinal addresses

The rating drop from 8.2 to 7.0 reflects these being deep structural issues rather than surface-level bugs — they require careful architectural fixes, not quick patches.

---

## Pre-Review Baseline

Before starting analysis:

- **Lint:** 52 warnings (all `no-restricted-imports`), 0 errors
- **TypeScript:** Clean compilation, no errors
- **Tests:** 1748 tests passing across 71 files, 0 failures
- **Git state:** Clean on `main` branch, commit `906c81f`

All v16 fixes verified intact via targeted file reads.

---

## Phase 1: Security Audit

### Methodology

Deep analysis of cryptographic operations, key management, IPC boundaries, BRC-100 protocol handling, and input validation. Focused on areas that prior reviews examined at surface level.

### Critical Findings

#### S-43 — BRC-100 getParams Has Zero Runtime Type Safety (High)

**File:** `src/services/brc100/types.ts:145-147`

```typescript
export function getParams<T>(request: BRC100Request): T {
  return (request.params || {}) as T
}
```

Every BRC-100 handler uses this to extract parameters from external requests. The TypeScript generic `<T>` only provides compile-time safety — at runtime, any connected app can send arbitrary data that bypasses all type constraints.

**Impact:** Connected apps can send malformed parameters that trigger unexpected behavior in lock creation, key derivation, encryption, and transaction building. Combined with S-58 (no per-origin scoping), any approved app gets full wallet access with unvalidated inputs.

**Recommendation:** Add Zod schemas or manual runtime validation for each parameter type. At minimum, validate shape/types at the `getParams` call site in each handler.

#### S-47 — Raw WIF Keys Exposed to JavaScript (High)

**File:** `src-tauri/src/key_store.rs:398`

The `get_wif_for_operation` Tauri command returns raw WIF private keys from the Rust secure store to the JavaScript frontend. While Rust properly zeroizes key material, once the WIF crosses the IPC boundary it lives in the JavaScript heap — observable to any XSS payload.

**Impact:** XSS → full key extraction → funds theft. The Tauri security model (CSP, origin restrictions) mitigates this, but it violates the principle that private keys should never leave the secure store.

**Recommendation:** Refactor to sign transactions in Rust. The WIF should never cross the IPC boundary. Use a `sign_transaction(tx_hex)` pattern instead.

### Medium Findings

**S-42:** The `ciphertext as number[]` cast in handlers.ts:401 passes unvalidated data to ECIES decryption. A malformed payload could trigger unexpected behavior in the crypto library.

**S-44:** `request.origin` is used directly in tagged key derivation without sanitization. An origin like `app.wrootz.com` and `app.wrootz.com/sub` could produce colliding tags, allowing one app to derive another's keys.

**S-46:** `Math.random()` generates BRC-100 request IDs. While not a direct vulnerability (IDs are for correlation, not auth), it's poor cryptographic hygiene and could enable request prediction.

**S-48:** No rate limiting on Tauri IPC commands. The HTTP server has rate limiting, but a compromised webview can call `get_wif_for_operation` or signing commands at unlimited speed.

**S-49:** SDK HMAC verification silently skips when the signature header is absent. A MITM proxy stripping the `X-Hmac-Signature` header would produce unverified responses.

**S-50:** `encodeScriptNum` in brc100/script.ts can overflow for lock times above 2^31 (~year 2038). BSV block heights are well below this, but the function should fail explicitly rather than produce wrong scripts.

**S-51:** BRC-100 CLTV lock creation at `brc100/locks.ts:92` uses `identityPubKey`, but the native unlock path in `lockUnlocking.ts` uses the wallet key. This key mismatch means BRC-100-created locks may not be unlockable through the standard UI.

**S-53:** Raw mnemonic passes through the JavaScript heap before being stored in Rust. The `store_keys` IPC call receives the mnemonic as a string parameter, exposing it to JS memory.

**S-57:** `getKnownTaggedKey` returns root private keys for well-known labels like "yours", giving callers more key material than needed.

**S-58:** Once a user approves a BRC-100 connection, the app gets full wallet access — no per-action or per-amount scoping. An approved app can lock, unlock, sign, encrypt, and derive keys without limits.

**S-59:** The BRC-100 session token is accessible to any JavaScript context via Tauri commands. A compromised component could impersonate the BRC-100 server.

---

## Phase 2: Bug Detection

### Methodology

Systematic analysis of state management, effect lifecycles, async flow correctness, database consistency, and error handling paths.

### Critical Findings

#### B-42 — Token Transfer Has No Local State Tracking (High)

**File:** `src/services/tokens/transfers.ts:108-270`

The `transferToken` function builds and broadcasts a transaction but never calls `recordSentTransaction()` or `markUtxosPendingSpend()`. Compare with `sendBSV` in `transactions.ts` which does both.

**Impact:** After a token transfer, the spent UTXOs remain marked as spendable in the local database. A rapid follow-up send before background sync completes would attempt to double-spend the same UTXOs.

#### B-43 — Token Send Cannot Combine Multi-Address UTXOs (High)

**File:** `src/services/tokens/transfers.ts:275-348`

`sendToken` takes a single `paymentWif` but tokens may span both the wallet address and ordinal address. The function can only sign inputs from one address, causing sends to fail silently when the required UTXOs are split across addresses.

**Impact:** Users see a balance (aggregated across addresses) but sends fail because the function can't assemble enough UTXOs from a single address.

### Medium Findings

**B-39:** Payment listener in `App.tsx:165-193` sets up a Tauri event listener but the effect cleanup doesn't tear down the previous listener. On React strict mode double-fire or hot reload, orphaned listeners accumulate.

**B-41:** Background sync for inactive accounts at `App.tsx:320-343` doesn't check the `cancelled` flag after an account switch. Sync results from the old account could write to state during the transition.

**B-45:** "Unlock All" at `App.tsx:468-485` iterates through all matured locks but doesn't short-circuit on network errors. It also always closes the modal, even when all unlocks fail.

**B-47:** Discovery params at `App.tsx:362-372` are cleared before the cancellation check, meaning concurrent account switches lose discovery state.

**B-53:** `reassignAccountData` in utxoRepository.ts reassigns UTXOs/txs/locks where `account_id IS NULL` — but account 1's data was historically stored without explicit account_id. This function would steal account 1's data when creating account 2.

---

## Phase 3: Architecture Review

### Module Coupling

The layered architecture (Components → Hooks → Contexts → Services → Domain) is well-established. The v16 monolith splits improved modularity significantly. However:

**A-31:** The brc100 barrel index (`brc100/index.ts`) is incomplete — 5+ exports like `verifyDataSignature`, `buildAndBroadcastAction` are missing, forcing consumers to import from internal sub-modules.

**A-32:** `isTauri()` is copy-pasted across 8 files. This should be a shared utility in `src/utils/` or `src/infrastructure/`.

**A-30:** JSX indentation in `AppProviders.tsx` doesn't match the logical provider nesting, making the hierarchy visually misleading.

### Context Architecture

The WalletStateContext/WalletActionsContext split (from v5) is working well. However:

**A-33:** SyncContext exposes raw state setters (`setUtxos`, `setOrdinals`) in its context API, inviting uncoordinated mutations from consumers.

**A-34:** ConnectedAppsContext uses O(n) array lookups via `includes()`. For a small number of apps this is fine, but a `Set` would be more semantically correct.

---

## Phase 4: Code Quality

### DRY Violations

**Q-42:** UTXO mapping from database format (with `lockingScript`) to service format (with `script`) is repeated 10+ times across the codebase. A single `toWalletUtxo()` helper would eliminate this.

**Q-43:** Derived address key resolution in `useWalletSend.ts` is duplicated between `handleSend` and `handleSendMulti` (~70 lines each).

**Q-52:** BRC-100 locks use manual greedy coin selection instead of the domain's `selectCoins()` function, risking divergent behavior.

### Performance

**Q-44:** Zero React components use `React.memo()`. Every state change re-renders all tabs, even those not visible. Tab components are prime candidates for memoization.

**Q-49:** `ordinalContentCache` stored as `useState<Map>` triggers a full re-render on every cache entry addition. Should use `useRef` or a dedicated cache context.

### Test Coverage

**Q-24:** 12 of 17 hooks have zero test coverage (up from 11/16 in v16). Critical untested hooks: `useWalletSend`, `useWalletLock`, `useBRC100`, `useSyncOrchestration`, `useWalletInit`.

**Q-46:** 6 of 9 context providers lack tests — WalletContext, SyncContext, AccountsContext, UIContext, LocksContext, TokensContext.

**Q-47:** 8+ BRC-100 service modules lack tests — formatting, handlers, locks, crypto, validation, etc.

---

## Health Assessment

### Strengths

1. **Clean compilation** — Zero TypeScript errors, zero lint errors
2. **Strong test suite** — 1748 tests passing, good coverage in domain and services layers
3. **Proper error handling** — Result<T,E> pattern adopted in ~60% of codebase
4. **Good module structure** — v16 splits created clean separation of concerns
5. **Security foundations** — PBKDF2 600K iterations, AES-GCM 256-bit, CSRF nonces, CSP

### Weaknesses

1. **Key material exposure** — WIF crosses IPC boundary to JS (S-47)
2. **BRC-100 input validation** — External params have zero runtime validation (S-43)
3. **Token state tracking** — Transfers don't update local state (B-42)
4. **Permission model** — Binary approve/deny with no scoping (S-58)
5. **Test gaps** — Most hooks and context providers untested (Q-24, Q-46)

### Rating Breakdown

| Dimension | Score | Notes |
|-----------|-------|-------|
| Security | 6/10 | Key exposure (S-47), unvalidated params (S-43), no permission scoping (S-58) |
| Correctness | 7/10 | Token state gap (B-42, B-43), App.tsx lifecycle bugs |
| Architecture | 8/10 | Clean layers, good splits, but barrel gaps and DRY violations |
| Code Quality | 7/10 | Strong domain layer, weak hook/context test coverage |
| **Overall** | **7.0/10** | Down from 8.2 — deep issues require architectural fixes |

---

## Comparison with Prior Reviews

| Review | Date | Findings | Rating | Key Theme |
|--------|------|----------|--------|-----------|
| v5 | Feb 17 | 41 | 4.2 | Foundation security, error handling |
| v7 | Feb 17 | 11 | — | UI polish, dead code |
| v8-v9 | Feb 23 | 26+10 | 5.0 | Stability, sync, tests |
| v10 | Feb 23 | 8 | — | JSON safety, logger |
| v11 | Feb 23 | 26 | 6.5 | UX/accessibility |
| v12 | Feb 23 | 10 | 6.8 | Shared utilities, AbortController |
| v13 | Feb 23 | 8 | — | Security hardening, factories |
| v14 | Feb 23 | 16 | — | UI/UX polish |
| v15 | Feb 23 | 10 | — | Deep semantic correctness |
| v16 | Feb 23 | 55 | 8.2 | Monolith splits, multi-account |
| **v17** | **Feb 24** | **46** | **7.0** | **Deep security + bugs + quality** |

The rating decrease from 8.2 to 7.0 reflects that v17 uncovered foundational issues (key exposure, input validation, state tracking) that were always present but not caught by prior surface-level reviews. The codebase has actually improved since v16 — the lower rating reflects deeper scrutiny, not regression.

---

## Total Issue Tracker

| Category | Total | Fixed | High Open | Medium Open | Low Open |
|----------|-------|-------|-----------|-------------|----------|
| Security | 59 | 26 (+1 accepted) | 2 | 17 | 11 |
| Bugs | 50 | 21 | 2 | 10 | 8 |
| Architecture | 34 | 18 | 0 | 8 | 7 |
| Quality | 52 | 27 | 0 | 12 | 11 |
| UX/UI | 40 | 40 | 0 | 0 | 0 |
| Stability | 13 | 13 | 0 | 0 | 0 |
| **Total** | **248** | **145** | **4** | **47** | **37** |

**Open issues: 88** (4 high, 47 medium, 37 low)
**Fix rate: 58%** of all issues ever identified are resolved
