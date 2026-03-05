# Simply Sats — Full Review #28
**Date:** 2026-03-04
**Rating:** 8.5 / 10
**Reviewer:** Claude Code (automated 4-phase review)

## Baseline

| Check | Status |
|-------|--------|
| `npm run lint` | 0 errors, 54 warnings |
| `npm run typecheck` | Clean pass |
| `npm run test:run` | 1954/1954 tests pass (86 files, 74s) |

## Phase 0: Open Issue Verification

Verified all 32 open issues from Review #27 against current code:

- **22 confirmed still open** with direct evidence
- **7 likely still open** based on related code patterns
- **3 needs specific verification** (files moved/consolidated)
- **0 fixed since v27**

Key observations:
- S-111 (mnemonic Zeroizing) confirmed at `key_store.rs:106-108,128,242`
- A-60 (WalletContext) confirmed at exactly 527 lines
- Q-72 (zero test coverage) updated: `messageBox.ts` now has 1058-line test file
- A-51 (WalletStateContextType) confirmed at exactly 25 fields

## Phase 1: Security Audit

### New Findings

**S-125 (Medium) — WIF-accepting messageBox functions still exported**
- File: `messageBox.ts:87-123,162,215,269,528`
- The v27 fix (S-121) correctly created store-based variants (`*FromStore`), and `usePaymentListener` uses them. However, the old WIF-accepting functions remain exported and available. A new caller could inadvertently use `startPaymentListener(identityWif)` instead of `startPaymentListenerFromStore(identityPubKey)`.
- Recommendation: Mark old functions `@deprecated` with JSDoc, or make them private/remove them.

**S-126 (Medium) — useWalletSend.ts still routes WIFs through JS heap**
- File: `useWalletSend.ts:51,75,257-258,300-301`
- 6 calls to `getWifForOperation` pull wallet/identity/ordinals WIFs into the JavaScript heap for send operations (`handleSend`, `handleSendMulti`, `handleTransferOrdinal`, `handleListOrdinal`).
- Unlike BRC-100 handlers which migrated to `_from_store` Tauri commands, the core send flow still uses the bridge pattern where WIFs cross the IPC boundary.
- This is the most significant remaining WIF-in-JS exposure path.

**S-128 (Medium) — Chrome extension keyStore holds WIFs as plain strings**
- File: `platform/chrome.ts:62-87`
- The Chrome extension adapter stores WIFs in a module-scoped plain JavaScript object. Unlike Tauri's `Zeroizing<String>` which zeros memory on drop, JavaScript strings are immutable and persist in the V8 heap until garbage collection.
- The `clearKeys()` method sets fields to `null` but the original string values remain in memory.

**S-127 (Low) — Unbounded paymentNotifications array**
- File: `messageBox.ts:39`
- Module-scoped `paymentNotifications` array has no size cap. Each incoming payment pushes to it and persists to localStorage. A long-running wallet processing many payments could accumulate thousands of entries.

**S-129 (Low) — certificates.ts uses WIF instead of store**
- File: `certificates.ts:394-396`
- `acquireCertificate` calls `getWifForOperation('identity')` instead of a `_from_store` variant for certificate signing.

**S-130 (Low) — getKnownTaggedKey returns raw root WIFs**
- File: `keyDerivation.ts:393-439`
- Returns raw WIF for well-known labels. Mitigated by only being called from paths behind user approval.

### Existing Security Posture
The security architecture is strong:
- Rust key store with `Zeroizing<String>` for WIFs (S-123 fixed in v27)
- BRC-100 handlers migrated to `_from_store` commands
- Rate limiting, HMAC auth, CSRF nonces on HTTP server
- CSP restricting origins, DNS rebinding protection
- Auto-lock with visibility-based and inactivity-based triggers

The remaining WIF-in-JS exposure (S-126) is the most impactful security gap — it affects every BSV send operation.

## Phase 2: Bug Detection

### New Findings

