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
