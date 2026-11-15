/**
 * Cover set validation (slice 14). Pure: no I/O, no framework, no decoding. Builds on the 08a byte-level inspector
 * (`inspectMapImage`): magic bytes decide the type, headers give the dimensions, and any leftover metadata, animation,
 * trailing byte or non-baseline JPEG is refused. What it cannot prove (that pixels decode, that the three files show
 * the same picture, image content) is accepted risk, see the slice spec.
 */
import {
  COVER_FULL_MAX_WIDTH,
  COVER_FULL_MIN_WIDTH,
  COVER_MAX_ASPECT,
  COVER_MIN_ASPECT,
  COVER_OG_HEIGHT,
  COVER_OG_WIDTH,
  COVER_SMALL_WIDTH,
  FOCAL_PART_REGEX,
  type InvalidUploadReason,
} from "@atlas/contract";
import { inspectMapImage, type MapImageFailure, type MapImageInfo } from "./map-image";

const bad = (reason: InvalidUploadReason): MapImageFailure & { ok: false } => ({ ok: false, code: "invalid_upload", reason });
const UNSUPPORTED = { ok: false, code: "unsupported_image_type" } as const;

export type CoverSetResult =
  | { ok: true; format: "webp" | "jpeg"; full: MapImageInfo; small: MapImageInfo; og: MapImageInfo }
  | ({ ok: false } & MapImageFailure);

const COVER_OPTS = { animatedReason: "animated_image" } as const;
const OG_OPTS = { baselineOnly: true } as const;

/** `og` must be a baseline JPEG; anything else is 415 by magic bytes. */
function inspectOg(bytes: Uint8Array) {
  const r = inspectMapImage(bytes, OG_OPTS);
  if (!r.ok) return r;
  return r.info.format === "jpeg" ? r : UNSUPPORTED;
}

/** Aspect window 4:5 ... 3:1 with 1 px of slack on the height (rounding in the browser). */
export function aspectInRange(width: number, height: number): boolean {
  return height >= width / COVER_MAX_ASPECT - 1 && height <= width / COVER_MIN_ASPECT + 1;
}

export function validateCoverSet(fullBytes: Uint8Array, smallBytes: Uint8Array, ogBytes: Uint8Array): CoverSetResult {
  // `full` and `small` are WebP or JPEG (Safari cannot encode WebP). JPEG follows the 08a map rules: no metadata
  // markers, no trailing bytes, any SOF; no baseline-only rule. Both must be the same type: the <img> pair is one
  // picture and mixing gains nothing, so a mismatch is 415 like any unexpected type.
  const full = inspectMapImage(fullBytes, COVER_OPTS);
  if (!full.ok) return full;
  const small = inspectMapImage(smallBytes, COVER_OPTS);
  if (!small.ok) return small;
  if (full.info.format !== small.info.format) return UNSUPPORTED;
  const og = inspectOg(ogBytes);
  if (!og.ok) return og;
  const f = full.info;
  const s = small.info;
  if (f.width < COVER_FULL_MIN_WIDTH || f.width > COVER_FULL_MAX_WIDTH) return bad("full_size_out_of_range");
  if (!aspectInRange(f.width, f.height)) return bad("aspect_out_of_range");
  if (s.width !== COVER_SMALL_WIDTH) return bad("small_size_out_of_range");
  if (Math.abs(s.height - Math.round((COVER_SMALL_WIDTH * f.height) / f.width)) > 1) return bad("aspect_mismatch");
  if (og.info.width !== COVER_OG_WIDTH || og.info.height !== COVER_OG_HEIGHT) return bad("og_size_invalid");
  return { ok: true, format: f.format, full: f, small: s, og: og.info };
}

/** The focal-only route sends just the JPEG. */
export function validateOgOnly(ogBytes: Uint8Array): { ok: true; og: MapImageInfo } | ({ ok: false } & MapImageFailure) {
  const og = inspectOg(ogBytes);
  if (!og.ok) return og;
  if (og.info.width !== COVER_OG_WIDTH || og.info.height !== COVER_OG_HEIGHT) return bad("og_size_invalid");
  return { ok: true, og: og.info };
}

/** `fx` / `fy` text part: decimal in [0, 1], at most 4 decimals. Stored rounded to 2 decimals. Null when invalid. */
export function parseFocalPart(raw: unknown): number | null {
  if (typeof raw !== "string" || !FOCAL_PART_REGEX.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? Math.round(n * 100) / 100 : null;
}

export const BASE_VERSION_REGEX = /^[0-9a-f]{32}$/;
