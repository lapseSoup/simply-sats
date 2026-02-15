-- Consolidated schema for fresh installs
-- This represents the final state after all migrations 001-012
-- Used to avoid tauri_plugin_sql hanging on DML in migrations

-- Migration tracking table (matches sqlx format)
CREATE TABLE IF NOT EXISTS _sqlx_migrations (
    version BIGINT PRIMARY KEY,
    description TEXT NOT NULL,
    installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    checksum BLOB NOT NULL,
    execution_time BIGINT NOT NULL
);

-- ==================== CORE TABLES ====================

-- UTXOs table (001 + 002 address + 003 account_id + 006 spending_status)
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
    address TEXT,
    account_id INTEGER NOT NULL DEFAULT 1,
    spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent')),
    pending_spending_txid TEXT,
    pending_since INTEGER,
    UNIQUE(txid, vout)
);

-- UTXO tags (001 + 007 created_at)
CREATE TABLE IF NOT EXISTS utxo_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utxo_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE CASCADE,
    UNIQUE(utxo_id, tag)
);

-- Transactions (001 + 002 amount + 003 account_id + 009 UNIQUE(txid, account_id))
CREATE TABLE IF NOT EXISTS transactions (
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

-- Transaction labels (001 + 007 created_at + 013 removed broken FK + 018 account_id)
CREATE TABLE IF NOT EXISTS transaction_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txid TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(txid, label, account_id)
);

-- Baskets (001)
CREATE TABLE IF NOT EXISTS baskets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL
);

-- Locks (001 + 003 account_id + 014 lock_block)
CREATE TABLE IF NOT EXISTS locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utxo_id INTEGER NOT NULL,
    unlock_block INTEGER NOT NULL,
    lock_block INTEGER,
    ordinal_origin TEXT,
    created_at INTEGER NOT NULL,
    unlocked_at INTEGER,
    account_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE CASCADE
);

-- Certificates (001)
CREATE TABLE IF NOT EXISTS certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    certifier TEXT NOT NULL,
    subject TEXT NOT NULL,
    serial_number TEXT,
    fields TEXT,
    signature TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
);

-- Sync state (001 + 003 account_id)
CREATE TABLE IF NOT EXISTS sync_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    last_synced_height INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 1
);

-- Derived addresses (002 + 016 account_id)
CREATE TABLE IF NOT EXISTS derived_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    sender_pubkey TEXT NOT NULL,
    invoice_number TEXT NOT NULL,
    private_key_wif TEXT NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL,
    last_synced_at INTEGER,
    account_id INTEGER NOT NULL DEFAULT 1,
    UNIQUE(sender_pubkey, invoice_number)
);

-- Accounts (003 + 007 updated_at)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    identity_address TEXT NOT NULL UNIQUE,
    encrypted_keys TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER,
    updated_at INTEGER
);

-- Account settings (003 + 007 updated_at)
CREATE TABLE IF NOT EXISTS account_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, setting_key)
);

-- Tokens (004 + 007 updated_at)
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'BSV20',
    contract_txid TEXT UNIQUE,
    decimals INTEGER NOT NULL DEFAULT 0,
    total_supply TEXT,
    icon_url TEXT,
    name TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
);

-- Token balances (004)
CREATE TABLE IF NOT EXISTS token_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    utxo_id INTEGER NOT NULL,
    amount TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    account_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE CASCADE
);

-- Token transfers (004)
CREATE TABLE IF NOT EXISTS token_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    txid TEXT NOT NULL,
    amount TEXT NOT NULL,
    direction TEXT NOT NULL,
    counterparty TEXT,
    created_at INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE
);

-- Favorite tokens (004)
CREATE TABLE IF NOT EXISTS favorite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    UNIQUE(token_id, account_id)
);

-- Tagged keys (005)
CREATE TABLE IF NOT EXISTS tagged_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,
    key_id TEXT NOT NULL,
    derivation_path TEXT NOT NULL,
    public_key TEXT NOT NULL,
    address TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(account_id, label, key_id)
);

