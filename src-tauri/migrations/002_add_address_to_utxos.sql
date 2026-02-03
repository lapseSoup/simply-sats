-- Add address column to UTXOs table for robust address-based tracking
-- This makes it trivial to know which UTXOs belong to which address

ALTER TABLE utxos ADD COLUMN address TEXT;

-- Create index for address lookups
CREATE INDEX IF NOT EXISTS idx_utxos_address ON utxos(address);

-- Add amount column to transactions if not exists (for tracking sat values)
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we use a workaround
-- This column may already exist from code, but we ensure it's in the schema
