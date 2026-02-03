-- Migration: Add derived_addresses table for BRC-42/43 receive addresses
-- These are addresses generated from ECDH shared secrets with known senders

-- Derived addresses table - tracks receive addresses generated via BRC-42/43
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

-- Index for quick address lookups during sync
CREATE INDEX IF NOT EXISTS idx_derived_addresses_address ON derived_addresses(address);
CREATE INDEX IF NOT EXISTS idx_derived_addresses_sender ON derived_addresses(sender_pubkey);

-- Add 'derived' basket for derived address UTXOs
INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('derived', 'Received via derived addresses (BRC-42/43)', strftime('%s', 'now'));
