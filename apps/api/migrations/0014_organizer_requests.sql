-- Slice 30: organizer access requests from the public form. Additive only: one new table.
-- Only the form fields plus id, email_status and created_at. No IP, user agent or Turnstile token is stored.
-- created_at is epoch ms, UTC. Rows older than 365 days are deleted by the daily cron.
CREATE TABLE organizer_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  event_name   TEXT NOT NULL,
  event_date   TEXT,
  city         TEXT,
  role         TEXT,
  message      TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sent','failed','skipped')),
  created_at   INTEGER NOT NULL
);
-- List (newest first, cursor), the global daily cap count (range on created_at) and the retention prune.
CREATE INDEX idx_organizer_requests_created ON organizer_requests (created_at DESC, id DESC);
-- Per-email daily cap.
CREATE INDEX idx_organizer_requests_email ON organizer_requests (email, created_at);
