// Slice 08a: pure rules of the map image pipeline (no DOM). The browser module (mapImage.ts) applies them.
// Server limits come from the contract; the server re-checks everything, this is for UX and for stripping metadata.
import { MAP_FULL_MAX_BYTES, MAP_FULL_MAX_LONG_SIDE, MAP_FULL_MIN_LONG_SIDE, MAP_MAX_ASPECT, MAP_SMALL_MAX_BYTES, MAP_SMALL_MAX_LONG_SIDE } from "@atlas/contract";

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 40_000_000;
export const MIN_SHORT_SIDE = 1000;
export const MIN_LONG_SIDE = MAP_FULL_MIN_LONG_SIDE; // 1600
export const RECOMMENDED_LONG_SIDE = MAP_FULL_MAX_LONG_SIDE; // 2400
/** Largest canvas area per resize step (older iOS Safari fails above ~16.7 MP). */
export const MAX_STEP_PIXELS = 16_777_216;
export const WEBP_QUALITY = 0.82;
export const JPEG_QUALITY = 0.85;
export const MIN_QUALITY = 0.5;
export const FULL_MAX_BYTES = MAP_FULL_MAX_BYTES;
export const SMALL_MAX_BYTES = MAP_SMALL_MAX_BYTES;
/** Matches the file input `accept` required by the security checklist (no image/heic on purpose). */
export const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/avif";

export type Sniffed = "png" | "jpeg" | "webp" | "avif" | "heic" | "gif" | "pdf" | "svg" | "tiff" | "bmp" | "unknown";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

/** Detects the real format from the first bytes (client MIME and filename are never trusted). */
export function sniffFormat(b: Uint8Array): Sniffed {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (HEIC_BRANDS.includes(brand)) return "heic";
  }
  if (ascii(b, 0, 3) === "GIF") return "gif";
  if (ascii(b, 0, 4) === "%PDF") return "pdf";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return "tiff";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  const text = ascii(b, 0, Math.min(b.length, 512)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<") && text.includes("<svg"))) return "svg";
  return "unknown";
}

/** Keys of the hard-error messages (peMapErr*). */
export type InputErrorKey = "errFormatPdf" | "errFormatSvg" | "errFormatOther" | "errHeic" | "errTooBig" | "errTooManyPx" | "errTooSmall" | "errTooNarrow" | "errRatio" | "errDecode";
export type InputError = { key: InputErrorKey; w?: number; h?: number };

/** Checks size and real format. HEIC passes: the browser may still decode it (Safari); the decode step reports errHeic if not. */
export function validateInput(size: number, head: Uint8Array): { ok: true; format: Sniffed } | { ok: false; error: InputError } {
  if (size > MAX_INPUT_BYTES) return { ok: false, error: { key: "errTooBig" } };
  const format = sniffFormat(head);
  if (format === "pdf") return { ok: false, error: { key: "errFormatPdf" } };
  if (format === "svg") return { ok: false, error: { key: "errFormatSvg" } };
  if (format === "gif" || format === "tiff" || format === "bmp") return { ok: false, error: { key: "errFormatOther" } };
  if (format === "unknown") return { ok: false, error: { key: "errDecode" } };
  return { ok: true, format };
}

/** Checks the decoded pixel size. `soft` = valid but under the recommended 2400 px (warn, "Use anyway"). */
export function validateDimensions(w: number, h: number): { ok: true; soft: boolean } | { ok: false; error: InputError } {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (w * h > MAX_INPUT_PIXELS) return { ok: false, error: { key: "errTooManyPx", w, h } };
  if (long < MIN_LONG_SIDE) return { ok: false, error: { key: "errTooSmall", w, h } };
  if (long / short > MAP_MAX_ASPECT) return { ok: false, error: { key: "errRatio", w, h } };
  if (short < MIN_SHORT_SIDE) return { ok: false, error: { key: "errTooNarrow", w, h } };
  return { ok: true, soft: long < RECOMMENDED_LONG_SIDE };
}

export type Size = { width: number; height: number };

/** Target size for a variant: long side capped at `maxLong`, never upscaled. */
export function fitLongSide(w: number, h: number, maxLong: number): Size {
  const long = Math.max(w, h);
  if (long <= maxLong) return { width: w, height: h };
  const s = maxLong / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Full (<= 2400) and small (<= 1200). Small is derived from full so both variants keep the same aspect (server allows +-1 px). */
export function variantSizes(w: number, h: number): { full: Size; small: Size } {
  const full = fitLongSide(w, h, MAP_FULL_MAX_LONG_SIDE);
  return { full, small: fitLongSide(full.width, full.height, MAP_SMALL_MAX_LONG_SIDE) };
}

/** Canvas sizes to draw, from `src` down to `target`: at most halving per step, at most 16.7 MP per canvas. Empty when equal. */
export function resizeSteps(src: Size, target: Size): Size[] {
  const steps: Size[] = [];
  let cur = src;
  for (let guard = 0; (cur.width !== target.width || cur.height !== target.height) && guard < 16; guard++) {
    let f = Math.max(target.width / cur.width, 0.5);
    if (cur.width * f * cur.height * f > MAX_STEP_PIXELS) f = Math.sqrt(MAX_STEP_PIXELS / (cur.width * cur.height));
    const next = { width: Math.max(1, Math.round(cur.width * f)), height: Math.max(1, Math.round(cur.height * f)) };
    // Close enough to the target (or already at/below it): land exactly on it.
    cur = next.width <= target.width * 1.001 ? target : next;
    steps.push(cur);
  }
  return steps;
}

/** Quality ladder: the start value, then down in 0.07 steps to MIN_QUALITY. */
export function qualityLadder(start: number): number[] {
  const q: number[] = [];
  for (let v = start; v >= MIN_QUALITY - 1e-9; v -= 0.07) q.push(Math.round(v * 100) / 100);
  return q;
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** CIE L* (0..100) of one sRGB pixel; alpha is composited over white (transparent = white). */
export function pixelLightness(r: number, g: number, b: number, a = 255): number {
  const k = a / 255;
  const mix = (c: number) => lin(c * k + 255 * (1 - k));
  const Y = 0.2126 * mix(r) + 0.7152 * mix(g) + 0.0722 * mix(b);
  return Y <= 216 / 24389 ? Y * (24389 / 27) : 116 * Math.cbrt(Y) - 16;
}

/** Mean L* of RGBA pixel data (ADR 0008). */
export function meanLightness(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4);
  if (!n) return 100;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += pixelLightness(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!, rgba[i * 4 + 3]!);
  return sum / n;
}

/** ADR 0008: mean L* < 50 = dark; 40..60 = ambiguous, show the "check the map theme" hint. */
export function classifyTheme(meanL: number): { theme: "light" | "dark"; ambiguous: boolean; meanL: number } {
  return { theme: meanL < 50 ? "dark" : "light", ambiguous: meanL >= 40 && meanL <= 60, meanL };
}
