-- Initial database schema for Simply Sats BRC-100 wallet
-- This creates the foundation for proper UTXO tracking, baskets, and transaction history

-- UTXOs table - tracks all unspent transaction outputs
CREATE TABLE IF NOT EXISTS utxos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    satoshis INTEGER NOT NULL,
    locking_script TEXT NOT NULL,
    basket TEXT NOT NULL DEFAULT 'default',
    spendable INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    spent_at INTEGER,
    spent_txid TEXT,
    UNIQUE(txid, vout)
);

-- Tags for UTXOs (many-to-many relationship)
CREATE TABLE IF NOT EXISTS utxo_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utxo_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE CASCADE,
    UNIQUE(utxo_id, tag)
);

-- Transactions table - tracks all transactions (sent and received)
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL UNIQUE,
    raw_tx TEXT,
    description TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    block_height INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' -- pending, confirmed, failed
);

-- Transaction labels (for categorization)
CREATE TABLE IF NOT EXISTS transaction_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    label TEXT NOT NULL,
    FOREIGN KEY (txid) REFERENCES transactions(txid) ON DELETE CASCADE,
    UNIQUE(txid, label)
);

-- Baskets configuration
CREATE TABLE IF NOT EXISTS baskets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL
);

-- Insert default baskets
INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('default', 'Default spending basket', strftime('%s', 'now')),
    ('ordinals', 'Ordinal inscriptions', strftime('%s', 'now')),
    ('locks', 'Time-locked outputs', strftime('%s', 'now'));

-- Locks table - tracks time-locked outputs (for Wrootz integration)
CREATE TABLE IF NOT EXISTS locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utxo_id INTEGER NOT NULL,
    unlock_block INTEGER NOT NULL,
    ordinal_origin TEXT,
    created_at INTEGER NOT NULL,
    unlocked_at INTEGER,
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE CASCADE
);

-- Certificates table (for BRC-100 identity)
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    certifier TEXT NOT NULL,
    subject TEXT NOT NULL,
    serial_number TEXT,
    fields TEXT, -- JSON blob of certificate fields
    signature TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
);

-- Sync state - tracks blockchain sync progress
CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    last_synced_height INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_utxos_basket ON utxos(basket);
CREATE INDEX IF NOT EXISTS idx_utxos_spendable ON utxos(spendable);
CREATE INDEX IF NOT EXISTS idx_utxos_txid ON utxos(txid);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_locks_unlock_block ON locks(unlock_block);
CREATE INDEX IF NOT EXISTS idx_sync_state_address ON sync_state(address);
