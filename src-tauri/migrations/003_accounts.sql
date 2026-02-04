-- Migration: Multi-account system
-- Adds support for multiple wallet accounts with separate keys and settings

-- Accounts table - stores account metadata and encrypted keys
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    identity_address TEXT NOT NULL UNIQUE,
    encrypted_keys TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_accessed_at INTEGER
);

-- Account settings table - key-value settings per account
CREATE TABLE IF NOT EXISTS account_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, setting_key)
);

-- Add account_id to utxos (default 1 for existing data)
ALTER TABLE utxos ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;

-- Add account_id to transactions
ALTER TABLE transactions ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;

-- Add account_id to locks
ALTER TABLE locks ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;

-- Add account_id to derived_addresses
-- Note: This may fail if derived_addresses doesn't exist yet, but that's OK
-- The column will be created when derived_addresses is created

-- Add account_id to sync_state
ALTER TABLE sync_state ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;

-- Create indexes for account-scoped queries
CREATE INDEX IF NOT EXISTS idx_utxos_account ON utxos(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_locks_account ON locks(account_id);
CREATE INDEX IF NOT EXISTS idx_sync_state_account ON sync_state(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_accounts_identity ON accounts(identity_address);

-- Add identity basket for identity-related UTXOs
INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('identity', 'Identity-related outputs', strftime('%s', 'now'));
