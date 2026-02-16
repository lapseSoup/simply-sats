# Lessons Learned

## Migration Checksums Are Immutable
**Date:** 2025-02-05
**Context:** Modified migration 009 after it had already been applied to the user's database. Added `UPDATE transactions SET amount = NULL` to the existing migration SQL.
**Problem:** `tauri_plugin_sql` stores checksums of applied migrations in `_sqlx_migrations`. When the modified migration's checksum didn't match the stored one, the app hung on launch (spinner forever).
**Rule:** NEVER modify an already-applied migration. Always create a new migration with the next version number for any additional schema or data changes. Migrations are append-only.
**Fix:** Reverted migration 009 to original, created migration 010 for the `UPDATE SET amount = NULL`.

## tauri_plugin_sql Migrations Cannot Contain DML (DELETE/UPDATE/INSERT)
**Date:** 2025-02-05
**Context:** Migration 012 contained `DELETE FROM transactions; DELETE FROM utxos;` etc. to clean up contaminated data.
**Problem:** `tauri_plugin_sql` (v2.3.1) hangs indefinitely when a migration contains DML statements like DELETE, UPDATE, or INSERT. Only DDL (CREATE, ALTER, DROP) works reliably in migrations. The migration runner's transaction handling appears incompatible with DML.
**Rule:** NEVER use DELETE, UPDATE, or INSERT in Tauri SQL migrations. For data cleanup, either: (1) do it in application code after DB init, or (2) use `SELECT 1` as a no-op migration and handle cleanup in the app startup logic.
**Fix:** Changed migration 012 to `SELECT 1;` (no-op) and performed data cleanup manually/via application code.

## Fresh Installs Need Pre-initialized Database
**Date:** 2025-02-06
**Context:** Windows user got stuck on loading spinner on first launch. The app's migrations contain DML (INSERT INTO...SELECT, UPDATE) that hang tauri_plugin_sql.
**Problem:** On a fresh install, ALL migrations run from scratch. Migration 009 (INSERT INTO...SELECT + DROP TABLE), 010/011 (UPDATE), and 001 (INSERT OR IGNORE) all contain DML that can hang the migration runner. Existing installs are unaffected because migrations are already applied.
**Rule:** For fresh installs, pre-create the database with the final consolidated schema and mark all migrations as applied in `_sqlx_migrations`. Use `rusqlite` in a Rust `setup` hook to check if the DB file exists and create it if not.
**Fix:** Added `pre_init_database()` in lib.rs that creates the DB with `fresh_install_schema.sql` and inserts migration records with correct checksums. The tauri_plugin_sql migration runner then sees all migrations as applied and skips them.

## jsdom Realm Mismatch Breaks WebCrypto in Tests
**Date:** 2025-02-06
**Context:** Crypto tests passed locally (macOS) but failed on Ubuntu CI with "2nd argument is not instance of ArrayBuffer".
**Problem:** Vitest's jsdom environment creates a separate JavaScript realm. `ArrayBuffer` from Node.js isn't recognized by jsdom's `SubtleCrypto` as a valid `ArrayBuffer` instance (cross-realm type check). Even copying to a fresh `ArrayBuffer` doesn't help because the constructor itself is from the wrong realm.
**Rule:** Use `// @vitest-environment node` for test files that use Node.js native APIs (crypto, fs, etc.) and don't need DOM access.
**Fix:** Added `// @vitest-environment node` to crypto.test.ts.

## verbatimModuleSyntax Breaks Barrel Re-exports of ESM Packages
**Date:** 2025-02-07
**Context:** Added `js-1sat-ord` marketplace functions to the wallet barrel `index.ts`. `tsc -b` (build mode) failed with "Module has no exported member 'listOrdinal'" when consuming the barrel.
**Problem:** With `verbatimModuleSyntax: true` in tsconfig, barrel re-exports (`export { listOrdinal } from './marketplace'`) silently fail when the source module imports from an ESM package (`js-1sat-ord`) that has complex type exports. The types are visible to `tsc --noEmit` but not to `tsc -b` which respects module boundaries more strictly.
**Rule:** When a module imports from an ESM-only npm package, do NOT re-export it through a barrel file under `verbatimModuleSyntax`. Instead, have consumers import directly from the module path (e.g., `from '../services/wallet/marketplace'`). Add a comment in the barrel explaining why.
**Fix:** Removed marketplace exports from `wallet/index.ts`, imported directly from `wallet/marketplace` in WalletContext.

