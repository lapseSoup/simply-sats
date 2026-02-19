-- Add transferred flag to ordinal_cache so transferred ordinals are kept for
-- historical display (activity tab thumbnails, tx detail modal) but excluded
-- from the active ordinals count and ownership list.
-- transferred = 0 (default) → still owned
-- transferred = 1            → transferred out, kept for history/content only
ALTER TABLE ordinal_cache ADD COLUMN transferred INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ordinal_cache_transferred ON ordinal_cache(transferred);
