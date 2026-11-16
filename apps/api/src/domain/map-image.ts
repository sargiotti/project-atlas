/**
 * Byte-level validation of uploaded map variants (slice 08a, ADR 0013). Pure: no I/O, no framework, no decoding.
 * The browser re-encodes into WebP or JPEG; the server only inspects headers and segment/chunk structure:
 * type by magic bytes, dimensions from the headers, and a refusal of any leftover metadata (EXIF, XMP, ...).
 */
import {
  MAP_FULL_MAX_LONG_SIDE,
  MAP_FULL_MIN_LONG_SIDE,
  MAP_MAX_ASPECT,
  MAP_SMALL_MAX_LONG_SIDE,
  type InvalidUploadReason,
} from "@atlas/contract";

export type MapImageFormat = "webp" | "jpeg";

export interface MapImageInfo {
  format: MapImageFormat;
  width: number;
  height: number;
}

export type MapImageFailure =
  | { code: "unsupported_image_type" }
  | { code: "invalid_upload"; reason: InvalidUploadReason };

export type MapImageResult = { ok: true; info: MapImageInfo } | ({ ok: false } & MapImageFailure);

const bad = (reason: InvalidUploadReason): { ok: false; code: "invalid_upload"; reason: InvalidUploadReason } => ({
  ok: false,
  code: "invalid_upload",
  reason,
});
const UNSUPPORTED = { ok: false, code: "unsupported_image_type" } as const;

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function sniffMapImage(b: Uint8Array): MapImageFormat | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  return null;
}

/** Magic bytes first (415), then structure, dimensions and metadata (400 invalid_upload). */
export function inspectMapImage(b: Uint8Array, opts: InspectOptions = {}): MapImageResult {
  const format = sniffMapImage(b);
  if (format === "webp") return inspectWebp(b, opts);
  if (format === "jpeg") return inspectJpeg(b, opts);
  return UNSUPPORTED;
}

/**
 * Slice 14 generalisation. Defaults are the 08a map rules. `animatedReason`: what an animated WebP is reported as
 * (maps: corrupt_image; covers: animated_image). `baselineOnly`: the JPEG must be baseline (SOF0, 8-bit) with only
 * JFIF/ICC application segments (link-preview images: crawlers must be able to read them).
 */
export interface InspectOptions {
  animatedReason?: InvalidUploadReason;
  baselineOnly?: boolean;
}

// --- JPEG ------------------------------------------------------------------------------------
// Allowed APP segments: APP0 (JFIF), APP2 (ICC profile), APP14 (Adobe colour transform, no metadata).
// Known metadata carriers are refused as metadata_present: APP1 (Exif, XMP), APP3-13 (incl. Photoshop APP13), APP15, COM.
// Beyond that this is an allowlist: any other length-carrying marker (unknown, JPG extensions, arithmetic/lossless
// frames, ...) is corrupt_image, so nothing unreviewed can ride along.
const SOF_OK = new Set([0xc0, 0xc1, 0xc2]); // baseline, extended sequential, progressive (Huffman)
// SOF0-2, DHT, DQT, DRI, SOS, DNL, APP0, APP2, APP14
const MARKER_OK = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xda, 0xdc, 0xe0, 0xe2, 0xee]);

// Baseline-only mode: SOF0, DHT, DQT, DRI, SOS, APP0, APP2.
const MARKER_OK_BASELINE = new Set([0xc0, 0xc4, 0xdb, 0xdd, 0xda, 0xe0, 0xe2]);

function inspectJpeg(b: Uint8Array, opts: InspectOptions): MapImageResult {
  const n = b.length;
  let i = 2; // after SOI
  let size: { width: number; height: number } | null = null;
  let sawScan = false;
  while (i < n) {
    // Marker: 0xFF, optional fill 0xFF bytes, then the code.
    if (b[i] !== 0xff) return bad("corrupt_image");
    while (i < n && b[i] === 0xff) i++;
    if (i >= n) return bad("corrupt_image");
    const m = b[i++]!;
    if (m === 0xd9) {
      // EOI: must be the very end, after at least one scan and a frame header.
      return size && sawScan && i === n ? { ok: true, info: { format: "jpeg", ...size } } : bad("corrupt_image");
    }
    if (m === 0x00 || m === 0xd8) return bad("corrupt_image"); // stray stuffing or nested SOI outside a scan
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // standalone markers (TEM, RSTn) carry no length
    if (i + 2 > n) return bad("corrupt_image");
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > n) return bad("corrupt_image");
    if (m === 0xe1 || m === 0xed || m === 0xfe || (m >= 0xe3 && m <= 0xec) || m === 0xef) return bad("metadata_present");
    if (opts.baselineOnly && (m === 0xc1 || m === 0xc2)) return bad("og_not_baseline");
    if (!(opts.baselineOnly ? MARKER_OK_BASELINE : MARKER_OK).has(m)) return bad("corrupt_image");
    if (SOF_OK.has(m)) {
      if (size || len < 8) return bad("corrupt_image");
      if (opts.baselineOnly && b[i + 2] !== 8) return bad("corrupt_image"); // 8-bit samples only
      const height = (b[i + 3]! << 8) | b[i + 4]!;
      const width = (b[i + 5]! << 8) | b[i + 6]!;
      if (width === 0 || height === 0) return bad("corrupt_image");
      size = { width, height };
    }
    i += len;
    if (m === 0xda) {
      if (!size) return bad("corrupt_image");
      sawScan = true;
      // Entropy-coded data: skip to the next real marker (FF followed by neither 00 nor RSTn). indexOf is native.
      for (;;) {
        const p = b.indexOf(0xff, i);
        if (p < 0 || p + 1 >= n) return bad("corrupt_image");
        const next = b[p + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          i = p + 2;
          continue;
        }
        i = p;
        break;
      }
    }
  }
  return bad("corrupt_image"); // ran off the end without EOI: truncated
}

