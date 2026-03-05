-- 033_pcw_tables.sql
-- BRC-109: Peer Cash Wallet protocol tables
CREATE TABLE IF NOT EXISTS pcw_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    satoshis INTEGER NOT NULL,
    denomination INTEGER NOT NULL,
    derivation_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    peer_identity_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(txid, vout)
);
CREATE INDEX IF NOT EXISTS idx_pcw_notes_status ON pcw_notes(status);
CREATE INDEX IF NOT EXISTS idx_pcw_notes_account ON pcw_notes(account_id);

CREATE TABLE IF NOT EXISTS pcw_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_hash TEXT NOT NULL UNIQUE,
    merkle_root TEXT NOT NULL,
    payment_amount INTEGER NOT NULL,
    peer_identity_key TEXT NOT NULL,
    receipt_data TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'received',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pcw_receipts_peer ON pcw_receipts(peer_identity_key);
CREATE INDEX IF NOT EXISTS idx_pcw_receipts_account ON pcw_receipts(account_id);
