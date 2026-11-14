// Slice 08a: browser pipeline. File -> validated, decoded, resized (no upscale), re-encoded variants + Map Theme.
// Canvas re-encode carries no EXIF/GPS/XMP. Two phases so the UI can show the soft warning between them:
//   inspectImage(file) -> { bitmap, width, height, soft }   (hard errors returned, nothing encoded yet)
//   encodeMap(inspected) -> { full, small, theme, ambiguous, format }
import {
  FULL_MAX_BYTES, JPEG_QUALITY, SMALL_MAX_BYTES, WEBP_QUALITY, classifyTheme, meanLightness, qualityLadder, resizeSteps,
  validateDimensions, validateInput, variantSizes, type InputError, type Size,
} from "./mapImageRules";

type Source = ImageBitmap;
export type Inspected = { bitmap: Source; width: number; height: number; soft: boolean; format: string };
export type Variant = { blob: Blob; width: number; height: number };
export type Encoded = { full: Variant; small: Variant; theme: "light" | "dark"; ambiguous: boolean; format: "webp" | "jpeg"; meanL: number };

// No blob: <img> fallback: the SPA CSP (default-src 'self') blocks it, so a createImageBitmap failure is errDecode/errHeic.
async function decode(file: File): Promise<Source> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

const dims = (s: Source) => ({ w: s.width, h: s.height });

export async function inspectImage(file: File): Promise<{ ok: true; value: Inspected } | { ok: false; error: InputError }> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const v = validateInput(file.size, head);
  if ("error" in v) return { ok: false, error: v.error };
  let src: Source;
  try {
    src = await decode(file);
  } catch {
    return { ok: false, error: { key: v.format === "heic" ? "errHeic" : "errDecode" } };
  }
  const { w, h } = dims(src);
  const d = validateDimensions(w, h);
  if ("error" in d) {
    src.close();
    return { ok: false, error: d.error };
  }
  return { ok: true, value: { bitmap: src, width: w, height: h, soft: d.soft, format: v.format } };
}

function makeCanvas(s: Size) {
  const c = document.createElement("canvas");
  c.width = s.width;
  c.height = s.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; // transparent PNGs become white (also what JPEG needs)
  ctx.fillRect(0, 0, s.width, s.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { c, ctx };
}

/** Resizes stepwise (<= 16.7 MP and <= 2x per step) into a fresh canvas, even when the size is unchanged. */
function resize(src: CanvasImageSource, from: Size, to: Size): HTMLCanvasElement {
  const steps = resizeSteps(from, to);
  if (!steps.length) steps.push(to);
  let cur: CanvasImageSource = src;
  let out!: HTMLCanvasElement;
  for (const s of steps) {
    const { c, ctx } = makeCanvas(s);
    ctx.drawImage(cur, 0, 0, s.width, s.height);
    cur = out = c;
  }
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));

/** Encodes under the byte cap, stepping quality down. null when the browser can't produce `type` or no quality fits. */
async function encodeUnder(c: HTMLCanvasElement, type: "image/webp" | "image/jpeg", cap: number): Promise<Blob | null> {
  for (const q of qualityLadder(type === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY)) {
    const b = await toBlob(c, type, q);
    if (!b || b.type !== type) return null;
    if (b.size <= cap) return b;
  }
  return null;
}

export async function encodeMap(src: Inspected): Promise<{ ok: true; value: Encoded } | { ok: false; error: { key: "errDecode" } }> {
  const sizes = variantSizes(src.width, src.height);
  const fullCanvas = resize(src.bitmap, { width: src.width, height: src.height }, sizes.full);
  const smallCanvas = resize(fullCanvas, sizes.full, sizes.small);
  // Safari can't encode WebP (toBlob returns PNG): the first encode tells, then both variants use JPEG.
  let type: "image/webp" | "image/jpeg" = "image/webp";
  let full = await encodeUnder(fullCanvas, type, FULL_MAX_BYTES);
  if (!full) {
    type = "image/jpeg";
    full = await encodeUnder(fullCanvas, type, FULL_MAX_BYTES);
  }
  const small = full ? await encodeUnder(smallCanvas, type, SMALL_MAX_BYTES) : null;
  src.bitmap.close();
  if (!full || !small) return { ok: false, error: { key: "errDecode" } };
  // Map Theme from a 64 px long-side copy of the small variant (ADR 0008).
  const k = Math.min(1, 64 / Math.max(sizes.small.width, sizes.small.height));
  const probe = makeCanvas({ width: Math.max(1, Math.round(sizes.small.width * k)), height: Math.max(1, Math.round(sizes.small.height * k)) });
  probe.ctx.drawImage(smallCanvas, 0, 0, probe.c.width, probe.c.height);
  const theme = classifyTheme(meanLightness(probe.ctx.getImageData(0, 0, probe.c.width, probe.c.height).data));
  return {
    ok: true,
    value: {
      full: { blob: full, ...sizes.full },
      small: { blob: small, ...sizes.small },
      theme: theme.theme,
      ambiguous: theme.ambiguous,
      meanL: theme.meanL,
      format: type === "image/webp" ? "webp" : "jpeg",
    },
  };
}
