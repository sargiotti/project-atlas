-- Slice 08d: optional venue address of an event (free text, single line, max 120 characters). Additive only:
-- old code ignores the column. NULL = not set. Rollback: ALTER TABLE events DROP COLUMN venue_address.
ALTER TABLE events ADD COLUMN venue_address TEXT CHECK (venue_address IS NULL OR length(venue_address) BETWEEN 1 AND 120);
