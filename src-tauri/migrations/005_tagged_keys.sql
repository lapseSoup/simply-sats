-- Migration: Tagged Key Derivation
-- Adds support for app-specific key derivation (BRC-43 compatible)

-- Tagged keys table - stores derived keys for specific apps/labels
CREATE TABLE IF NOT EXISTS tagged_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    label TEXT NOT NULL,                     -- App identifier (e.g., 'yours', 'wrootz')
    key_id TEXT NOT NULL,                    -- Feature identifier within the app
    derivation_path TEXT NOT NULL,           -- Full derivation path used
    public_key TEXT NOT NULL,                -- Hex-encoded public key
    address TEXT,                            -- Optional derived address
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    UNIQUE(account_id, label, key_id)
);

-- Messages table - for encrypted message storage (optional)
CREATE TABLE IF NOT EXISTS encrypted_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    sender_pubkey TEXT NOT NULL,
    recipient_pubkey TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    is_outgoing INTEGER NOT NULL DEFAULT 0,
    read_at INTEGER,
    created_at INTEGER NOT NULL
);

-- Connected apps tracking with permissions
CREATE TABLE IF NOT EXISTS connected_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL,                    -- e.g., 'https://wrootz.com'
    app_name TEXT,
    app_icon TEXT,
    permissions TEXT,                        -- JSON array of granted permissions
    trusted INTEGER NOT NULL DEFAULT 0,      -- Auto-approve requests
    connected_at INTEGER NOT NULL,
    last_used_at INTEGER,
    UNIQUE(account_id, origin)
);

-- Action results for BRC-100 request tracking
CREATE TABLE IF NOT EXISTS action_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    request_id TEXT NOT NULL UNIQUE,
    action_type TEXT NOT NULL,
    origin TEXT,
    txid TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_tagged_keys_account ON tagged_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_tagged_keys_label ON tagged_keys(label);
CREATE INDEX IF NOT EXISTS idx_encrypted_messages_account ON encrypted_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_messages_sender ON encrypted_messages(sender_pubkey);
CREATE INDEX IF NOT EXISTS idx_connected_apps_account ON connected_apps(account_id);
CREATE INDEX IF NOT EXISTS idx_connected_apps_origin ON connected_apps(origin);
CREATE INDEX IF NOT EXISTS idx_action_results_account ON action_results(account_id);
CREATE INDEX IF NOT EXISTS idx_action_results_request ON action_results(request_id);
