# Checkpoint: Code Review Remediation — COMPLETE
**Date:** 2026-02-17
**Status:** ALL 24 items complete (0 remaining)

## Completed (24 items across 4 sessions)

### Must Fix Before Release (5/5)
- [x] B-1: Account switch mutex (prevent parallel switches)
- [x] B-2: Storage fire-and-forget (await storage writes)
- [x] B-3: Vout validation (reject negative/NaN vout)
- [x] S-1: JS fallback rate limiter (in-process when Tauri unavailable)
- [x] S-2: Password to useRef (prevent stale closure)

### Should Fix Soon (8/8)
- [x] B-4: Stale account in SyncContext — already handled via fetchVersionRef
- [x] B-5: Stale token accountId guard (lastRequestedAccountRef)
- [x] B-6: Balance error propagation (getBalanceFromDB throws instead of returning 0)
- [x] S-5: feeFromBytes throws on invalid input
- [x] S-7: Zombie pending UTXOs — already handled (5min cleanup in syncWallet)
- [x] S-11: Session key TTL reduced from 6h to 1h + clearSessionKey on lock
- [x] B-10: Lock input validation (positive integer satoshis + unlockBlock)
- [x] B-11: OP_RETURN extra bytes in lock fee calculation

### Good to Improve (7/7)
- [x] S-6: Coin selection throw — skipped (callers already handle correctly)
- [x] A-3: Batch token upserts (withTransaction wrapper)
- [x] S-10: Visibility-based privacy data clearing (5min hidden timeout)
- [x] S-12: Max amount + integer validation for sendBSV
- [x] S-14: Broadcast error sanitization (strip endpoint names)
- [x] B-7: Hex validation on lockedUtxo.lockingScript
- [x] B-12: Derived addresses array guard

### Architecture / Refactors (4/4)
- [x] S-4: Gate debugFindInvoiceNumber behind import.meta.env.DEV
- [x] S-13: Remove mousemove/scroll from auto-lock activity events
- [x] A-1: Split brc100.ts (1,502 → 122 lines + 5 submodules)
- [x] A-2: WalletContext already well-split — no changes needed

### Backlog (4/4) — completed in final session
- [x] #19: Migrate 8 legacy `{ success, error }` patterns to `Result<T, E>`
- [x] #20: Increase test coverage from ~27% to 40.21%
- [x] #21: Parallel address sync in sync.ts (batchWithConcurrency + txDetailCache)
- [x] #22: Extract AccountModal sub-components (643 → 306 lines + 3 sub-components)

## Final State
- TypeScript: Clean (0 errors)
- Tests: **1,560 passing** (64 files)
- Lint: 0 errors (5 pre-existing warnings)
- Coverage: **40.21% line coverage** (up from ~27%)

## Files Modified (across all sessions)

### Security & Bug Fixes
- src/contexts/TokensContext.tsx (B-5)
- src/services/wallet/balance.ts, balance.test.ts (B-6)
- src/domain/transaction/fees.ts, fees.test.ts (S-5, B-11)
- src/services/secureStorage.ts (S-11)
- src/hooks/useWalletLock.ts (S-11)
- src/services/wallet/locks.ts, locks.test.ts (B-10, B-11, B-7)
- src/services/wallet/fees.ts (B-11)
- src/infrastructure/storage/localStorage.ts (S-10)
- src/services/wallet/transactions.ts (S-12)
- src/infrastructure/api/broadcastService.ts (S-14)
- src/services/keyDerivation.ts (S-4)
- src/components/modals/settings/SettingsAdvanced.tsx (S-4)
- src/services/autoLock.ts (S-13)

### Architecture (A-1: brc100 split)
- src/services/brc100.ts (1,502 → 122 lines thin re-export)
- src/services/brc100/outputs.ts (new, 171 lines)
- src/services/brc100/locks.ts (new, 197 lines)
- src/services/brc100/listener.ts (new, 238 lines)
- src/services/brc100/certificates.ts (new, 62 lines)
- src/services/brc100/actions.ts (new, 847 lines)
- src/services/brc100/index.ts (updated barrel exports)

### Result<T,E> Migration (#19)
- src/domain/types.ts (removed SendResult)
- src/services/overlay.ts (minerBroadcast → Result<void, string>)
- src/services/backupRecovery.ts (BackupReadResult → Result)
- src/services/tokens.ts (transferToken/sendToken → Result)
- src/contexts/ConnectedAppsContext.tsx (addTrustedOrigin → Result)
- src/contexts/TokensContext.tsx (sendTokenAction interface)
- src/hooks/useWalletSend.ts (sendTokenAction interface)
- src/services/brc100/actions.ts (broadcastWithOverlay caller)

### Sync Parallelization (#21)
- src/services/sync.ts (batchWithConcurrency, txDetailCache, parallel syncAllAddresses/backfillNullAmounts)

### AccountModal Extraction (#22)
- src/components/modals/AccountModal.tsx (643 → 306 lines)
- src/components/modals/AccountCreateForm.tsx (new, 113 lines)
- src/components/modals/AccountImportForm.tsx (new, 103 lines)
- src/components/modals/AccountManageList.tsx (new, 196 lines)

### New Test Files (#20)
- src/services/overlay.test.ts (36 tests)
- src/infrastructure/api/broadcastService.test.ts (29 tests)
- src/services/tokens.test.ts (28 tests)
- src/services/wallet/ordinals.test.ts (25 tests)
- src/infrastructure/storage/localStorage.test.ts (51 tests)
- src/infrastructure/api/requestCache.test.ts (30 tests)
- src/contexts/ConnectedAppsContext.test.tsx (16 tests)
- src/services/deeplink.test.ts (25 tests)
- src/services/auditLog.test.ts (46 tests)
- src/services/brc100/actions.test.ts (new tests)
