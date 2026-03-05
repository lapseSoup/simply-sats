-- 031_pike_contacts.sql
-- BRC-85: PIKE verification status for contacts
CREATE TABLE IF NOT EXISTS identity_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_key TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    pike_verified INTEGER NOT NULL DEFAULT 0,
    pike_verified_at INTEGER,
    first_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    trust_level INTEGER NOT NULL DEFAULT 0,
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(identity_key, account_id)
);
CREATE INDEX IF NOT EXISTS idx_identity_contacts_account ON identity_contacts(account_id);
