-- Slice 14: event cover. Additive only: one new table, nothing existing is touched.
-- The legacy columns events.cover_key / cover_width / cover_height / og_key are no longer read; they are dropped in 0014
-- (which rebuilds `events` anyway), so no risky DROP COLUMN here. Seeded covers move into R2 + this table (seed script).
-- Timestamps are unix ms. Keys are `covers/{event_id}/{hex32}-{full.webp|800.webp|og.jpg}`; the hex32 tokens are random
-- per upload, never content hashes.
CREATE TABLE event_covers (
  event_id     TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  full_key     TEXT NOT NULL,
  full_width   INTEGER NOT NULL CHECK (full_width > 0),
  full_height  INTEGER NOT NULL CHECK (full_height > 0),
  small_key    TEXT NOT NULL,
  small_width  INTEGER NOT NULL CHECK (small_width > 0),
  small_height INTEGER NOT NULL CHECK (small_height > 0),
  og_key       TEXT NOT NULL,
  focal_x      REAL NOT NULL DEFAULT 0.5 CHECK (focal_x BETWEEN 0 AND 1),
  focal_y      REAL NOT NULL DEFAULT 0.5 CHECK (focal_y BETWEEN 0 AND 1),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
