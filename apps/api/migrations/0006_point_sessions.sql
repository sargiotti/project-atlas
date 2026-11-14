-- Slice 09: point sessions (programme; table named point_sessions because `sessions` is the organizer login table) and event time zone. Additive and backward compatible: new columns have
-- defaults, the new table is only read by new code, the new category row is unused until a point uses it.

-- IANA zone and the "festival day" boundary. Set by the seed only. The zone is re-validated with Intl on output.
ALTER TABLE events ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(time_zone) BETWEEN 1 AND 64);
ALTER TABLE events ADD COLUMN day_start TEXT NOT NULL DEFAULT '06:00' CHECK (day_start GLOB '[0-2][0-9]:[0-5][0-9]');

INSERT INTO point_categories (key, sort_order) VALUES ('landmark', 8);

-- Instants are UTC ISO strings (second precision, Z), so they sort and compare as text.
CREATE TABLE point_sessions (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  point_id    TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  start_utc   TEXT NOT NULL CHECK (length(start_utc) = 20 AND start_utc GLOB '????-??-??T??:??:??Z'),
  end_utc     TEXT NOT NULL CHECK (length(end_utc) = 20 AND end_utc GLOB '????-??-??T??:??:??Z' AND end_utc > start_utc),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_point_sessions_event_start ON point_sessions(event_id, start_utc, end_utc, id);
CREATE INDEX idx_point_sessions_point ON point_sessions(point_id);

-- A session's point must belong to the session's event (points reach events through their map).
CREATE TRIGGER point_sessions_same_event_insert BEFORE INSERT ON point_sessions
WHEN (SELECT m.event_id FROM points p JOIN event_maps m ON m.id = p.map_id WHERE p.id = NEW.point_id) IS NOT NEW.event_id
BEGIN
  SELECT RAISE(ABORT, 'session point does not belong to the session event');
END;

CREATE TRIGGER point_sessions_same_event_update BEFORE UPDATE OF event_id, point_id ON point_sessions
WHEN (SELECT m.event_id FROM points p JOIN event_maps m ON m.id = p.map_id WHERE p.id = NEW.point_id) IS NOT NEW.event_id
BEGIN
  SELECT RAISE(ABORT, 'session point does not belong to the session event');
END;
