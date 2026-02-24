-- WARNING: This migration contains DML (data manipulation) statements.
-- Lesson learned: tauri_plugin_sql can hang on DML in migrations.
-- This migration was created before that lesson was discovered.
-- Future migrations should be DDL-only (CREATE/ALTER/DROP).
-- See tasks/lessons.md for details.
--
-- Migration 10: Reset transaction amounts for recalculation
-- The previous calculateTxAmount only counted received outputs (change),
-- producing wrong amounts for sent transactions (e.g. +781 instead of -219).
-- The new logic computes net change (received - spent) via UTXO lookup.
-- NULLing amounts forces recalculation on next sync.

UPDATE transactions SET amount = NULL;