**B-115 (Medium) — Payment listener singleton returns no-op cleanup**
- File: `messageBox.ts:466-468`
- When `isListening` is true, `startPaymentListenerFromStore` returns `() => {}` — a no-op. The caller (typically React's useEffect cleanup) gets no way to stop the running listener.
- On account switch, if useEffect re-runs, the new identity pub key is never used because the old listener is still running. The hook in `usePaymentListener.ts` works around this because React's strict mode cleanup runs first, but in edge cases (rapid account switching), the old listener may persist.

**B-116 (Low) — WebviewWindow creation not error-handled**
- File: `utils/window.ts:56`
- `new WebviewWindow(...)` is fire-and-forget. If window creation fails, the error is silently swallowed.

### Existing Bug Landscape
The codebase has strong defensive patterns:
- `sendingRef` guards prevent double-sends
- `fetchVersionRef` prevents stale account data
- `isCancelled` callbacks abort cross-account sync leaks
- Rate limiting with exponential backoff on unlock

B-99 (autoLock resume) and B-101 (doubled API calls) remain the most impactful open bugs.

## Phase 3: Architecture Review

### New Findings

**A-67 (Medium) — messageBox.ts code duplication**
- File: `messageBox.ts` (584 lines)
- Three function pairs are near-identical: `listPaymentMessages`/`listPaymentMessagesFromStore`, `acknowledgeMessages`/`acknowledgeMessagesFromStore`, `checkForPayments`/`checkForPaymentsFromStore`. They differ only in how auth headers are created.
- Recommendation: Extract shared logic with a strategy parameter for authentication.

**A-68 (Low) — Incomplete Tauri API wrapping migration**
- New utility modules (`utils/dialog.ts`, `utils/fs.ts`, `utils/window.ts`, `utils/opener.ts`) correctly wrap Tauri APIs with `isTauri()` guards. However, A-49 (27 files importing `@tauri-apps/*` directly) is still open. The migration path is clear but incomplete.

### Architecture Health
The layered architecture is well-maintained:
- Clean context provider hierarchy with documented ordering
- Extracted hooks reduce god-object complexity
- Repository pattern in database layer (though 37 raw SQL calls bypass it - A-55)
- Platform abstraction layer established (though migration incomplete - A-49)

WalletContext.tsx at 527 lines (A-60) remains the most complex single file.

## Phase 4: Code Quality

### New Findings

**Q-106 (Medium) — Module-load invoice generation**
- File: `keyDerivation.ts:160-197`
- `generateBSVDesktopInvoices()` creates ~500+ invoice strings at module load time. This runs when the module is first imported, even if BRC-42 derivation is never used. Should be lazy-initialized on first call.

**Q-104 (Low) — Duplicated autoLock interval logic**
- File: `autoLock.ts:99-124,223-248`
- The interval callback in `initAutoLock` and `resumeAutoLock` is nearly identical (checking inactivity, firing warnings). Should be extracted to a shared function.

**Q-105 (Low) — Duplicated auth header construction**
- File: `messageBox.ts:87-123,130-157`
- `createAuthHeaders` and `createAuthHeadersFromStore` share nonce generation, timestamp, and header construction — differing only in the signing call.

### Quality Highlights
- Test coverage is excellent: 1954 tests across 86 files
- messageBox.ts now has comprehensive 1058-line test file (Q-72 partially resolved)
- New utility modules follow good patterns (isTauri guards, proper error handling)
- CSS has been restructured into organized module files

## Overall Assessment

**Rating: 8.5 / 10**

The codebase is in strong shape. The security architecture is mature with the Rust key store, and most critical issues have been resolved across 27 prior reviews. The main theme of new findings is **completing the WIF-in-JS-heap migration** — the BRC-100 handlers have been migrated to `_from_store` commands, but the core send flow (`useWalletSend.ts`) still pulls WIFs through JavaScript.

### What's Working Well
- Comprehensive test suite (1954 tests)
- Strong security layering (Rust key store, CSRF, rate limiting)
- Well-documented codebase with clear architectural decisions
- Consistent review-and-fix cycle (471 → 484 issues tracked, 443 resolved)

### Top 3 Priorities
1. **S-126**: Migrate `useWalletSend.ts` to `_from_store` commands — eliminates the largest remaining WIF-in-JS exposure
2. **B-115**: Fix payment listener singleton — prevents stale listener on account switch
3. **A-67**: Deduplicate messageBox.ts — reduces 584-line file by ~40%
