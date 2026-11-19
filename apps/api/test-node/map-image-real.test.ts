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
  it("accepts canvas-like output: JPEG and WebP without metadata, and a full + small pair", async () => {
    const jpeg = await base().jpeg({ quality: 85 }).toBuffer();
    const webp = await base().webp({ quality: 82 }).toBuffer();
    expect(inspectMapImage(jpeg)).toEqual({ ok: true, info: { format: "jpeg", width: 2400, height: 1800 } });
    expect(inspectMapImage(webp)).toEqual({ ok: true, info: { format: "webp", width: 2400, height: 1800 } });
    const small = await base().resize(1200, 900).webp().toBuffer();
    expect(validateMapPair(webp, small).ok).toBe(true);
  });

  it("rejects a phone-style JPEG with Exif and GPS", async () => {
    const jpeg = await base()
      .jpeg()
      .withExif({ IFD0: { Make: "Apple", Model: "iPhone 15" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 0/1" } })
      .toBuffer();
    expect(code(jpeg)).toBe("metadata_present");
  });
});
