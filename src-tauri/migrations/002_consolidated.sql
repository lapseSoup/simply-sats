-- Migration 2: Consolidated (derived addresses, address column, transaction amount)
-- Combines: 002_transaction_amount.sql, 002_derived_addresses.sql, 002_add_address_to_utxos.sql

-- 1. Add amount column to transactions table
ALTER TABLE transactions ADD COLUMN amount INTEGER;

-- 2. Add address column to utxos table
ALTER TABLE utxos ADD COLUMN address TEXT;

-- 3. Create index for address lookups
CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address);

-- 4. Derived addresses table - tracks receive addresses generated via BRC-42/43
CREATE TABLE IF NOT EXISTS derived_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    sender_pubkey TEXT NOT NULL,          -- The sender's public key (hex)
    invoice_number TEXT NOT NULL,         -- The invoice number used for derivation
    private_key_wif TEXT NOT NULL,        -- WIF for spending (encrypted in production)
    label TEXT,                           -- Optional user label
    created_at INTEGER NOT NULL,
    last_synced_at INTEGER,
    UNIQUE(sender_pubkey, invoice_number) -- Each sender+invoice combination is unique
);

-- 5. Indexes for derived_addresses
CREATE INDEX IF NOT EXISTS idx_derived_addresses_address ON derived_addresses(address);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_sender ON derived_addresses(sender_pubkey);

-- 6. Add 'derived' basket for derived address UTXOs
INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('derived', 'Received via derived addresses (BRC-42/43)', strftime('%s', 'now'));
