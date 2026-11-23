-- Slice 44: where an access request came from. Additive and nullable, no backfill: older rows stay NULL.
-- source_ref is a campaign tag (^[a-z0-9-]{1,40}$, validated by zod before insert); page_lang is the language of the page.
ALTER TABLE organizer_requests ADD COLUMN source_ref TEXT;
ALTER TABLE organizer_requests ADD COLUMN page_lang TEXT CHECK (page_lang IS NULL OR page_lang IN ('es','ca','en','da'));
-- Admin counts filter by created_at and group by these.
CREATE INDEX idx_organizer_requests_source ON organizer_requests (created_at, source_ref);
