import { describe, expect, it } from "vitest";
import { inspectMapImage, validateMapPair } from "./map-image";
import { EXIF_GPS_PAYLOAD, fakeJpeg, fakeWebp } from "../../test/map-fixtures";

const code = (r: ReturnType<typeof inspectMapImage>) => (r.ok ? "ok" : r.code === "invalid_upload" ? r.reason : r.code);
const pairCode = (r: ReturnType<typeof validateMapPair>) => (r.ok ? "ok" : r.code === "invalid_upload" ? r.reason : r.code);

describe("type by magic bytes only", () => {
  it("rejects SVG, HTML, PNG, GIF and empty input as unsupported", () => {
    for (const text of ["<svg xmlns='http://www.w3.org/2000/svg'/>", "<html></html>", "GIF89a....", ""]) {
      expect(code(inspectMapImage(new TextEncoder().encode(text)))).toBe("unsupported_image_type");
    }
    expect(code(inspectMapImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])))).toBe("unsupported_image_type");
  });

  it("rejects AVIF/HEIC (ISO base media) as unsupported", () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
    expect(code(inspectMapImage(heic))).toBe("unsupported_image_type");
  });
});

describe("dimensions come from the headers", () => {
  it("reads WebP lossless, extended and JPEG baseline/progressive sizes", () => {
    expect(inspectMapImage(fakeWebp(2400, 1800))).toEqual({ ok: true, info: { format: "webp", width: 2400, height: 1800 } });
    expect(inspectMapImage(fakeWebp(1800, 2400, { layout: "VP8X" }))).toEqual({ ok: true, info: { format: "webp", width: 1800, height: 2400 } });
    expect(inspectMapImage(fakeJpeg(2400, 1600))).toEqual({ ok: true, info: { format: "jpeg", width: 2400, height: 1600 } });
    expect(inspectMapImage(fakeJpeg(1200, 900, { progressive: true }))).toEqual({ ok: true, info: { format: "jpeg", width: 1200, height: 900 } });
  });

  it("is not fooled by marker bytes inside entropy data", () => {
    expect(code(inspectMapImage(fakeJpeg(2000, 1500, { pad: 5000 })))).toBe("ok");
  });
});

describe("truncated or malformed files are corrupt_image", () => {
  it("rejects truncated JPEGs and WebPs at any point", () => {
    const jpeg = fakeJpeg(2400, 1800);
    for (const cut of [4, 30, 100, jpeg.length - 2, jpeg.length - 1]) {
      expect(code(inspectMapImage(fakeJpeg(2400, 1800, { truncateAt: cut })))).toBe("corrupt_image");
    }
    const webp = fakeWebp(2400, 1800);
    for (const cut of [14, 20, webp.length - 1]) {
      expect(code(inspectMapImage(fakeWebp(2400, 1800, { truncateAt: cut })))).toBe("corrupt_image");
    }
  });

  it("rejects bytes appended after the image (polyglot padding)", () => {
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { trailing: [1, 2, 3] })))).toBe("corrupt_image");
    const w = fakeWebp(2400, 1800);
    expect(code(inspectMapImage(new Uint8Array([...w, 1, 2, 3, 4])))).toBe("corrupt_image");
  });

  it("rejects chunks and markers outside the allowlist", () => {
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { extraChunk: "JUNK" })))).toBe("corrupt_image");
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xf0, payload: [1, 2, 3] }] })))).toBe("corrupt_image");
  });

  it("rejects animated WebP", () => {
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { animated: true })))).toBe("corrupt_image");
  });
});

describe("metadata is refused, not stripped", () => {
  it("rejects JPEG Exif/GPS (APP1), XMP, Photoshop (APP13) and comments", () => {
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xe1, payload: EXIF_GPS_PAYLOAD }] })))).toBe("metadata_present");
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xe1, payload: [...new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0")] }] })))).toBe("metadata_present");
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xed, payload: [1, 2, 3] }] })))).toBe("metadata_present");
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xfe, payload: [104, 105] }] })))).toBe("metadata_present");
  });

  it("allows an ICC profile (APP2) in JPEG and WebP", () => {
    expect(code(inspectMapImage(fakeJpeg(2400, 1800, { segments: [{ marker: 0xe2, payload: [...new TextEncoder().encode("ICC_PROFILE\0"), 1, 1, 9, 9] }] })))).toBe("ok");
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { icc: true })))).toBe("ok");
  });

  it("rejects WebP EXIF and XMP chunks and the VP8X metadata flags", () => {
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { exif: true })))).toBe("metadata_present");
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { xmp: true })))).toBe("metadata_present");
    expect(code(inspectMapImage(fakeWebp(2400, 1800, { exifFlagOnly: true })))).toBe("metadata_present");
  });
});

describe("the pair", () => {
  const ok = (fw: number, fh: number, sw: number, sh: number) => validateMapPair(fakeWebp(fw, fh), fakeWebp(sw, sh));

  it("accepts a normal pair, including a native-size full (no upscaling) and 3:1", () => {
    expect(pairCode(ok(2400, 1800, 1200, 900))).toBe("ok");
    expect(pairCode(ok(1800, 1350, 1200, 900))).toBe("ok");
    expect(pairCode(ok(2400, 800, 1200, 400))).toBe("ok"); // 3:1: the 800 px short side is legitimate
    expect(pairCode(ok(1350, 1800, 900, 1200))).toBe("ok");
  });

  it("refuses mixed encodings", () => {
    expect(pairCode(validateMapPair(fakeWebp(2400, 1800), fakeJpeg(1200, 900)))).toBe("mixed_formats");
  });

  it("enforces the full long side 1600-2400 and the small one at most 1200", () => {
    expect(pairCode(ok(2401, 1800, 1200, 900))).toBe("full_size_out_of_range");
    expect(pairCode(ok(1599, 1200, 1200, 900))).toBe("full_size_out_of_range");
    expect(pairCode(ok(2400, 1800, 1201, 900))).toBe("small_size_out_of_range");
  });

  it("enforces aspect 1:3 to 3:1 and that both variants have the same shape", () => {
    expect(pairCode(ok(2400, 700, 1200, 350))).toBe("aspect_out_of_range");
    expect(pairCode(ok(2400, 1800, 1200, 600))).toBe("aspect_mismatch");
    expect(pairCode(ok(2400, 1800, 900, 1200))).toBe("aspect_mismatch"); // rotated
    expect(pairCode(ok(2400, 1801, 1200, 900))).toBe("ok"); // +-1 px rounding
  });

  it("reports the first failing variant's type or structure error", () => {
    expect(pairCode(validateMapPair(new TextEncoder().encode("<svg/>"), fakeWebp(1200, 900)))).toBe("unsupported_image_type");
    expect(pairCode(validateMapPair(fakeWebp(2400, 1800), fakeWebp(1200, 900, { exif: true })))).toBe("metadata_present");
  });
});
