ALTER TABLE derived_addresses ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_derived_addresses_account ON derived_addresses(account_id);
