# Checkpoint: Review Remediation
**Date:** 2026-02-17T22:27:42Z
**Branch:** `fix/review-remediation` (worktree at `.worktrees/review-remediation`)
**Phase:** Mid-execution — 8 of 15 fixes done, 7 remaining

---

## Completed ✅

- [x] **B-2** `useWalletLock.ts:119-132` — visibility handler now catches lockWallet() failure and forces `setIsLocked(true)` for safety
- [x] **B-3** `transactions.ts:sendBSV/sendBSVMultiKey/consolidateUtxos` — explicit `accountId === undefined` guard throws `AppError` instead of defaulting to account 1
- [x] **S-2** `storage.ts:saveToSecureStorage()` — added read-back `secure_storage_exists` verify after save; returns false on mismatch
- [x] **S-4** `crypto.ts:decrypt()` — Web Crypto fallback now clamps `iterations = Math.max(encryptedData.iterations, PBKDF2_ITERATIONS)` before calling `deriveKey`
- [x] **A-4** `AppProviders.tsx` — every context provider now wrapped in its own `<ErrorBoundary context="...">` so one provider crash doesn't kill the app
- [x] **Q-3** `balance.ts:getUTXOsFromDB()` — removed silent catch; errors now propagate to callers. Updated test from "returns empty array on DB error" → "throws on database error"
- [x] **Q-7** `config/index.ts` — added `HIDDEN_LOCK_DELAY_MS: 60_000` to `SECURITY` object. `useWalletLock.ts` now uses `SECURITY.HIDDEN_LOCK_DELAY_MS`
- [x] **A-5** `wocClient.ts` — added exponential-backoff retry (3 attempts, 500ms base) for 5xx errors and network failures inside `fetchWithTimeout`

## In Progress (started but not committed) ⏳

- [ ] **Q-1** `fees.ts` — extract `getStoredFeeRate()` private helper (DRY up 2 near-identical localStorage reads in `getFeeRate` + `getFeeRateAsync`)
- [ ] **A-6** `RequestManager.ts` — fix cleanup interval so it's < TTL (currently interval == TTL)
- [ ] **B-11** `SyncContext.tsx:262,278` — guard `NaN`/`Infinity` before `setBalance`/`setOrdBalance`
- [ ] **B-12** `fees.ts:34,92` — guard negative cache age (backwards clock skew)

## Pending (not started) 📋

- [ ] **S-8** `backupRecovery.ts:~160` — validate `keys.walletWif` via `PrivateKey.fromWIF()` and `keys.mnemonic` via domain `validateMnemonic()` after decrypt
- [ ] **Q-4** `transactions.ts:executeBroadcast()` — when rollback fails after broadcast failure (CRITICAL state), surface an AppError with `BROADCAST_SUCCEEDED_DB_FAILED` code so UI can show a toast
- [ ] **Run final test suite + typecheck** — `npm run test:run && npm run typecheck` in `.worktrees/review-remediation`

---

## Key Context

### File locations (all in `.worktrees/review-remediation/`)
- Hooks: `src/hooks/useWalletLock.ts`
- Services: `src/services/wallet/transactions.ts`, `src/services/wallet/balance.ts`, `src/services/wallet/fees.ts`, `src/services/crypto.ts`
- Infrastructure: `src/infrastructure/api/wocClient.ts`
- Contexts: `src/contexts/SyncContext.tsx`
- Config: `src/config/index.ts`
- BRC-100: `src/services/brc100/RequestManager.ts`
- Backup: `src/services/backupRecovery.ts`
- AppProviders: `src/AppProviders.tsx`

### Decisions made
- **Q-3**: Chose to throw (not return Result type) because all call sites are already in try/catch. Updated 1 failing test in `balance.test.ts`.
- **B-3**: All three send functions now require explicit `accountId`. This is a **breaking change** — callers must pass accountId. WalletContext already passes `activeAccountId` everywhere so this should be safe.
- **A-5**: Retry logic is inside `fetchWithTimeout` itself (not per-method), so all WoC endpoints get retry automatically.
- **A-4**: Used existing `ErrorBoundary` component from `src/components/shared/ErrorBoundary.tsx`. No new code needed.

### What NOT to fix (reassessed during implementation)
- **B-1** (stale balance): Re-read the code — `isCancelled?.()` check at line 261 is BEFORE `setBalance` at line 263. Already correct. Skip.
- **B-4** (duplicate UTXO): Current behavior (swallow duplicate key) is correct — transaction is already on-chain, change UTXO will resync. Skip.
- **B-5** (null guard balance.ts): Code at line 116 uses `prevTx?.vout && Array.isArray(prevTx.vout) ? prevTx.vout[vin.vout] : undefined` — already correctly guarded. Skip.
- **B-6/B-7** (fee overflow/negative): `feeFromBytes` already validates `!Number.isFinite(bytes)` at lines 97-99. Skip.
- **S-1** (unprotected localStorage): Intentional fallback for non-Tauri environments. Skip (documented).

---

## Next Steps (resume from here)

1. Open `src/services/wallet/fees.ts` in worktree
2. Add private `getStoredFeeRate()` helper before `getFeeRate()`:
   ```ts
   function getStoredFeeRate(): number | null {
     const stored = localStorage.getItem(STORAGE_KEYS.FEE_RATE)
     if (stored) {
       const rate = parseFloat(stored)
       if (Number.isFinite(rate) && rate > 0) {
         return Math.max(MIN_FEE_RATE, Math.min(MAX_FEE_RATE, rate))
       }
     }
     return null
   }
   ```
3. Update `getFeeRate()` and `getFeeRateAsync()` to call `getStoredFeeRate()` (removes duplication)
4. While in fees.ts: fix B-12 — change cache age check from `< FEE_RATE_CACHE_TTL` to `>= 0 && < FEE_RATE_CACHE_TTL`
5. Open `src/contexts/SyncContext.tsx` — fix B-11 (add `Number.isFinite` guards before `setBalance` at ~line 262 and `setOrdBalance` at ~line 280)
6. Open `src/services/brc100/RequestManager.ts` — fix A-6 (set interval to `Math.min(ttlMs / 4, 60_000)`)
7. Open `src/services/backupRecovery.ts` — fix S-8 (validate WIF + mnemonic after decrypt)
8. Open `src/services/wallet/transactions.ts` — fix Q-4 (surface rollback failure in `executeBroadcast`)
9. Run: `cd .worktrees/review-remediation && npm run test:run && npm run typecheck`
10. Commit and use `superpowers:finishing-a-development-branch`
