-- Add derivation_index to decouple key derivation from auto-increment DB IDs
ALTER TABLE accounts ADD COLUMN derivation_index INTEGER;
