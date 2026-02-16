-- Add frozen column to distinguish user-frozen UTXOs from broken spendable flags
ALTER TABLE utxos ADD COLUMN frozen INTEGER DEFAULT 0;
