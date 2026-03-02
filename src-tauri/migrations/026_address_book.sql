-- Address book for storing BSV addresses with labels
-- Separate from contacts (which store identity pubkeys for BRC-100)

CREATE TABLE IF NOT EXISTS address_book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL DEFAULT '',
    last_used_at INTEGER NOT NULL,
    use_count INTEGER NOT NULL DEFAULT 1,
    account_id INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_address_book_account ON address_book(account_id);
CREATE INDEX IF NOT EXISTS idx_address_book_last_used ON address_book(last_used_at DESC);
