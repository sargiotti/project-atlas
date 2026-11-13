import { describe, expect, it } from "vitest";
import { COVER_LIMITS, MAX_WEBP_BYTES, hasWebpMagic, inspectWebp } from "../scripts/webp-safety";

const chunk = (id: string, payload: Buffer) => {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  return Buffer.concat([head, payload, Buffer.alloc(payload.length & 1)]);
};
const riff = (...chunks: Buffer[]) => {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};
/** Lossless (VP8L) bitstream header declaring width x height. */
const vp8l = (w: number, h: number) => {
  const p = Buffer.alloc(8);
  p[0] = 0x2f;
  p.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  return chunk("VP8L", p);
};
const vp8x = (w: number, h: number, flags = 0x0c) => {
  const p = Buffer.alloc(10);
  p[0] = flags;
  p.writeUIntLE(w - 1, 4, 3);
  p.writeUIntLE(h - 1, 7, 3);
  return chunk("VP8X", p);
};

describe("inspectWebp", () => {
  it("accepts a simple WebP and reads its dimensions from the header", () => {
    const info = inspectWebp(riff(vp8l(800, 600)));
    expect([info.width, info.height]).toEqual([800, 600]);
    expect(info.strippedChunks).toEqual([]);
  });

  it("strips EXIF and XMP and clears their VP8X flags, keeping the image", () => {
    const input = riff(vp8x(800, 600), vp8l(800, 600), chunk("EXIF", Buffer.from("gps!!")), chunk("XMP ", Buffer.from("<x/>")));
    const info = inspectWebp(input);
    expect(info.strippedChunks).toEqual(["EXIF", "XMP"]);
    expect(info.cleaned.includes(Buffer.from("EXIF"))).toBe(false);
    expect(info.cleaned.includes(Buffer.from("XMP "))).toBe(false);
    expect(info.cleaned.includes(Buffer.from("gps!!"))).toBe(false);
    expect(info.cleaned[20]! & 0x0c).toBe(0);
    // Still a valid WebP of the same size after cleaning.
    const again = inspectWebp(info.cleaned);
    expect([again.width, again.height]).toEqual([800, 600]);
  });

  it("rejects files without RIFF/WEBP magic bytes", () => {
    expect(hasWebpMagic(Buffer.from("<svg></svg>"))).toBe(false);
    expect(() => inspectWebp(Buffer.from("GIF89a-not-a-webp-file"))).toThrow(/magic/);
    const wavLike = riff(vp8l(10, 10));
    wavLike.write("WAVE", 8, "latin1");
    expect(() => inspectWebp(wavLike)).toThrow(/magic/);
  });

  it("rejects files over the byte cap", () => {
    expect(() => inspectWebp(Buffer.alloc(MAX_WEBP_BYTES + 1))).toThrow(/max/);
  });

  it("rejects images over the pixel cap (decompression bomb)", () => {
    expect(() => inspectWebp(riff(vp8x(16000, 16000), vp8l(16000, 16000)))).toThrow(/pixels/);
  });

  it("rejects truncated or inconsistent files", () => {
    const ok = riff(vp8l(100, 100));
    expect(() => inspectWebp(ok.subarray(0, ok.length - 3))).toThrow();
    expect(() => inspectWebp(Buffer.concat([ok, Buffer.from("trailing")]))).toThrow(/RIFF size/);
    expect(() => inspectWebp(riff(vp8x(100, 100), vp8l(50, 50)))).toThrow(/canvas/);
    expect(() => inspectWebp(riff(chunk("EXIF", Buffer.from("x"))))).toThrow(/no VP8/);
  });

  it("rejects animated WebP", () => {
    expect(() => inspectWebp(riff(vp8x(100, 100, 0x02), vp8l(100, 100)))).toThrow(/animated/);
  });

  it("checks the file's own dimensions against the expected ones", () => {
    const cover = riff(vp8l(960, 640));
    const ok = inspectWebp(cover, { ...COVER_LIMITS, expectedWidth: 960, expectedHeight: 640 });
    expect([ok.width, ok.height]).toEqual([960, 640]);
    expect(() => inspectWebp(cover, { ...COVER_LIMITS, expectedWidth: 960, expectedHeight: 600 })).toThrow(/expected 960x600/);
  });

  it("applies the stricter cover caps (4 MP, 1 MB)", () => {
    expect(() => inspectWebp(riff(vp8l(2500, 2000)), COVER_LIMITS)).toThrow(/pixels/);
    expect(() => inspectWebp(Buffer.alloc(COVER_LIMITS.maxBytes + 1), COVER_LIMITS)).toThrow(/max/);
  });
});
