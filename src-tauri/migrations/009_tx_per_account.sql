-- Migration 9: Per-account transaction uniqueness
-- Allows the same blockchain transaction to exist in multiple accounts
-- (sender sees negative amount, receiver sees positive amount)

-- SQLite doesn't support DROP CONSTRAINT, so recreate the table
CREATE TABLE transactions_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    raw_tx TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    block_height INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    amount INTEGER,
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(txid, account_id)
);

INSERT INTO transactions_new SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