// --- WebP ------------------------------------------------------------------------------------
const u24 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

const WEBP_CHUNKS_OK = new Set(["VP8X", "ICCP", "ALPH", "VP8 ", "VP8L"]);

function inspectWebp(b: Uint8Array, opts: InspectOptions): MapImageResult {
  const n = b.length;
  const animated = opts.animatedReason ?? "corrupt_image";
  if (u32(b, 4) + 8 !== n) return bad("corrupt_image"); // truncated, or trailing bytes after the RIFF
  let i = 12;
  let canvas: { width: number; height: number } | null = null;
  let stream: { width: number; height: number } | null = null;
  while (i < n) {
    if (i + 8 > n) return bad("corrupt_image");
    const kind = ascii(b, i, 4);
    const len = u32(b, i + 4);
    const start = i + 8;
    if (start + len > n) return bad("corrupt_image");
    if (kind === "EXIF" || kind === "XMP ") return bad("metadata_present");
    if (kind === "ANIM" || kind === "ANMF") return bad(animated);
    if (i === 12 && kind !== "VP8X" && kind !== "VP8 " && kind !== "VP8L") return bad("corrupt_image"); // first chunk
    if (!WEBP_CHUNKS_OK.has(kind)) return bad("corrupt_image"); // allowlist: ANIM, ANMF and anything unknown are refused
    if (kind === "VP8X") {
      if (len < 10 || i !== 12) return bad("corrupt_image");
      const flags = b[start]!;
      if (flags & 0x08 || flags & 0x04) return bad("metadata_present"); // EXIF / XMP flags
      if (flags & 0x02) return bad(animated); // animation flag
      canvas = { width: u24(b, start + 4) + 1, height: u24(b, start + 7) + 1 };
    } else if (kind === "VP8 " || kind === "VP8L") {
      if (stream) return bad("corrupt_image");
      if (kind === "VP8 ") {
        if (len < 10 || b[start + 3] !== 0x9d || b[start + 4] !== 0x01 || b[start + 5] !== 0x2a) return bad("corrupt_image");
        stream = { width: (b[start + 6]! | (b[start + 7]! << 8)) & 0x3fff, height: (b[start + 8]! | (b[start + 9]! << 8)) & 0x3fff };
      } else {
        if (len < 5 || b[start] !== 0x2f) return bad("corrupt_image");
        const bits = u32(b, start + 1);
        stream = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
    i = start + len + (len & 1); // chunks are padded to even length
  }
  if (!stream || stream.width === 0 || stream.height === 0) return bad("corrupt_image");
  if (canvas && (canvas.width !== stream.width || canvas.height !== stream.height)) return bad("corrupt_image");
  return { ok: true, info: { format: "webp", ...stream } };
}

// --- The pair --------------------------------------------------------------------------------
type Dims = { width: number; height: number };
const longSide = (d: Dims) => Math.max(d.width, d.height);
const shortSide = (d: Dims) => Math.min(d.width, d.height);
const aspectOk = (d: Dims) => longSide(d) <= MAP_MAX_ASPECT * shortSide(d);

export type MapPairResult =
  | { ok: true; format: MapImageFormat; full: MapImageInfo; small: MapImageInfo }
  | ({ ok: false } & MapImageFailure);

/**
 * Validates the two variants together: each inspected on its own, same encoding, full long side 1600-2400,
 * small long side <= 1200, both aspects within 1:3..3:1, and both variants the same picture shape (+-1 px).
 * The short-side minimum (1000) is a browser-only rule on the input: resized outputs may legitimately be smaller.
 */
export function validateMapPair(fullBytes: Uint8Array, smallBytes: Uint8Array): MapPairResult {
  const full = inspectMapImage(fullBytes);
  if (!full.ok) return full;
  const small = inspectMapImage(smallBytes);
  if (!small.ok) return small;
  const f = full.info;
  const s = small.info;
  if (f.format !== s.format) return bad("mixed_formats");
  if (longSide(f) < MAP_FULL_MIN_LONG_SIDE || longSide(f) > MAP_FULL_MAX_LONG_SIDE) return bad("full_size_out_of_range");
  if (longSide(s) > MAP_SMALL_MAX_LONG_SIDE) return bad("small_size_out_of_range");
  if (!aspectOk(f) || !aspectOk(s)) return bad("aspect_out_of_range");
  const scale = longSide(s) / longSide(f);
  if (Math.abs(s.width - f.width * scale) > 1 || Math.abs(s.height - f.height * scale) > 1) return bad("aspect_mismatch");
  return { ok: true, format: f.format, full: f, small: s };
}
