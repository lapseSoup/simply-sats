# Review #17 Remediation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all reasonably-fixable issues from Review #17 (targeting ~60 of 88 open items)

**Architecture:** Grouped into 10 parallel-executable batches by file locality. Each batch touches non-overlapping files. Run `npm run typecheck && npm run lint && npm run test:run` after all batches.

**Tech Stack:** TypeScript 5.9, React 19, Rust (Tauri 2), Vitest

**Skipped (major architectural — separate sessions):**
- S-47: Move all signing to Rust (new IPC commands, multi-file Rust changes)
- S-48: IPC rate limiting in Rust key_store
- S-53: Minimize mnemonic in JS heap (architectural redesign)
- S-58: Per-origin BRC-100 permission system (new feature)
- S-59: Scope session token to BRC-100 context (architectural)
- Q-24: Hook tests (3-5 hours, separate session)
- Q-46: Context provider tests (3-5 hours, separate session)

---

## Batch 1: BRC-100 Module (9 fixes)

**Files:** `src/services/brc100/types.ts`, `handlers.ts`, `utils.ts`, `script.ts`, `locks.ts`, `index.ts`

### S-43: Add runtime validation to getParams
In `types.ts:145`, replace the cast-only helper with a validated version. Add per-handler validation at each call site in `handlers.ts`.

### S-42: Validate ciphertext before ECIES decrypt
In `handlers.ts:401`, add `Array.isArray(ciphertext) && ciphertext.every(v => typeof v === 'number')` check before `decryptECIES`.

### S-44: Sanitize origin in tag derivation
In `handlers.ts:437`, use JSON.stringify for unambiguous tag serialization in `keyDerivation.ts:445`.

### S-45: Replace wrootz includes with exact match
In `handlers.ts:201`, replace `request.origin?.includes('wrootz')` with hostname check.

### S-46: Replace Math.random with crypto.getRandomValues
In `utils.ts:21-23`, use `crypto.getRandomValues(new Uint8Array(12))`.

### S-50: Add bounds check to encodeScriptNum
In `script.ts:12`, add `if (!Number.isSafeInteger(num) || num > 0x7FFFFFFF) throw`.

### S-51: Fix CLTV key — use walletPubKey instead of identityPubKey
In `locks.ts:92`, change `keys.identityPubKey` to `keys.walletPubKey`.

### Q-52: Use domain selectCoins instead of manual loop
In `locks.ts:97-106`, replace manual loop with `selectCoins(utxos, satoshis)`.

### A-31: Add missing barrel exports
In `index.ts`, add exports for `verifyDataSignature`, `buildAndBroadcastAction`, `formatLockedOutput`, `ListedOutput`, `createScriptFromHex`, `executeApprovedRequest`.

---

## Batch 2: App.tsx Bug Fixes (6 fixes)

**Files:** `src/App.tsx`

### B-39: Fix payment listener cleanup
Use a ref for showToast, remove showToast from deps. Use mounted flag pattern.

### B-40: Remove double setSyncPhaseRef(null)
Remove the redundant `setSyncPhaseRef.current(null)` at line ~252, keep only the one in finally.

### B-41: Check cancelled flag in background sync loop
Add `if (cancelled) break` at top of `for (const account of otherAccounts)` loop.

### B-45: Short-circuit Unlock All on error
Add error counter; break on first network error. Don't close modal if all failed. Show summary toast.

### B-47: Move clearPendingDiscovery after cancellation check
Swap order: check `cancelled` first, then `clearPendingDiscoveryRef.current()`.

### B-49: Capture activeAccountId before fire-and-forget loop
Capture `const capturedAccountId = activeAccountId` before the IIFE.

---

## Batch 3: Token Transfer Fixes (2 fixes)

**Files:** `src/services/tokens/transfers.ts`

### B-42: Add transaction recording to transferToken
After `broadcastTransaction(tx)` succeeds, call `markUtxosPendingSpend` and `confirmUtxosSpent` for funding UTXOs. Call `recordSentTransaction` for the transfer.

### B-43: Support multi-address token sends
In `sendToken`, when single-address UTXOs are insufficient but combined total suffices, return a descriptive error explaining the limitation. (Full multi-key signing requires deeper refactor.)

---

