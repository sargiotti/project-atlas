// Slice 14: browser pipeline for covers. File -> validated, decoded bitmap -> three re-encoded files (canvas re-encode
// carries no EXIF/GPS/XMP). Everything stays in memory: no localStorage, IndexedDB or blob: URLs (the CSP blocks them).
//   inspectCover(file)           -> { bitmap, width, height, soft, format }  (hard errors returned, nothing encoded)
//   encodeCover(bitmap, focal)   -> { full, small, og } blobs (WebP, WebP 800, baseline JPEG 1200x630 with the badge)
//   refocusOg(storedUrl, focal)  -> the JPEG only, re-rendered from the stored full WebP (same origin, untainted canvas)
//   drawCrop(canvas, bitmap, ratio, focal) -> local previews (createImageBitmap -> <canvas>, no CSP change)
import {
  FULL_MAX_BYTES, JPEG_QUALITY, OG_MAX_BYTES, OG_SIZE, SMALL_MAX_BYTES, WEBP_QUALITY, fullSize, isBaselineJpeg, qualityLadder,
  resizeSteps, smallSize, surfaceRect, trimRect, validateCoverDimensions, validateCoverInput, type Focal, type InputError,
} from "./coverRules";

export type Inspected = { bitmap: ImageBitmap; width: number; height: number; soft: boolean; format: string };
export type CoverFiles = { full: Blob; small: Blob; og: Blob; width: number; height: number };

// No blob: <img> fallback: the SPA CSP (default-src 'self') blocks it, so a createImageBitmap failure is errDecode/errHeic.
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

export async function inspectCover(file: File): Promise<{ ok: true; value: Inspected } | { ok: false; error: InputError }> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const v = validateCoverInput(file.size, head);
  if ("error" in v) return { ok: false, error: v.error };
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    return { ok: false, error: { key: v.format === "heic" ? "cvErrHeic" : "cvErrDecode" } };
  }
  const d = validateCoverDimensions(bitmap.width, bitmap.height);
  if ("error" in d) {
    bitmap.close();
    return { ok: false, error: d.error };
  }
  return { ok: true, value: { bitmap, width: bitmap.width, height: bitmap.height, soft: d.soft, format: v.format } };
}

function makeCanvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs become white (also what JPEG needs)
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

/** Local preview: the part of `src` that a surface of `ratio` shows at focal `f`, drawn on `canvas` (its pixel size is kept). */
export function drawCrop(canvas: HTMLCanvasElement, src: CanvasImageSource & { width: number; height: number }, ratio: number, f: Focal) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const r = surfaceRect(src.width, src.height, ratio, f);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
}

/** Stepwise resize (<= 16.7 MP and <= 2x per step) of a source rect into a fresh canvas of `to` size. */
function resizeRect(src: CanvasImageSource & { width: number; height: number }, rect: { sx: number; sy: number; sw: number; sh: number }, to: { width: number; height: number }) {
  const first = makeCanvas(Math.round(rect.sw), Math.round(rect.sh));
  first.ctx.drawImage(src, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, first.c.width, first.c.height);
  let cur: HTMLCanvasElement = first.c;
  for (const s of resizeSteps({ width: cur.width, height: cur.height }, to)) {
    const n = makeCanvas(s.width, s.height);
    n.ctx.drawImage(cur, 0, 0, s.width, s.height);
    cur = n.c;
  }
  return cur;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));

let webpSupport: Promise<boolean> | undefined;
/** Safari can't encode WebP from a canvas (toBlob silently returns PNG): probe once with a tiny canvas. */
export function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= toBlob(makeCanvas(2, 2).c, "image/webp", 0.8).then((b) => !!b && b.type === "image/webp", () => false);
  return webpSupport;
}

/** Encodes under the byte cap, stepping quality down. null when the browser can't produce `type` or no quality fits. */
async function encodeUnder(c: HTMLCanvasElement, type: "image/webp" | "image/jpeg", cap: number): Promise<Blob | null> {
  for (const q of qualityLadder(type === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY)) {
    const b = await toBlob(c, type, q);
    if (!b || b.type !== type) return null; // e.g. Safari can't encode WebP: toBlob returns PNG
    if (b.size <= cap) return b;
  }
  return null;
}

let badge: Promise<ImageBitmap | null> | undefined;
/** The Atlas badge of link previews (slice 04), drawn at (299, 546), same position as the build-time tone-og images (apps/api/scripts/og-image.ts); the Worker draws no badge at runtime. Same-origin static file; a failure just skips it. */
function loadBadge() {
  badge ??= fetch("/cover-badge.png")
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("badge"))))
    .then((b) => createImageBitmap(b))
    .catch(() => null);
  return badge;
}

/** 1200x630 baseline JPEG: the stored picture cropped by the focal rule, then the badge. */
async function renderOg(stored: CanvasImageSource & { width: number; height: number }, f: Focal): Promise<Blob | null> {
  const out = resizeRect(stored, surfaceRect(stored.width, stored.height, OG_SIZE.width / OG_SIZE.height, f), OG_SIZE);
  const b = await loadBadge();
  if (b) out.getContext("2d")!.drawImage(b, 299, 546, 168, 72);
  const blob = await encodeUnder(out, "image/jpeg", OG_MAX_BYTES);
  if (!blob) return null;
  return isBaselineJpeg(new Uint8Array(await blob.arrayBuffer())) ? blob : null;
}

/** Full (<= 1600 wide, trimmed to 4:5..3:1 around the focal point), 800 wide small (both WebP, or both JPEG where the
 *  browser can't encode WebP), and the og JPEG. ok:false = a real failure (no quality fits the caps, not baseline). */
export async function encodeCover(src: ImageBitmap, f: Focal): Promise<{ ok: true; value: CoverFiles } | { ok: false }> {
  const size = fullSize(src.width, src.height, f);
  const fullCanvas = resizeRect(src, trimRect(src.width, src.height, f), size);
  const sm = smallSize(size);
  const smallCanvas = resizeRect(fullCanvas, { sx: 0, sy: 0, sw: size.width, sh: size.height }, sm);
  const type = (await canEncodeWebp()) ? "image/webp" : "image/jpeg";
  const full = await encodeUnder(fullCanvas, type, FULL_MAX_BYTES);
  const small = full ? await encodeUnder(smallCanvas, type, SMALL_MAX_BYTES) : null;
  const og = full && small ? await renderOg(fullCanvas, f) : null;
  if (!full || !small || !og) return { ok: false };
  return { ok: true, value: { full, small, og, width: size.width, height: size.height } };
}

/** Same-origin fetch of the stored full picture as a bitmap (refocus and replace-preview). null on any failure. */
export async function loadStored(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

/** Focal-only change: re-renders just the JPEG from the stored picture (the WebP files stay as they are). */
export async function refocusOg(stored: ImageBitmap, f: Focal): Promise<Blob | null> {
  return renderOg(stored, f);
}
