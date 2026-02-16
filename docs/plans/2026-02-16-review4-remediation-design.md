# Review #4 Remediation Design

**Date:** 2026-02-16
**Scope:** All 34+ findings from Review #4 full codebase review
**Approach:** Sequential batches (6 batches), verify after each, parallel subagents within batches
**Baseline:** 0 lint errors, 0 type errors, 1098/1098 tests passing

## Batch 1: Quick Security Fixes (6 items)

All independent, low-risk changes.

| ID | Fix | File | Change |
|----|-----|------|--------|
| C2 | Rate limiter fail-closed | `rateLimiter.ts:44-48,74-78` | Catch → `{ isLimited: true, remainingMs: 30000 }` and `{ isLocked: true, lockoutMs: 60000, attemptsRemaining: 0 }` |
| H2 | Remove "Never" auto-lock | `autoLock.ts:221` | Remove `{ label: 'Never', value: 0 }` from TIMEOUT_OPTIONS |
| H3 | URL encode API params | `wocClient.ts` | Wrap address interpolations with `encodeURIComponent()` |
| M1 | Disable crypto fallback in prod | `crypto.ts:165-167,210-213` | Guard with `import.meta.env.DEV`, throw in production |
| M6 | Scope FS capabilities | `default.json` | Scope `fs:allow-write-text-file`/`read` to `$APPDATA` |
| M4 | Document HMAC key trade-off | `rate_limiter.rs:20` | Add doc comment explaining design choice |

**Verify:** typecheck + lint + test

## Batch 2: Quick Bug Fixes (6 items)

All independent one-liner fixes.

| ID | Fix | File | Change |
|----|-----|------|--------|
| C5 | Global error handler | `main.tsx` | Add `window.addEventListener('unhandledrejection', ...)` |
| H5 | `\|\|` → `??` account IDs | `useWalletSend.ts:70`, `txRepository.ts:393` | Replace `\|\|` with `??`, fix `if (accountId)` to `if (accountId != null)` |
| H6 | Negative balance guard | `wocClient.ts:147` | `Math.max(0, data.confirmed + data.unconfirmed)` |
| M7 | `\|\|` → `??` row mapping | `txRepository.ts:425,459` | `row.amount ?? undefined`, `row.block_height ?? undefined` |
| M8 | Stale locks dedup via ref | `LocksContext.tsx:112` | Add `locksRef = useRef(locks)` for dedup check |
| Low | BASKETS dedup | `sync.ts:128` | Remove local, import from `domain/types.ts` |

**Verify:** typecheck + lint + test

## Batch 3: Medium Bug Fixes (6 items)

Core logic changes requiring careful testing.

| ID | Fix | File | Change |
|----|-----|------|--------|
| C3 | Coin-control WIF | `useWalletSend.ts:59-66` | Look up UTXO address against derived addresses for correct WIF |
| C4 | Account derivation index | `AccountsContext.tsx:155` | Add `derivation_index` column via migration, use instead of DB ID |
| H7 | Sync cancellation | `WalletContext.tsx:230` | Pass cancellation token into `syncPerformSync`, check at key points |
| H8 | Frozen UTXOs repair | `utxoRepository.ts:530-560` | Add `AND frozen = 0` (or track via column) to repair query |
| M9 | Encapsulate transactionDepth | `connection.ts:17` | Move inside queue execution context |
| M10 | Consolidate WocTransaction | `wocClient.ts` + `wallet/types.ts` | Single canonical type in `wallet/types.ts`, import elsewhere |

**Verify:** typecheck + lint + test

## Batch 4: Architecture (7 items)

Larger structural improvements.

| ID | Fix | Summary |
|----|-----|---------|
| H9 | Facade hooks | Create `useDatabase()`, `useCrypto()`, `useOrdinalCache()` hooks. Migrate SettingsModal first. |
| H10 | Batch lock detection | Add `getTransactionDetailsBatch(txids)` with concurrency=5. Refactor `detectLockedUtxos`. |
| H12 | BRC-100 dedup | Extract `resolvePublicKey()` and `resolveListOutputs()` helpers. |
| M11 | WalletContext decomp | Extract 128-line fetchData lock-merge logic to `useLockReconciliation` hook. |
| M13 | Logger dependency | Move `apiLogger` to infrastructure layer or accept logger interface. |
| M14 | SettingsModal split | Break into General, Backup, Security, Debug, Cache sub-components. |
| M12/M15 | Error unification | Adopt `AppError.fromUnknown()` at service boundaries. |

**Verify:** typecheck + lint + test

## Batch 5: Quality & Low Priority (10+ items)

| ID | Fix | Summary |
|----|-----|---------|
| H11 | Test coverage | Tests for `secureStorage.ts`, `brc100/signing.ts`, `certificates.ts`, `backupRecovery.ts`, `wallet/storage.ts` |
| M16 | localStorage migration | Migrate 17 files to use abstraction layer |
| M17 | Render optimization | Use `useWalletState()`/`useWalletActions()` directly |
| Low | handleKeyDown shared | Move to `utils/accessibility.ts` |
| Low | Dead state cleanup | Remove `_messageBoxStatus` |
| Low | Listener cleanup | `cancellableDelay`, toast timeout, `beforeunload` |
| Low | Password validation | Unify creation vs unlock validation |
| Low | getPublicKey CSRF | Add origin validation |
| Low | Grid virtualization | `FixedSizeGrid` for ordinals grid view |
| Low | Inline styles → CSS | Move to stylesheet |

**Verify:** typecheck + lint + test

## Batch 6: C1 WIF Migration (major)

The big architectural change — remove private keys from JavaScript heap.

| Step | Change |
|------|--------|
| 1 | Remove `walletWif`, `ordWif`, `identityWif` from frontend `WalletKeys` type |
| 2 | Create Tauri commands: `send_bsv_from_store`, `lock_bsv_from_store`, `sign_brc100_from_store`, `encrypt_brc100_from_store` |
| 3 | Migrate `useWalletSend.ts` to use `send_bsv_from_store` |
| 4 | Migrate `LocksContext.tsx` to use `lock_bsv_from_store` |
| 5 | Migrate `TokensContext.tsx` |
| 6 | Migrate `brc100/signing.ts` and `brc100/cryptography.ts` |
| 7 | H1: New `export_encrypted_backup_from_store` Tauri command |
| 8 | H4: New `migrate_legacy_wallet` Tauri command (atomic) |
| 9 | M2: Scope SQL capabilities (move critical ops behind Tauri commands) |
| 10 | M3: Use `get_mnemonic_once()` exclusively, remove from React state |
| 11 | M5: Document session token trade-off |

**Verify:** typecheck + lint + test + manual wallet operations test

## Execution Strategy

- Batches 1-2: Parallel subagents (all items independent)
- Batch 3: Sequential with careful testing after each change
- Batch 4: Parallel subagents for independent items (H12, M13, M14 independent; H9, H10, M11 have some dependencies)
- Batch 5: Parallel subagents for tests + localStorage migration
- Batch 6: Sequential (each step depends on previous)
- Verify after every batch: `npm run typecheck && npm run lint && npm run test:run`
