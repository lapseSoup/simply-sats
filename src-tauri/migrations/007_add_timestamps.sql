-- Migration: Add timestamps to tables missing them
-- This ensures consistent timestamp tracking across all tables for auditing and debugging

-- Add created_at to utxo_tags (for tracking when tags were added)
-- SQLite doesn't support adding NOT NULL with default in ALTER, so we use a default value
ALTER TABLE utxo_tags ADD COLUMN created_at INTEGER DEFAULT (strftime('%s', 'now'));

-- Add created_at to transaction_labels
ALTER TABLE transaction_labels ADD COLUMN created_at INTEGER DEFAULT (strftime('%s', 'now'));

-- Add updated_at to account_settings (tracks when settings change)
ALTER TABLE account_settings ADD COLUMN updated_at INTEGER DEFAULT (strftime('%s', 'now'));

-- Add updated_at to accounts (tracks profile/name changes)
ALTER TABLE accounts ADD COLUMN updated_at INTEGER;

-- Add updated_at to tokens (for metadata updates like icon, name changes)
ALTER TABLE tokens ADD COLUMN updated_at INTEGER;

-- Add updated_at to connected_apps (for permission/trust changes)
ALTER TABLE connected_apps ADD COLUMN updated_at INTEGER;
