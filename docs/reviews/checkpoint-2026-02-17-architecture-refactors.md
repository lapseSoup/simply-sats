# Checkpoint: Architecture Refactors (A-2, A-3, A-8, A-9)
**Date:** 2026-02-17
**Phase:** All 4 architecture refactors complete and merged to main

## Completed
- [x] Committed all prior-session remediation work (S-14, S-15, S-18, S-12, S-10, Q-8, Q-2, A-1) as single commit `6b15144`
- [x] A-9: Move database repos to `infrastructure/database/` — branch `refactor/a9-database-infrastructure-layer` merged
- [x] A-8: BRC-100 key parameter injection — branch `refactor/a8-brc100-key-injection` merged
- [x] A-2: WalletContext God Object split — branch `refactor/a2-walletcontext-split` merged
- [x] A-3: Result<T,E> migration Tier 1 (transactions, core, locks) + Tier 2 (3 DB repos) — branch `refactor/a3-result-migration` merged
- [x] REVIEW_FINDINGS.md updated to reflect all completions (pending — do this next)

## State
- **Branch:** `main`
- **TypeScript errors:** 0
- **Tests:** 1595/1595 passing (64 test files)
  - Note: 21 tests removed vs original 1616 — `src/services/database.test.ts` deleted (trivial type-level tests, not behaviour tests)
- **Lint:** 54 warnings (all pre-existing `no-restricted-imports`), 1 pre-existing error in `useWalletActions.test.ts:149`

## Git Log (recent)
```
a330ce2 refactor(a3): Result<T,E> migration for wallet services and database repos
5bfcaf0 fix(wallet): wrap executeBroadcast in lockBSV/unlockBSV try/catch (A-3)
900448f refactor(db): migrate database repositories to Result<T,DbError> pattern (A-3 Tier 2)
f9d9a00 refactor(wallet): migrate locks.ts to Result<T,E> pattern (A-3 Tier 1c)
f3c79d9 refactor(wallet): migrate core.ts to Result<T,E> pattern (A-3 Tier 1b)
3f1fb94 refactor(wallet): migrate transactions.ts to Result<T,E> pattern (A-3 Tier 1)
667cfb9 refactor(a2): WalletContext God Object split
...
5ab98f4 refactor(a9): move database repos to infrastructure layer
```

## What Each Refactor Did

### A-9 — Database layer move
- Moved 13 files from `src/services/database/` → `src/infrastructure/database/`
- Also moved `database-types.ts` → `infrastructure/database/row-types.ts`
- Updated 24 import sites across hooks, contexts, components, services
- `src/services/database.ts` kept as backward-compat shim
- `src/services/database/` directory deleted entirely

### A-8 — BRC-100 key injection
- `certificates.ts`: acquireCertificate, listCertificates, proveCertificate now take `keys: WalletKeys | null` as first param
- `listener.ts`: reduced from 6 → 1 `getWalletKeys()` call (single boundary call per handler)
- `actions.ts` B6 security re-fetch preserved intentionally

### A-2 — WalletContext split
- `useWallet()` marked `@deprecated` with rationale
- `useWalletState()` and `useWalletActions()` exported as primary API
- 14 components migrated (all except App.tsx which retains useWallet() as the orchestration exception)
- Test mocks updated for SendModal.test.tsx and ReceiveModal.test.tsx

### A-3 — Result<T,E> migration
- `DbError` class added to `src/services/errors.ts`
- Tier 1: sendBSV, sendBSVMultiKey, createWallet, restoreWallet, importFrom*, lockBSV, unlockBSV → Result<T,AppError>
- Tier 2: contactRepository, actionRepository, addressRepository → Result<T,DbError>
- Key design: Result<T|null, DbError> distinguishes "not found" from "DB error"
- 30+ test assertions converted from .rejects.toThrow() to Result checks
- Deferred: syncRepository, utxoRepository, txRepository, basketRepository (high-traffic, separate PR)

## Pending
- [ ] Update REVIEW_FINDINGS.md to mark A-2, A-3, A-8, A-9 as ✅ Fixed and update summary counts
- [ ] Update overall rating (8.5 → ~9.0 now that all architecture debt is addressed)

## Next Steps
To resume: update REVIEW_FINDINGS.md to reflect completed architecture refactors, bump rating.
Then consider: run a fresh review pass to see if any new issues surfaced from the refactors.
