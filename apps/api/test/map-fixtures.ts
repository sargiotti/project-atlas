/**
 * Structurally valid JPEG and WebP byte streams for the map upload tests. The server never decodes pixels (it reads
 * headers and walks segments / chunks), so these carry real headers and a few bytes of fake entropy data. Pure, no
 * dependencies: usable in workerd and in plain Node.
 */
const enc = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

export interface JpegOptions {
  /** Extra segments inserted after APP0: marker code and payload length. */
  segments?: { marker: number; payload: number[] }[];
  /** Extra entropy bytes (to reach a byte size). */
  pad?: number;
  progressive?: boolean;
  /** Cut the file here (a truncated upload). */
  truncateAt?: number;
  /** Append bytes after EOI. */
  trailing?: number[];
}

const segment = (marker: number, payload: number[]) => [0xff, marker, ...u16be(payload.length + 2), ...payload];

export const EXIF_GPS_PAYLOAD = [...enc("Exif"), 0, 0, ...enc("II*\0"), ...enc("GPSLatitudeRef=N;GPSLatitude=51.5")];

export function fakeJpeg(width: number, height: number, o: JpegOptions = {}): Uint8Array {
  const bytes = [
    0xff, 0xd8,
    ...segment(0xe0, [...enc("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(o.segments ?? []).flatMap((s) => segment(s.marker, s.payload)),
    ...segment(0xdb, [0, ...new Array(64).fill(8)]),
    ...segment(o.progressive ? 0xc2 : 0xc0, [8, ...u16be(height), ...u16be(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...segment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]),
    // Entropy data: includes a stuffed 0xFF00 and a restart marker, which must not be read as segments.
    0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78,
    ...new Array(o.pad ?? 0).fill(0x55),
    0xff, 0xd9,
    ...(o.trailing ?? []),
  ];
  return new Uint8Array(o.truncateAt === undefined ? bytes : bytes.slice(0, o.truncateAt));
}

export interface WebpOptions {
  /** "VP8L" lossless header only; "VP8X" extended header followed by a VP8L chunk. Default VP8L. */
  layout?: "VP8L" | "VP8X";
  exif?: boolean;
  xmp?: boolean;
  /** Set the EXIF flag in VP8X without an EXIF chunk. */
  exifFlagOnly?: boolean;
  icc?: boolean;
  animated?: boolean;
  pad?: number;
  /** Append a chunk with this FourCC (and a small payload) after the image data. */
  extraChunk?: string;
  /** Cut the file here (RIFF size then no longer matches). */
  truncateAt?: number;
}

const chunk = (fourcc: string, payload: number[]) => [...enc(fourcc), ...u32le(payload.length), ...payload, ...(payload.length & 1 ? [0] : [])];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];

export function fakeWebp(width: number, height: number, o: WebpOptions = {}): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  const vp8l = chunk("VP8L", [0x2f, ...u32le(bits >>> 0), ...new Array(8 + (o.pad ?? 0)).fill(0x11)]);
  const extended = o.layout === "VP8X" || o.exif || o.xmp || o.icc || o.animated || o.exifFlagOnly;
  const flags = (o.icc ? 0x20 : 0) | (o.exifFlagOnly ? 0x08 : 0) | (o.exif ? 0x08 : 0) | (o.xmp ? 0x04 : 0) | (o.animated ? 0x02 : 0);
  const body = [
    ...enc("WEBP"),
    ...(extended ? chunk("VP8X", [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]) : []),
    ...(o.icc ? chunk("ICCP", [1, 2, 3, 4]) : []),
    ...vp8l,
    ...(o.exif ? chunk("EXIF", [...enc("Exif"), 0, 0, 1, 2, 3]) : []),
    ...(o.xmp ? chunk("XMP ", enc("<x:xmpmeta/>")) : []),
    ...(o.extraChunk ? chunk(o.extraChunk, [1, 2, 3, 4]) : []),
  ];
  const all = [...enc("RIFF"), ...u32le(body.length), ...body];
  return new Uint8Array(o.truncateAt === undefined ? all : all.slice(0, o.truncateAt));
}
