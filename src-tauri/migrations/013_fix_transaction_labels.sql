-- Migration 13: Fix transaction_labels foreign key constraint
-- Migration 009 changed transactions to UNIQUE(txid, account_id) but
-- transaction_labels still had FOREIGN KEY (txid) REFERENCES transactions(txid),
-- which is invalid because txid is no longer unique in transactions.
-- Recreate the table without the broken FK.

CREATE TABLE IF NOT EXISTS transaction_labels_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(txid, label)
);

INSERT OR IGNORE INTO transaction_labels_new (id, txid, label, created_at)
    SELECT id, txid, label, created_at FROM transaction_labels;

DROP TABLE IF EXISTS transaction_labels;

ALTER TABLE transaction_labels_new RENAME TO transaction_labels;
