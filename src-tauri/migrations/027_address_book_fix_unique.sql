-- Migration 027: Fix address_book UNIQUE constraint
--
-- Previously address_book had UNIQUE(address), meaning one global record per
-- address across all accounts. This caused Account 2 sending to the same
-- address as Account 1 to fire ON CONFLICT and bump use_count on Account 1's
-- row, so Account 2 would never see the address in their book.
--
-- Fix: recreate address_book with UNIQUE(address, account_id) so each account
-- maintains its own address book independently.

-- Step 1: rename old table
ALTER TABLE address_book RENAME TO address_book_old;

-- Step 2: create new table with composite unique constraint
CREATE TABLE address_book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    last_used_at INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1,
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(address, account_id)
);

-- Step 3: migrate existing data
INSERT OR IGNORE INTO address_book (address, label, last_used_at, use_count, account_id)
    SELECT address, label, last_used_at, use_count, account_id FROM address_book_old;

-- Step 4: drop old table
DROP TABLE address_book_old;

-- Step 5: rebuild indexes
CREATE INDEX IF NOT EXISTS idx_address_book_account ON address_book(account_id);
CREATE INDEX IF NOT EXISTS idx_address_book_last_used ON address_book(last_used_at DESC);
