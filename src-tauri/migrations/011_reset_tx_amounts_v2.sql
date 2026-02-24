-- WARNING: This migration contains DML (data manipulation) statements.
-- Lesson learned: tauri_plugin_sql can hang on DML in migrations.
-- This migration was created before that lesson was discovered.
-- Future migrations should be DDL-only (CREATE/ALTER/DROP).
-- See tasks/lessons.md for details.
--
-- Migration 11: Reset transaction amounts (v2)
-- Previous recalculation used UTXO-only lookup which missed spent UTXOs
-- not present in local DB. The updated calculateTxAmount now falls back
-- to fetching parent transactions from the API for accurate net change.

UPDATE transactions SET amount = NULL;
