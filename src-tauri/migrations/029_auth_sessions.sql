-- 029_auth_sessions.sql
-- BRC-103/104: Mutual authentication session tracking
CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    peer_identity_key TEXT NOT NULL,
    session_nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    expires_at INTEGER NOT NULL,
    account_id INTEGER NOT NULL DEFAULT 0,
    UNIQUE(peer_identity_key, session_nonce)
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_peer ON auth_sessions(peer_identity_key);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
