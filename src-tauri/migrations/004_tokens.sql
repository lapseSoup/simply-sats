-- Migration: BSV20 Token Support
-- Adds tables for tracking BSV20/BSV21 tokens and balances

-- Tokens table - metadata about known tokens
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'bsv20', -- bsv20 or bsv21
    contract_txid TEXT,                      -- For BSV21 tokens
    name TEXT,
    decimals INTEGER NOT NULL DEFAULT 0,
    total_supply TEXT,                       -- Use TEXT for BigInt values
    icon_url TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(ticker, protocol)
);

-- Token balances - links tokens to UTXOs
CREATE TABLE IF NOT EXISTS token_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    token_id INTEGER NOT NULL,
    utxo_id INTEGER,
    amount TEXT NOT NULL,                    -- Use TEXT for BigInt values
    status TEXT NOT NULL DEFAULT 'confirmed', -- confirmed, pending, listed
    created_at INTEGER NOT NULL,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    FOREIGN KEY (utxo_id) REFERENCES utxos(id) ON DELETE SET NULL
);

-- Token transfers - history of token movements
CREATE TABLE IF NOT EXISTS token_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    token_id INTEGER NOT NULL,
    txid TEXT NOT NULL,
    amount TEXT NOT NULL,
    direction TEXT NOT NULL,                 -- 'in' or 'out'
    counterparty TEXT,                       -- Address of sender/recipient
    created_at INTEGER NOT NULL,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE
);

-- Favorite tokens per account
CREATE TABLE IF NOT EXISTS favorite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL DEFAULT 1,
    token_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    UNIQUE(account_id, token_id)
);

-- Add tokens basket
INSERT OR IGNORE INTO baskets (name, description, created_at) VALUES
    ('tokens', 'BSV20/BSV21 token outputs', strftime('%s', 'now'));

-- Create indexes for token queries
CREATE INDEX IF NOT EXISTS idx_tokens_ticker ON tokens(ticker);
CREATE INDEX IF NOT EXISTS idx_tokens_protocol ON tokens(protocol);
CREATE INDEX IF NOT EXISTS idx_token_balances_account ON token_balances(account_id);
CREATE INDEX IF NOT EXISTS idx_token_balances_token ON token_balances(token_id);
CREATE INDEX IF NOT EXISTS idx_token_transfers_account ON token_transfers(account_id);
CREATE INDEX IF NOT EXISTS idx_token_transfers_token ON token_transfers(token_id);
CREATE INDEX IF NOT EXISTS idx_token_transfers_txid ON token_transfers(txid);