-- Encrypted messages (005)
CREATE TABLE IF NOT EXISTS encrypted_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    sender_pubkey TEXT NOT NULL,
    recipient_pubkey TEXT NOT NULL,
    encrypted_content TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'BRC-78',
    created_at INTEGER NOT NULL,
    read_at INTEGER
);

-- Connected apps (005 + 007 updated_at)
CREATE TABLE IF NOT EXISTS connected_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL,
    name TEXT,
    icon_url TEXT,
    permissions TEXT NOT NULL DEFAULT '[]',
    trust_level TEXT NOT NULL DEFAULT 'ask',
    first_connected_at INTEGER NOT NULL,
    last_used_at INTEGER,
    updated_at INTEGER,
    UNIQUE(account_id, origin)
);

-- Action results (005)
CREATE TABLE IF NOT EXISTS action_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    action TEXT NOT NULL,
    result TEXT,
    error TEXT,
    origin TEXT,
    account_id INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- Audit log (008)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    action TEXT NOT NULL,
    details TEXT,
    account_id INTEGER,
    origin TEXT,
    txid TEXT,
    ip_address TEXT,
    success INTEGER NOT NULL DEFAULT 1
);

-- Ordinal content cache (015)
CREATE TABLE IF NOT EXISTS ordinal_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL UNIQUE,
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    satoshis INTEGER NOT NULL DEFAULT 1,
    content_type TEXT,
    content_hash TEXT,
    content_data BLOB,
    content_text TEXT,
    account_id INTEGER,
    fetched_at INTEGER NOT NULL
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_utxos_basket ON utxos(basket);
CREATE INDEX IF NOT EXISTS idx_utxos_spendable ON utxos(spendable);
CREATE INDEX IF NOT EXISTS idx_utxos_txid ON utxos(txid);
CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address);
CREATE INDEX IF NOT EXISTS idx_utxos_account ON utxos(account_id);
CREATE INDEX IF NOT EXISTS idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transaction_labels_account ON transaction_labels(account_id);
CREATE INDEX IF NOT EXISTS idx_transaction_labels_txid ON transaction_labels(txid);
CREATE INDEX IF NOT EXISTS idx_locks_unlock_block ON locks(unlock_block);
CREATE INDEX IF NOT EXISTS idx_locks_account ON locks(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locks_utxo_id ON locks(utxo_id);
CREATE INDEX IF NOT EXISTS idx_sync_state_address ON sync_state(address);
CREATE INDEX IF NOT EXISTS idx_sync_state_account ON sync_state(account_id);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_address ON derived_addresses(address);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_sender ON derived_addresses(sender_pubkey);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_account ON derived_addresses(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_accounts_identity ON accounts(identity_address);
CREATE INDEX IF NOT EXISTS idx_tagged_keys_account ON tagged_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_tagged_keys_label ON tagged_keys(label);
CREATE INDEX IF NOT EXISTS idx_encrypted_messages_account ON encrypted_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_connected_apps_account ON connected_apps(account_id);
CREATE INDEX IF NOT EXISTS idx_connected_apps_origin ON connected_apps(origin);
CREATE INDEX IF NOT EXISTS idx_action_results_request ON action_results(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_origin ON audit_log(origin);
CREATE INDEX IF NOT EXISTS idx_ordinal_cache_origin ON ordinal_cache(origin);
CREATE INDEX IF NOT EXISTS idx_ordinal_cache_account ON ordinal_cache(account_id);

-- ==================== DEFAULT DATA ====================

INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('default', 'Default spending basket', strftime('%s', 'now')),
    ('ordinals', 'Ordinal inscriptions', strftime('%s', 'now')),
    ('locks', 'Time-locked outputs', strftime('%s', 'now')),
    ('derived', 'Received via derived addresses (BRC-42/43)', strftime('%s', 'now')),
    ('identity', 'Identity-related outputs', strftime('%s', 'now')),
    ('tokens', 'Token outputs', strftime('%s', 'now'));
