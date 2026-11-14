import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { inspectMapImage, validateMapPair } from "../src/domain/map-image";

/** Real encoder output (libjpeg / libwebp via sharp), not hand-built bytes. Plain Node: sharp is native. */
const base = () => sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 200, g: 120, b: 60 } } });
const code = (b: Uint8Array) => {
  const r = inspectMapImage(b);
  return r.ok ? "ok" : r.code === "invalid_upload" ? r.reason : r.code;
};

describe("real encoder output", () => {
  it("accepts canvas-like output: JPEG and WebP without metadata", async () => {
    const jpeg = await base().jpeg({ quality: 85 }).toBuffer();
    const webp = await base().webp({ quality: 82 }).toBuffer();
    expect(inspectMapImage(jpeg)).toEqual({ ok: true, info: { format: "jpeg", width: 2400, height: 1800 } });
    expect(inspectMapImage(webp)).toEqual({ ok: true, info: { format: "webp", width: 2400, height: 1800 } });
  });

  it("accepts a progressive JPEG and an ICC profile", async () => {
    expect(code(await base().jpeg({ progressive: true }).toBuffer())).toBe("ok");
    expect(code(await base().withIccProfile("srgb").jpeg().toBuffer())).toBe("ok");
    expect(code(await base().withIccProfile("srgb").webp().toBuffer())).toBe("ok");
  });

  it("rejects a phone-style JPEG with Exif and GPS", async () => {
    const jpeg = await base()
      .jpeg()
      .withExif({ IFD0: { Make: "Apple", Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
      .toBuffer();
    expect(code(jpeg)).toBe("metadata_present");
  });

  it("rejects WebP with Exif or XMP", async () => {
    expect(code(await base().webp().withExif({ IFD0: { Copyright: "me" } }).toBuffer())).toBe("metadata_present");
    expect(code(await base().webp().withXmp("<x:xmpmeta xmlns:x='adobe:ns:meta/'/>").toBuffer())).toBe("metadata_present");
  });

  it("flags truncated real files as corrupt_image", async () => {
    const jpeg = await base().jpeg().toBuffer();
    const webp = await base().webp().toBuffer();
    expect(code(jpeg.subarray(0, jpeg.length - 10))).toBe("corrupt_image");
    expect(code(webp.subarray(0, webp.length - 10))).toBe("corrupt_image");
  });

  it("validates a real full + small pair", async () => {
    const full = await base().webp().toBuffer();
    const small = await base().resize(1200, 900).webp().toBuffer();
    const r = validateMapPair(full, small);
    expect(r.ok).toBe(true);
  });
});
