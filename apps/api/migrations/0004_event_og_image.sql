-- Slice 04: link previews. Content-hashed OG image key (`{slug}.{hash8}.jpg`, served from /og/).
-- NULL = no generated image: the page falls back to the brand card. Additive and nullable, so it can
-- be applied before the code that reads it. The key shape is re-checked in code before a URL is built.
ALTER TABLE events ADD COLUMN og_key TEXT CHECK (og_key IS NULL OR length(og_key) <= 80);
