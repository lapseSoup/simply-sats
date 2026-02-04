-- Add columns for tracking pending spend status
-- This prevents UTXO double-spend race conditions where a crash between
-- broadcast and database update could cause UTXOs to be spent twice.

-- spending_status: tracks the state machine of UTXO spending
--   'unspent'  -> UTXO is available for spending
--   'pending'  -> UTXO is being spent (transaction broadcast in progress)
--   'spent'    -> UTXO has been successfully spent

ALTER TABLE utxos ADD COLUMN spending_status TEXT DEFAULT 'unspent' CHECK(spending_status IN ('unspent', 'pending', 'spent'));
ALTER TABLE utxos ADD COLUMN pending_spending_txid TEXT;
ALTER TABLE utxos ADD COLUMN pending_since INTEGER;

-- Index for finding pending UTXOs (for recovery)
CREATE INDEX idx_utxos_pending ON utxos(spending_status) WHERE spending_status = 'pending';
