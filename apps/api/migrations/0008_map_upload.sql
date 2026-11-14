-- Slice 08a: map upload. Additive only: two new tables, nothing existing is touched.
-- event_map_images is separate from event_maps: that table's image_format CHECK excludes jpeg and SQLite cannot
-- alter a CHECK without a rebuild, which would cascade-delete Points. Timestamps are unix ms.
CREATE TABLE event_map_images (
  event_id     TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  theme        TEXT NOT NULL CHECK (theme IN ('light', 'dark')),
  format       TEXT NOT NULL CHECK (format IN ('webp', 'jpeg')),
  full_key     TEXT NOT NULL,
  full_width   INTEGER NOT NULL CHECK (full_width > 0),
  full_height  INTEGER NOT NULL CHECK (full_height > 0),
  small_key    TEXT NOT NULL,
  small_width  INTEGER NOT NULL CHECK (small_width > 0),
  small_height INTEGER NOT NULL CHECK (small_height > 0),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Daily upload quota per organizer (the real cap; the Workers rate limiter is approximate and fails open).
CREATE TABLE upload_quota (
  organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  day          TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), -- UTC
  count        INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (organizer_id, day)
);
