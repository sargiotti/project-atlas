-- Slice 08b: publish with Admin approval (ADR 0012). Additive only, no table rebuild: a rebuild of `events` would
-- cascade-delete event_maps, points, point_sessions and event_map_images, and the old status CHECK cannot be altered in
-- place. The old `status` column is frozen (new code inserts 'draft' and never reads it); a later migration drops it
-- together with idx_events_published_start_slug. Timestamps are unix ms.

-- The default is 'draft' on purpose: an INSERT from old code during the deploy window (which does not know this column)
-- stays hidden. New code writes publish_state explicitly in every INSERT.
ALTER TABLE events ADD COLUMN publish_state TEXT NOT NULL DEFAULT 'draft'
  CHECK (publish_state IN ('draft', 'in_review', 'published', 'rejected', 'unpublished_admin'));
-- Seeded demo events (and anything already published) stay published; existing drafts stay drafts.
UPDATE events SET publish_state = status;

ALTER TABLE events ADD COLUMN requested_at INTEGER;  -- when publish was requested
ALTER TABLE events ADD COLUMN approved_at  INTEGER;  -- when the Admin approved; only while published
ALTER TABLE events ADD COLUMN status_reason TEXT CHECK (status_reason IS NULL OR length(status_reason) <= 200);
-- Already published rows count as approved at their last change, so "edited since approval" starts false.
UPDATE events SET approved_at = updated_at WHERE publish_state = 'published';

-- Public list, link previews, bundle: only used when the query has the literal publish_state = 'published'.
CREATE INDEX idx_events_published_v2 ON events(start_date, slug) WHERE publish_state = 'published';
-- Admin Published list, ordered by last edit.
CREATE INDEX idx_events_pub_updated ON events(updated_at DESC, id) WHERE publish_state = 'published';
-- Admin Pending list and its count: oldest request first.
CREATE INDEX idx_events_pending ON events(requested_at, id) WHERE publish_state = 'in_review';

-- Append-only moderation log. No foreign keys on purpose (the trail outlives an event or an account), no IP, no
-- user agent. The only DELETE is the daily prune of rows older than 365 days.
CREATE TABLE moderation_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'organizer')),
  action     TEXT NOT NULL CHECK (action IN ('request', 'withdraw', 'approve', 'reject', 'unpublish', 'admin_unpublish')),
  from_state TEXT NOT NULL,
  to_state   TEXT NOT NULL,
  reason     TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_moderation_audit_created ON moderation_audit(created_at);
CREATE INDEX idx_moderation_audit_event ON moderation_audit(event_id, created_at);

-- Daily cap of organizer transitions (request, withdraw, unpublish). Same shape as upload_quota. Pruned by the cron.
CREATE TABLE transition_quota (
  organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  day          TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), -- UTC
  count        INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (organizer_id, day)
);
