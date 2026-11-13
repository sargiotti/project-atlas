-- Slice 03: city-level event coordinates, used server-side only to compute `nearby`.
-- Nullable (NULL until seeded); never exposed by the API.
ALTER TABLE events ADD COLUMN latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));
ALTER TABLE events ADD COLUMN longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));