## Batch 4: Key Derivation & Crypto (4 fixes)

**Files:** `src/services/keyDerivation.ts`, `src/services/crypto.ts`

### S-55: Bound KNOWN_SENDER_PUBKEYS
Add `MAX_KNOWN_SENDERS = 100` limit and pubkey hex format validation in `addKnownSender`.

### S-56: Validate JSON in loadKnownSenders
Add `Array.isArray(senders)` check and string type validation per element.

### S-57: Don't return root keys from getKnownTaggedKey
Return derived keys instead of root identity/wallet/ord keys. Use `deriveTaggedKey` for well-known labels.

### S-60: Add size limit to isLegacyEncrypted
Add `if (data.length > 10000) return false` before `atob`.

---

## Batch 5: SDK Fixes (2 fixes)

**Files:** `sdk/src/index.ts`

### S-27: Add CSRF nonce to listOutputs
Add optional `nonce` parameter to `listOutputs`, pass through to `this.request()`.

### S-49: Fail when signature header missing with strictVerification
Add check: when `strictVerification && sessionToken && !signature`, throw `SimplySatsError`.

---

## Batch 6: Extract isTauri Utility (1 fix, 7+ files)

**Files:** Create `src/utils/tauri.ts`, update 7 files

### A-32: Extract shared isTauri
Create `src/utils/tauri.ts` with `isTauri()` and `tauriInvokeWithTimeout<T>()`. Replace all 7 local definitions with imports.

---

## Batch 7: Hook Fixes (3 fixes)

**Files:** `src/hooks/useSyncData.ts`, `src/hooks/useBrc100Handler.ts`, `src/hooks/useWalletSend.ts`

### B-46: Fix falsy activeAccountId check
Replace `if (!activeAccountId)` with `if (activeAccountId == null)` in both `fetchDataFromDB` and `fetchData`.

### B-50: Stabilize BRC-100 listener via ref
Use `onRequestReceivedRef` pattern (already used for `isTrustedOriginRef`), remove `onRequestReceived` from effect deps.

### Q-43: Extract shared derived address key resolution
Extract `buildExtendedUtxos(wallet, activeAccountId, selectedUtxos?)` helper used by both `handleSend` and `handleSendMulti`.

---

## Batch 8: Context Fixes (3 fixes)

**Files:** `src/contexts/SyncContext.tsx`, `src/contexts/LocksContext.tsx`

### Q-49: Move ordinalContentCache to ref-only
Remove `ordinalContentCache` from state. Use only `contentCacheRef.current`. Add a `cacheVersion` counter state that increments on batch completion.

### B-44 + Q-48: Remove unused _providedUtxos parameter
Remove `_providedUtxos` from `detectLocks` signature and all call sites.

---

## Batch 9: DB & Repository (1 fix)

**Files:** `src/infrastructure/database/utxoRepository.ts`

### B-53: Fix reassignAccountData to check account 1 exists
Before reassigning, check if account_id=1 has a legitimate account in the accounts table. Skip if it does.

---

## Batch 10: Quality & Polish (7 fixes)

**Files:** Various

### Q-29: Extract queueApprovalRequest helper
In `brc100/validation.ts`, extract the repeated Promise-wrapping pattern.

### Q-30: Type AnyPrivateKey properly
In `marketplace.ts`, replace `type AnyPrivateKey = any` with `type AnyPrivateKey = PrivateKey | { toWif(): string }`.

### Q-42: Extract toWalletUtxo helper
Create helper in `src/domain/types.ts` and use across 10+ files.

### Q-44: Add React.memo to tab components
Wrap all 6 tab components in `React.memo()`.

### Q-51: Add clarifying comments to DML migrations
Add comments to `010_reset_tx_amounts.sql` and `011_reset_tx_amounts_v2.sql` referencing the lesson.

### A-30: Fix JSX indentation in AppProviders
Re-indent lines 58-66 to match logical nesting.

### S-52: Use CASE expression for atomic account switch
Replace two sequential UPDATEs with single UPDATE using CASE.

---

## Verification

After all batches:
```bash
npm run typecheck    # Must pass (0 errors)
npm run lint         # Must pass (0 errors, warnings OK)
npm run test:run     # Must pass (1748+ tests)
```
