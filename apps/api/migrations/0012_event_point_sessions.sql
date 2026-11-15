-- Slice 13: Sessions (programme items) of an organizer's event, on the Points of its uploaded map (`event_points`).
-- Additive only: `point_sessions` (seeded events) is untouched. Instants are UTC ISO strings (second precision, Z).
-- Timestamps are unix ms. Rollback: DROP TABLE event_point_sessions (its indexes and triggers go with it), then DROP TRIGGER
-- event_points_category_with_sessions.
CREATE TABLE event_point_sessions (
  id          TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 64),
  event_id    TEXT NOT NULL,
  point_id    TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 300),
  start_utc   TEXT NOT NULL CHECK (length(start_utc) = 20 AND start_utc GLOB '????-??-??T??:??:??Z'),
  end_utc     TEXT NOT NULL CHECK (length(end_utc) = 20 AND end_utc GLOB '????-??-??T??:??:??Z' AND end_utc > start_utc),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (unixepoch(end_utc) - unixepoch(start_utc) <= 86400),
  FOREIGN KEY (event_id, point_id) REFERENCES event_points(event_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_eps_event_point_start ON event_point_sessions(event_id, point_id, start_utc, end_utc, id);

-- Only stage and landmark Points hold Sessions (the write SQL also enforces it; these are the backstop).
CREATE TRIGGER eps_category_insert BEFORE INSERT ON event_point_sessions
WHEN (SELECT category FROM event_points WHERE event_id = NEW.event_id AND id = NEW.point_id) NOT IN ('stage','landmark')
BEGIN SELECT RAISE(ABORT, 'sessions only on stage or landmark points'); END;
CREATE TRIGGER eps_category_update BEFORE UPDATE OF event_id, point_id ON event_point_sessions
WHEN (SELECT category FROM event_points WHERE event_id = NEW.event_id AND id = NEW.point_id) NOT IN ('stage','landmark')
BEGIN SELECT RAISE(ABORT, 'sessions only on stage or landmark points'); END;
CREATE TRIGGER event_points_category_with_sessions BEFORE UPDATE OF category ON event_points
WHEN NEW.category NOT IN ('stage','landmark')
 AND EXISTS (SELECT 1 FROM event_point_sessions WHERE event_id = NEW.event_id AND point_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'point has sessions'); END;
