CREATE TABLE IF NOT EXISTS ordinal_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL UNIQUE,
    txid TEXT NOT NULL,
    vout INTEGER NOT NULL,
    satoshis INTEGER NOT NULL DEFAULT 1,
    content_type TEXT,
    content_hash TEXT,
    content_data BLOB,
    content_text TEXT,
    account_id INTEGER,
    fetched_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ordinal_cache_origin ON ordinal_cache(origin);
CREATE INDEX IF NOT EXISTS idx_ordinal_cache_account ON ordinal_cache(account_id);
