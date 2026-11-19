-- Slice 31: invite from an access request. Additive only: new columns with defaults (existing rows become 'es' / 'pending')
-- and one new table, so it can be applied before the code that uses it.
-- 'joined' is not stored: it is derived on read (the linked invite was used, or an organizer with that email exists).
ALTER TABLE organizer_requests ADD COLUMN locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('en','es','es-vos','ca','da'));
ALTER TABLE organizer_requests ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','discarded'));
-- Epoch ms, UTC, of the last Invite / Invite again, and the id of the invite created by it (no FK: invites are purged by retention).
ALTER TABLE organizer_requests ADD COLUMN invited_at INTEGER;
ALTER TABLE organizer_requests ADD COLUMN invite_id TEXT;
-- Filtered list (newest first, cursor).
CREATE INDEX idx_organizer_requests_status ON organizer_requests (status, created_at DESC, id DESC);

-- One row per invite email attempt, for the daily cap (20 per UTC day, conditional INSERT ... SELECT). No address, no content.
-- Rows older than 2 days are deleted by the daily cron.
CREATE TABLE invite_email_log (
  invite_id  TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_invite_email_log_created ON invite_email_log (created_at);
