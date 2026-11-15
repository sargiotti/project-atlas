// Slice 14: pure rules of the cover pipeline (no DOM). The browser module (coverImage.ts) applies them.
// The server re-checks everything from headers; this is for UX and for the one focal rule used everywhere.
import {
  COVER_FULL_MAX_BYTES, COVER_FULL_MAX_WIDTH, COVER_FULL_MIN_WIDTH, COVER_OG_HEIGHT, COVER_OG_MAX_BYTES, COVER_OG_WIDTH,
  COVER_SMALL_MAX_BYTES, COVER_SMALL_WIDTH,
} from "@atlas/contract";
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS, sniffFormat, type Sniffed, type Size } from "./mapImageRules";

export { MAX_INPUT_BYTES, MAX_INPUT_PIXELS, qualityLadder, resizeSteps, WEBP_QUALITY, JPEG_QUALITY } from "./mapImageRules";
export const FULL_MAX_BYTES = COVER_FULL_MAX_BYTES;
export const SMALL_MAX_BYTES = COVER_SMALL_MAX_BYTES;
export const OG_MAX_BYTES = COVER_OG_MAX_BYTES;
export const OG_SIZE: Size = { width: COVER_OG_WIDTH, height: COVER_OG_HEIGHT };
export const MIN_WIDTH = COVER_FULL_MIN_WIDTH; // 960
export const MIN_HEIGHT = 504; // 80% of the 630 px preview height
export const RECOMMENDED_WIDTH = COVER_FULL_MAX_WIDTH; // 1600: below this is the soft warning
/** Stored picture limits: 4:5 ... 3:1 (w/h). */
export const MIN_ASPECT = 0.8;
export const MAX_ASPECT = 3;
/** Shown ratios (w/h). */
export const RATIO = { card: 2, og: COVER_OG_WIDTH / COVER_OG_HEIGHT, sheet: 8 / 3 } as const;
export type Surface = keyof typeof RATIO;
/** Matches the file input `accept` required by the security checklist (no image/heic on purpose). */
export const COVER_ACCEPT = "image/png,image/jpeg,image/webp,image/avif";

export type Focal = { x: number; y: number };
export const CENTRE: Focal = { x: 0.5, y: 0.5 };
/** Clamps to 0..1 and rounds to 2 decimals (what the server stores). */
export const clampFocal = (x: number, y: number): Focal => {
  const c = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : 0.5);
  return { x: c(x), y: c(y) };
};
/** The one rule everywhere on the web: `object-position: x% y%`. */
export const focalCss = (f: Focal) => `${Math.round(f.x * 100)}% ${Math.round(f.y * 100)}%`;

export type InputErrorKey = "cvErrBig" | "cvErrType" | "cvErrHeic" | "cvErrSmall" | "cvErrDecode" | "cvErrPixels";
export type InputError = { key: InputErrorKey; mb?: number; w?: number; h?: number };

/** Size and real format, from the first bytes (client MIME and filename are never trusted). HEIC passes: Safari may decode it. */
export function validateCoverInput(size: number, head: Uint8Array): { ok: true; format: Sniffed } | { ok: false; error: InputError } {
  if (size > MAX_INPUT_BYTES) return { ok: false, error: { key: "cvErrBig", mb: Math.round((size / 1048576) * 10) / 10 } };
  const format = sniffFormat(head);
  if (format === "png" || format === "jpeg" || format === "webp" || format === "avif" || format === "heic") return { ok: true, format };
  if (format === "unknown") return { ok: false, error: { key: "cvErrDecode" } };
  return { ok: false, error: { key: "cvErrType" } }; // pdf, svg, gif, tiff, bmp
}

/** Decoded pixel size. `soft` = valid but under 1600 px wide (warn, "Use anyway"). */
export function validateCoverDimensions(w: number, h: number): { ok: true; soft: boolean } | { ok: false; error: InputError } {
  if (w * h > MAX_INPUT_PIXELS) return { ok: false, error: { key: "cvErrPixels", w, h } };
  if (w < MIN_WIDTH || h < MIN_HEIGHT) return { ok: false, error: { key: "cvErrSmall", w, h } };
  return { ok: true, soft: w < RECOMMENDED_WIDTH };
}

export type Rect = { sx: number; sy: number; sw: number; sh: number };

/** Largest `ratio` crop of a W x H picture, positioned by the focal point (CSS object-position maths). */
export function cropRect(W: number, H: number, ratio: number, f: Focal): Rect {
  let sw: number, sh: number;
  if (W / H > ratio) {
    sh = H;
    sw = H * ratio;
  } else {
    sw = W;
    sh = W / ratio;
  }
  return { sx: (W - sw) * f.x, sy: (H - sh) * f.y, sw, sh };
}

/** Pictures taller than 4:5 or wider than 3:1 are trimmed around the focal point before they are stored. */
export function trimRect(W: number, H: number, f: Focal): Rect {
  const r = W / H;
  if (r < MIN_ASPECT) return cropRect(W, H, MIN_ASPECT, f);
  if (r > MAX_ASPECT) return cropRect(W, H, MAX_ASPECT, f);
  return { sx: 0, sy: 0, sw: W, sh: H };
}

/**
 * What a surface shows of the ORIGINAL picture: the stored (trimmed) picture, cropped to the surface ratio.
 * The focal point keeps its fraction through the trim, so the same x, y drive both steps.
 */
export function surfaceRect(W: number, H: number, ratio: number, f: Focal): Rect {
  const t = trimRect(W, H, f);
  const c = cropRect(t.sw, t.sh, ratio, f);
  return { sx: t.sx + c.sx, sy: t.sy + c.sy, sw: c.sw, sh: c.sh };
}

/** Size of the stored picture: the trimmed shape, at most 1600 px wide, never upscaled. */
export function fullSize(W: number, H: number, f: Focal = CENTRE): Size {
  const t = trimRect(W, H, f);
  const width = Math.min(RECOMMENDED_WIDTH, Math.round(t.sw));
  return { width, height: Math.max(1, Math.round((width * t.sh) / t.sw)) };
}

/** 800 px wide variant of the stored picture (server: height = round(800 * H / W) +-1). */
export function smallSize(full: Size): Size {
  return { width: COVER_SMALL_WIDTH, height: Math.max(1, Math.round((COVER_SMALL_WIDTH * full.height) / full.width)) };
}

/** True when the picture is taller/wider than what is stored, so only part of it will fit. */
export const needsTrim = (W: number, H: number) => W / H < MIN_ASPECT || W / H > MAX_ASPECT;

/** A JPEG is baseline when it has an SOF0 marker and no progressive SOF2 (crawlers such as WhatsApp need baseline). */
export function isBaselineJpeg(b: Uint8Array): boolean {
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return false;
    const m = b[i + 1]!;
    if (m === 0xc0) return true;
    if (m === 0xc2 || m === 0xc1) return false;
    if (m === 0xff) {
      i += 1;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return false;
}
