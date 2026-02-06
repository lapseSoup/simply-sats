-- Migration 11: Reset transaction amounts (v2)
-- Previous recalculation used UTXO-only lookup which missed spent UTXOs
-- not present in local DB. The updated calculateTxAmount now falls back
-- to fetching parent transactions from the API for accurate net change.

UPDATE transactions SET amount = NULL;
