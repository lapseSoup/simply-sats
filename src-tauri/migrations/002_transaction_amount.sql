-- Add amount column to transactions table
-- This stores the net satoshis for each transaction (positive = received, negative = sent)
-- Having this cached avoids needing to fetch from WhatsOnChain on every app load

ALTER TABLE transactions ADD COLUMN amount INTEGER;
