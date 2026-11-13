/**
 * Minimal JPEG inspector for the OG images (slice 04, B10). Accepts only a plain baseline JPEG:
 * SOI, then DQT / DHT / SOF0 / DRI / APP0 (JFIF) segments, one SOS scan, EOI. Any other segment
 * (APP1 Exif/XMP, APP2 ICC, APP13, COM, progressive SOF2, ...) is rejected, so no metadata (EXIF, XMP,
 * GPS) can ship in a preview image.
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/** Build budget (design spec). The security cap is 300 KB. */
export const OG_BUDGET_BYTES = 200 * 1024;
export const OG_HARD_CAP_BYTES = 300 * 1024;

const ALLOWED = new Set([0xdb, 0xc4, 0xc0, 0xdd, 0xe0]);

export interface JpegInfo {
  width: number;
  height: number;
  bytes: number;
}

export function inspectOgJpeg(buf: Uint8Array, limit = OG_HARD_CAP_BYTES): JpegInfo {
  if (buf.length > limit) throw new Error(`${buf.length} bytes exceeds the ${limit} byte cap`);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG (missing SOI)");
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) throw new Error("missing EOI at end of file");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 2;
  let size: { width: number; height: number } | null = null;
  for (;;) {
    if (i + 4 > buf.length || buf[i] !== 0xff) throw new Error("malformed JPEG segment");
    const marker = buf[i + 1]!;
    const len = view.getUint16(i + 2);
    if (marker === 0xda) {
      if (!size) throw new Error("SOS before SOF0");
      break;
    }
    if (!ALLOWED.has(marker)) {
      throw new Error(`disallowed JPEG segment 0xFF${marker.toString(16).toUpperCase()} (metadata or non-baseline)`);
    }
    if (marker === 0xc0) {
      if (len < 8) throw new Error("malformed SOF0");
      size = { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
    }
    i += 2 + len;
  }
  if (size!.width !== OG_WIDTH || size!.height !== OG_HEIGHT) {
    throw new Error(`expected ${OG_WIDTH}x${OG_HEIGHT}, got ${size!.width}x${size!.height}`);
  }
  return { ...size!, bytes: buf.length };
}
