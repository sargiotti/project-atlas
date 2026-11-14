-- Slice 07: organizer events (drafts). Additive and backward compatible: new columns have defaults that keep
-- every existing (seeded demo) event published and ownerless, so it can be applied before the code that uses it.
-- Timestamps stay unix ms.
ALTER TABLE events ADD COLUMN status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published'));
ALTER TABLE events ADD COLUMN owner_id    TEXT REFERENCES organizers(id); -- NULL = seeded demo event
ALTER TABLE events ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 500);
ALTER TABLE events ADD COLUMN website     TEXT CHECK (website IS NULL OR (length(website) <= 200 AND website GLOB 'https://*'));

-- Panel list and the 10-event cap count: bounded by owner.
CREATE INDEX idx_events_owner ON events(owner_id, created_at);
-- Public list and link previews. Only used when the query contains the literal status = 'published'.
CREATE INDEX idx_events_published_start_slug ON events(start_date, slug) WHERE status = 'published';
