-- Migration 023: Enable WAL journal mode
--
-- SQLite's default DELETE journal mode uses exclusive file locking.
-- When any write transaction is open, ALL other connections fail immediately
-- with SQLITE_BUSY. This causes intermittent "database is locked" errors
-- during account discovery Phase 2 when the restore sync and createAccount
-- calls overlap even briefly.
--
-- WAL (Write-Ahead Log) mode eliminates this problem:
--   - Concurrent readers never block writers
--   - Writers don't block readers
--   - Multiple connections can access the DB simultaneously
--   - SQLITE_BUSY only occurs if two writers try to COMMIT at exactly the same time
--
-- This is the standard recommendation for any app with concurrent DB access.
-- WAL mode persists across connections — set once, stays set.
--
-- busy_timeout=30000: if a lock contention does occur, wait up to 30 seconds
-- before giving up instead of failing immediately (busy_timeout=0 default).

PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=30000;
