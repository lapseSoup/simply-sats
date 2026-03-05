-- 032_basket_enhancements.sql
-- BRC-46: Track relinquished outputs
ALTER TABLE utxos ADD COLUMN relinquished INTEGER NOT NULL DEFAULT 0;
