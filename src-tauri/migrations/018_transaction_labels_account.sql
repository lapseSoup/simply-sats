-- Add account_id to transaction_labels for multi-account isolation
-- Labels were previously global, causing cross-account contamination

CREATE TABLE IF NOT EXISTS transaction_labels_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(txid, label, account_id)
);

INSERT OR IGNORE INTO transaction_labels_new (id, txid, label, created_at, account_id)
    SELECT id, txid, label, created_at, 1 FROM transaction_labels;

DROP TABLE IF EXISTS transaction_labels;
ALTER TABLE transaction_labels_new RENAME TO transaction_labels;

CREATE INDEX IF NOT EXISTS idx_transaction_labels_account ON transaction_labels(account_id);
CREATE INDEX IF NOT EXISTS idx_transaction_labels_txid ON transaction_labels(txid);
