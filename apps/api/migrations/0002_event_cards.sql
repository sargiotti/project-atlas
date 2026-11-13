-- Slice 02: event cards. Cover is optional (NULL until the image exists); city/country are
-- filled by the seed (DEFAULT '' only exists so ALTER TABLE works on rows already stored).
ALTER TABLE events ADD COLUMN city TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN cover_key TEXT;
ALTER TABLE events ADD COLUMN cover_width INTEGER;
ALTER TABLE events ADD COLUMN cover_height INTEGER;

-- Matches the list ORDER BY so LIMIT 50 reads at most 50 rows.
CREATE INDEX idx_events_start_slug ON events(start_date, slug);
