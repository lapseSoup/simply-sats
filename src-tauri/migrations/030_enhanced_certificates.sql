-- 030_enhanced_certificates.sql
-- BRC-52: Enhanced certificate support with selective disclosure
ALTER TABLE certificates ADD COLUMN master_certificate TEXT;
ALTER TABLE certificates ADD COLUMN keyring TEXT;
ALTER TABLE certificates ADD COLUMN revocation_outpoint TEXT;
ALTER TABLE certificates ADD COLUMN certifier_identity_key TEXT;
ALTER TABLE certificates ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(type);
CREATE INDEX IF NOT EXISTS idx_certificates_certifier ON certificates(certifier);
CREATE INDEX IF NOT EXISTS idx_certificates_account ON certificates(account_id);