## Dual @bsv/sdk Versions Require Type Casting at Boundary
**Date:** 2025-02-07
**Context:** `js-1sat-ord` bundles its own `@bsv/sdk` v2.0.1, while the project uses v1.10.3. Both define `PrivateKey` and `Transaction` classes with private fields.
**Problem:** TypeScript considers `PrivateKey` from v1.10.3 incompatible with `PrivateKey` from v2.0.1 because they have different private class members (structural typing doesn't apply to classes with private fields). `tsc -b` rejects passing project keys to js-1sat-ord functions.
**Rule:** When a dependency bundles a different version of a shared peer dep, use `type AnyX = any` aliases and cast at the boundary: `ordPk as AnyPrivateKey`. For return values, use double-cast: `result.tx as unknown as Transaction`. Add a comment explaining the version mismatch.
**Fix:** Added `type AnyPrivateKey = any` and casted at the js-1sat-ord call boundary in `marketplace.ts`.

## CSP connect-src Must Include ALL Fetched Domains (Cross-Platform)
**Date:** 2025-02-08
**Context:** Windows tester got "Unable to sync — data may be stale" error. App worked on macOS.
**Problem:** `https://overlay.babbage.systems` was used in `overlay.ts` KNOWN_OVERLAY_NODES but was missing from the CSP `connect-src` whitelist in `tauri.conf.json`. On Windows (WebView2), CSP violations may cascade differently than on macOS (WebKit). Also, `'self'` resolves to `tauri://localhost` on macOS but `https://tauri.localhost` on Windows — adding explicit `https://tauri.localhost` avoids edge cases.
**Rule:** Every time you add a new external API URL to the codebase, cross-check it against the CSP `connect-src` in `tauri.conf.json`. Grep for `https://` in `src/` and verify all domains are whitelisted. Always test on both macOS and Windows.
**Fix:** Added `https://overlay.babbage.systems` and `https://tauri.localhost` to CSP `connect-src`.

## addUTXO Upsert Must Update account_id
**Date:** 2025-02-10
**Context:** After locking BSV, balance showed 998 sats instead of ~380k. The change UTXO from the lock tx existed in the DB but under `account_id=1` (the default), while the active account was `account_id=23`.
**Problem:** `addUTXO()` upsert (when UTXO already exists by txid:vout) updated `spending_status`, `address`, `spendable`, etc. but NEVER updated `account_id`. UTXOs created before the accountId plumbing fix (commit 94cfa03) defaulted to `account_id=1` via `accountId || 1`. When sync re-discovered them on-chain and called `addUTXO(utxo, 23)`, the UPDATE left `account_id=1`. Then `getSpendableUTXOs(23)` with `WHERE account_id = 23` never found them.
**Rule:** Any upsert function that receives an `accountId` parameter MUST update `account_id` in ALL update branches, not just the INSERT. When debugging balance issues, always check `account_id` in the raw DB — the account the user sees in the UI may differ from the account_id stored on UTXOs.
**Fix:** Added `account_id = $N` to all three UPDATE branches in `addUTXO()`. Debug tip: `accountId=23` not `1` revealed that multi-account support created non-obvious ID values.

## One-Time Migration Hacks Must Be Removed After Migration
**Date:** 2025-02-11
**Context:** `reassignAccountData()` in `utxoRepository.ts` was a one-time hack to migrate data created before `accountId` plumbing was fixed. It blindly runs `UPDATE utxos/transactions/locks/ordinal_cache SET account_id = $targetId WHERE account_id = 1`. It was called from `performSync()` on every sync for non-account-1 accounts.
**Problem:** Once the `accountId` plumbing was fixed (all new data gets correct `account_id`), this function became actively harmful. Every time account 5 synced, it stole ALL of account 1's legitimate data (621 ordinals, 1 lock, all transactions) by reassigning `account_id=1` rows to `account_id=5`. This caused cross-account data leakage that persisted across multiple fix attempts.
**Rule:** One-time data migration functions MUST be (1) guarded by a flag/setting so they only run once, or (2) removed immediately after the migration is complete. Never leave a blanket `UPDATE WHERE account_id = 1` running on every sync — it will steal legitimate account 1 data after the migration is done.
**Fix:** Removed the `reassignAccountData` call from `performSync()`. The accountId plumbing is now correct throughout, so new data gets the right account_id from the start.

## Fallback SQL Without account_id Causes Cross-Account Theft
**Date:** 2025-02-11
**Context:** Added a fallback UPDATE to `addTransaction()` that matched transactions without an `account_id` constraint, intended to handle legacy rows that had wrong account_ids.
**Problem:** The fallback `UPDATE transactions SET ... WHERE txid = $2 AND (block_height IS NULL OR status = 'pending')` matched ANY pending transaction across ALL accounts. Lock/unlock transactions from account 1 got grabbed by account 5 during its sync.
**Rule:** NEVER write fallback SQL queries that drop the `account_id` constraint. If a row can't be matched with the correct `account_id`, it belongs to a different account and must not be touched. Fix the root cause of wrong `account_id` values instead of broadening the WHERE clause.
**Fix:** Removed the fallback UPDATE. The primary UPDATE with `account_id = $3` is sufficient now that the accountId plumbing is correct.

## Optional accountId Parameters Cause Silent Cross-Account Leaks
**Date:** 2025-02-11
**Context:** `getTransactionByTxid(txid, accountId?)` and `getTransactionLabels(txid)` had optional/missing accountId parameters. When callers forgot to pass accountId, the functions returned data from ANY account.
**Problem:** 6 call sites across sync.ts, WalletContext.tsx, and TransactionDetailModal.tsx called these functions without accountId. This meant: (1) transaction detail modals could show wrong account's data, (2) label updates could corrupt labels globally, (3) lock labeling in WalletContext fetched/modified transactions across accounts.
**Rule:** Multi-account repository functions that query by txid MUST require accountId as a non-optional parameter. Use `accountId: number` not `accountId?: number`. The TypeScript compiler then forces every caller to provide it — no silent fallbacks. For functions where schema lacks account_id (like transaction_labels), use a JOIN through the parent table.
**Fix:** Made `getTransactionByTxid(txid, accountId: number)` required. Added accountId params to `getTransactionLabels` and `updateTransactionLabels` with JOIN-based ownership validation. Fixed all 6 callers.

## Always Commit to Main Unless Told Otherwise
**Date:** 2026-02-15
**Context:** Reverted a commit to main unnecessarily when user said "no commit to the main branch" — they meant "no, commit to main" not "don't commit to main."
**Rule:** Default workflow is committing directly to main. Only use feature branches if the user explicitly requests a different route.

## withTransaction() Can Deadlock When Sync Operations Hold the Queue
**Date:** 2026-02-16
**Context:** Account switching failed with "Please unlock wallet to switch accounts" for 6 fix attempts. All 5 prior fixes targeted the session password propagation (React state, useRef, module-level store, Rust mnemonic derivation). The ACTUAL root cause was `switchAccount()` in `accounts.ts` using `withTransaction()` which deadlocked because sync operations held the transaction queue.
**Problem:** `withTransaction()` uses a Promise queue to serialize DB transactions. When a sync operation is mid-transaction and the user clicks "switch account", `switchAccountDb()` also calls `withTransaction()`, which waits in the queue. If the sync's cancellation token fires but the DB operation is already in-flight, the queue can deadlock. The switch times out or errors, returns `false`, and the UI shows a misleading "unlock wallet" toast.
**Rule:** (1) For simple DB operations (account switching, flag updates), use direct `database.execute()` without `withTransaction()`. SQLite auto-commits each statement. (2) When debugging, add visible diagnostic output (toast messages, not just console.log) so release builds can be diagnosed. (3) After 3+ failed fixes, STOP assuming the root cause and add diagnostic instrumentation to find the ACTUAL failure point. The bug was never about passwords — it was about database contention.
**Fix:** Replaced `withTransaction(async () => { UPDATE; UPDATE; })` with two sequential `database.execute()` calls. Also added `getLastSwitchDiag()` diagnostic infrastructure for future debugging.
