import { z } from "zod";

// --- Slice 14: event cover -----------------------------------------------------------------------
/** Upload limits (browser outputs; the server checks headers and caps only). */
export const COVER_UPLOAD_BODY_LIMIT = 1_310_720; // 1.25 MiB, PUT /cover (multipart)
export const COVER_FOCAL_BODY_LIMIT = 393_216; // 384 KiB, PATCH /cover/focal (multipart)
export const COVER_FULL_MAX_BYTES = 600 * 1024;
export const COVER_SMALL_MAX_BYTES = 200 * 1024;
export const COVER_OG_MAX_BYTES = 300 * 1024;
export const COVER_FULL_MIN_WIDTH = 960;
export const COVER_FULL_MAX_WIDTH = 1600;
export const COVER_SMALL_WIDTH = 800;
export const COVER_OG_WIDTH = 1200;
export const COVER_OG_HEIGHT = 630;
/** Stored picture aspect (w/h): 4:5 ... 3:1. */
export const COVER_MIN_ASPECT = 0.8;
export const COVER_MAX_ASPECT = 3;

/**
 * Same-origin cover files served by the Worker: `/media/covers/{eventId}/{hex32}-full.{webp|jpg}` and `-800.{webp|jpg}` (JPEG when the browser cannot encode WebP; both files share one type).
 * The event id charset includes `_` because seeded demo events are `evt_{slug}`; organizer events are UUIDs.
 */
export const COVER_URL_REGEX = /^\/media\/covers\/[a-z0-9_-]{1,64}\/[0-9a-f]{32}-full\.(?:webp|jpg)$/;
export const COVER_URL800_REGEX = /^\/media\/covers\/[a-z0-9_-]{1,64}\/[0-9a-f]{32}-800\.(?:webp|jpg)$/;

export const focalSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

export const coverImageSchema = z.object({
  /** The full WebP or JPEG (<= 1600 px wide). About sheet and hub. */
  url: z.string().regex(COVER_URL_REGEX, "Invalid cover URL"),
  /** The 800 px wide WebP or JPEG. Home cards use only this one. */
  url800: z.string().regex(COVER_URL800_REGEX, "Invalid cover URL"),
  /** Width and height of the full file. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Point of interest, 0..1. Render as `object-position: x% y%`. */
  focal: focalSchema,
});
export type CoverImage = z.infer<typeof coverImageSchema>;

/** Event tone: index 0-7 of the 8 light tones (see `toneOf`). */
export const toneSchema = z.number().int().min(0).max(7);

export const panelCoverSchema = coverImageSchema.extend({
  /** The full file's token (32 hex): send it back as `baseVersion` when changing only the focal point. */
  version: z.string().regex(/^[0-9a-f]{32}$/),
  updatedAt: z.iso.datetime(),
});
export type PanelCover = z.infer<typeof panelCoverSchema>;
export const panelCoverResponseSchema = z.object({ cover: panelCoverSchema });
export type PanelCoverResponse = z.infer<typeof panelCoverResponseSchema>;

/** `fx` / `fy` text parts: decimal in [0, 1], at most 4 decimals. */
export const FOCAL_PART_REGEX = /^(0|1|0\.\d{1,4}|1\.0{1,4})$/;
