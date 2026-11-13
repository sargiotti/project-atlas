-- Slice 01: read-only visitor map view. Timestamps are unix ms.
CREATE TABLE point_categories (
  key        TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL
);

INSERT INTO point_categories (key, sort_order) VALUES
  ('stage', 0),
  ('food', 1),
  ('drinks', 2),
  ('toilets', 3),
  ('first-aid', 4),
  ('info', 5),
  ('entrance-exit', 6),
  ('merch', 7);

CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  language   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE event_maps (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  theme        TEXT NOT NULL CHECK (theme IN ('light', 'dark')),
  image_key    TEXT NOT NULL,
  image_format TEXT NOT NULL CHECK (image_format IN ('svg', 'webp')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (event_id, position)
);

CREATE TABLE points (
  id          TEXT PRIMARY KEY,
  map_id      TEXT NOT NULL REFERENCES event_maps(id) ON DELETE CASCADE,
  category    TEXT NOT NULL REFERENCES point_categories(key),
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  x           REAL NOT NULL CHECK (x >= 0 AND x <= 1),
  y           REAL NOT NULL CHECK (y >= 0 AND y <= 1),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_points_map_id ON points(map_id);
