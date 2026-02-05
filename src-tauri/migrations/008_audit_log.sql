-- Audit log table for security-sensitive operations
-- Tracks wallet events for security monitoring and debugging

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT, -- JSON blob of action-specific details
    account_id INTEGER,
    origin TEXT, -- For BRC-100 connected app actions
    txid TEXT, -- For transaction-related actions
    ip_address TEXT, -- For HTTP server requests (local only)
    success INTEGER NOT NULL DEFAULT 1, -- Whether the action succeeded
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Index for querying by action type
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- Index for querying by timestamp (for retention cleanup)
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);

-- Index for querying by account
CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log(account_id);

-- Index for querying by origin (connected apps)
CREATE INDEX IF NOT EXISTS idx_audit_log_origin ON audit_log(origin);
