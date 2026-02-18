-- Migration 022: Scope sync_state per account
--
-- Previously sync_state had UNIQUE(address), meaning one global record per
-- address across all accounts. This caused stale sync records from a previous
-- install (or previous account IDs) to block re-syncing after a fresh install,
-- leaving the transactions table empty even though the UI showed the wallet
-- as "fully synced".
--
-- Fix: recreate sync_state with UNIQUE(address, account_id) so each account
-- tracks its own sync height per address independently.

-- Step 1: rename old table
ALTER TABLE sync_state RENAME TO sync_state_old;

-- Step 2: create new table with composite unique constraint
CREATE TABLE sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    last_synced_height INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(address, account_id)
);

-- Step 3: migrate existing data (keep it so already-synced accounts stay synced)
INSERT OR IGNORE INTO sync_state (address, last_synced_height, last_synced_at, account_id)
SELECT address, last_synced_height, last_synced_at, account_id FROM sync_state_old;

-- Step 4: drop old table
DROP TABLE sync_state_old;

-- Step 5: rebuild index
CREATE INDEX idx_sync_state_account ON sync_state(account_id);
