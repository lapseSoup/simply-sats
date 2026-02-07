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
