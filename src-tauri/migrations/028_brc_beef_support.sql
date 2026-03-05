-- 028_brc_beef_support.sql
-- BRC-62/95: Store BEEF-formatted transaction data alongside raw tx
ALTER TABLE transactions ADD COLUMN beef_data BLOB;
