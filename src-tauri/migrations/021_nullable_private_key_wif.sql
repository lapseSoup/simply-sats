-- Migration 021: Make derived_addresses.private_key_wif nullable (S-19)
-- SQLite does not support ALTER COLUMN, so we use the table-rebuild pattern.
-- This mirrors the pattern used in migrations 013 and 018.

CREATE TABLE IF NOT EXISTS derived_addresses_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    sender_pubkey TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    private_key_wif TEXT,
    label TEXT,
    created_at INTEGER NOT NULL,
    last_synced_at INTEGER,
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(sender_pubkey, invoice_number)
);

INSERT OR IGNORE INTO derived_addresses_new
    SELECT id, address, sender_pubkey, invoice_number, private_key_wif, label, created_at, last_synced_at, account_id
    FROM derived_addresses;

DROP TABLE derived_addresses;

ALTER TABLE derived_addresses_new RENAME TO derived_addresses;

CREATE INDEX IF NOT EXISTS idx_derived_addresses_address ON derived_addresses(address);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_sender ON derived_addresses(sender_pubkey);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_account ON derived_addresses(account_id);
