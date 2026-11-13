/**
 * WebP map validation and metadata stripping. Pure byte-level RIFF handling, no dependencies.
 * A WebP is `RIFF <size> WEBP` followed by chunks `<fourcc> <size LE> <payload> [pad to even]`.
 */
export const MAX_WEBP_BYTES = 4 * 1024 * 1024;
export const MAX_WEBP_PIXELS = 16_000_000;

export function hasWebpMagic(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    String.fromCharCode(...buf.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...buf.subarray(8, 12)) === "WEBP"
  );
}

export interface WebpInfo {
  width: number;
  height: number;
  /** Bytes with EXIF and XMP chunks removed (identical to the input when there were none). */
  cleaned: Buffer;
  strippedChunks: string[];
}

const u24 = (b: Buffer, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const fourcc = (b: Buffer, o: number) => b.toString("latin1", o, o + 4);

/** Dimensions of a single VP8 / VP8L bitstream chunk payload, or null if malformed. */
function bitstreamSize(kind: "VP8 " | "VP8L", p: Buffer): { width: number; height: number } | null {
  if (kind === "VP8 ") {
    if (p.length < 10 || p[3] !== 0x9d || p[4] !== 0x01 || p[5] !== 0x2a) return null;
    return { width: p.readUInt16LE(6) & 0x3fff, height: p.readUInt16LE(8) & 0x3fff };
  }
  if (p.length < 5 || p[0] !== 0x2f) return null;
  const bits = p.readUInt32LE(1);
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
}

/** Parses and validates a WebP. Throws an Error with a clear message when it is not acceptable. */
export function inspectWebp(input: Buffer): WebpInfo {
  if (input.length > MAX_WEBP_BYTES) throw new Error(`WebP is ${input.length} bytes, max ${MAX_WEBP_BYTES}`);
  if (!hasWebpMagic(input)) throw new Error("not a WebP file (bad RIFF/WEBP magic bytes)");
  const riffSize = input.readUInt32LE(4);
  if (riffSize + 8 !== input.length) throw new Error("RIFF size does not match the file length (truncated or trailing data)");

  const kept: Buffer[] = [];
  const stripped: string[] = [];
  let canvas: { width: number; height: number } | null = null;
  let image: { width: number; height: number } | null = null;
  let vp8xIndex = -1;
  let offset = 12;
  while (offset < input.length) {
    if (offset + 8 > input.length) throw new Error("truncated chunk header");
    const id = fourcc(input, offset);
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size & 1);
    if (end > input.length) throw new Error(`chunk ${id} overruns the file`);
    const payload = input.subarray(offset + 8, offset + 8 + size);
    if (id === "VP8X") {
      if (size < 10 || vp8xIndex >= 0) throw new Error("malformed VP8X chunk");
      if (payload[0]! & 0x02) throw new Error("animated WebP is not supported");
      canvas = { width: u24(payload, 4) + 1, height: u24(payload, 7) + 1 };
    } else if (id === "VP8 " || id === "VP8L") {
      if (image) throw new Error("more than one image chunk");
      image = bitstreamSize(id, payload);
      if (!image) throw new Error(`malformed ${id.trim()} header`);
    } else if (id === "ANIM" || id === "ANMF") {
      throw new Error("animated WebP is not supported");
    }
    if (id === "EXIF" || id === "XMP ") {
      stripped.push(id.trim());
    } else {
      if (id === "VP8X") vp8xIndex = kept.length;
      kept.push(input.subarray(offset, end));
    }
    offset = end;
  }

  if (!image) throw new Error("no VP8/VP8L image data");
  const dims = canvas ?? image;
  if (canvas && (canvas.width !== image.width || canvas.height !== image.height)) {
    throw new Error("VP8X canvas size does not match the image data");
  }
  if (dims.width * dims.height > MAX_WEBP_PIXELS) {
    throw new Error(`${dims.width}x${dims.height} exceeds ${MAX_WEBP_PIXELS} pixels`);
  }

  let cleaned = input;
  if (stripped.length) {
    if (vp8xIndex >= 0) {
      const vp8x = Buffer.from(kept[vp8xIndex]!);
      vp8x[8] = vp8x[8]! & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      kept[vp8xIndex] = vp8x;
    }
    const body = Buffer.concat(kept);
    const header = Buffer.alloc(12);
    header.write("RIFF", 0, "latin1");
    header.writeUInt32LE(body.length + 4, 4);
    header.write("WEBP", 8, "latin1");
    cleaned = Buffer.concat([header, body]);
  }
  return { width: dims.width, height: dims.height, cleaned, strippedChunks: stripped };
}
