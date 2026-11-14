-- Slice 06: organizer accounts (Google sign-in, invites, sessions). Timestamps are unix ms.
-- Additive only: new tables, nothing existing is touched, so it can be applied before the code that uses it.
-- No passwords anywhere. Tokens (invite, session) are stored only as SHA-256 hex.
CREATE TABLE organizers (
  id           TEXT PRIMARY KEY,
  google_sub   TEXT NOT NULL UNIQUE,
  email        TEXT NOT NULL UNIQUE CHECK (length(email) <= 254),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  role         TEXT NOT NULL CHECK (role IN ('admin', 'organizer')),
  created_at   INTEGER NOT NULL
);

CREATE TABLE invites (
  id                    TEXT PRIMARY KEY,
  token_hash            TEXT NOT NULL UNIQUE,
  email                 TEXT NOT NULL CHECK (length(email) <= 254),
  created_by            TEXT NOT NULL REFERENCES organizers(id),
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER,
  accepted_organizer_id TEXT, -- no FK: the single-use UPDATE runs before the organizer INSERT in the same batch
  revoked_at            INTEGER
);
CREATE INDEX idx_invites_email ON invites(email);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  organizer_id TEXT NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_organizer ON sessions(organizer_id);
