-- Slice 08c: Points of an organizer's event (uploaded map). Additive only: old code ignores the table.
-- Seeded Points stay in `points` (keyed by event_maps); an uploaded map has no event_maps row, so organizer Points
-- are keyed by event. Timestamps are unix ms. Rollback: DROP TABLE event_points.
CREATE TABLE event_points (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  id          TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 64),
  category    TEXT NOT NULL REFERENCES point_categories(key),
  -- NULL = no custom name (clients show the category label in the viewer's language). Only Just-drop categories.
  name        TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  x           REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y           REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (event_id, id),
  CHECK (name IS NOT NULL OR category IN ('toilets', 'first-aid', 'info', 'entrance-exit'))
) WITHOUT ROWID;
