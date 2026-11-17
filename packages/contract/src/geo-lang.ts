import { z } from "zod";

/**
 * GET /api/v1/geo-lang (slice 21b): the default UI language suggested for a visitor with no stored choice.
 * `ca` only for visitors in Catalonia; `null` for everyone else and whenever the location is unknown.
 */
export const geoLangSchema = z.object({ lang: z.literal("ca").nullable() }).strict();
export type GeoLang = z.infer<typeof geoLangSchema>;

/** `?geo=` test override: exactly `ct` (pretend Catalonia) or `none` (pretend unknown). Case-insensitive; anything else is ignored. */
export const GEO_OVERRIDE_REGEX = /^(CT|NONE)$/;
