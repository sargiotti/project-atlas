-- Slice 32: Terms of use acceptance, recorded when an invite is accepted. Additive and nullable, no backfill:
-- the first Admin and every account created before this slice stay NULL, and nothing treats NULL as blocked.
-- terms_version is the TERMS_VERSION constant of packages/contract; terms_accepted_at is epoch ms, UTC.
ALTER TABLE organizers ADD COLUMN terms_version TEXT;
ALTER TABLE organizers ADD COLUMN terms_accepted_at INTEGER;
