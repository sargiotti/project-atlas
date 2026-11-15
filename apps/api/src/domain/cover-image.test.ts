import { describe, expect, it } from "vitest";
import { EXIF_GPS_PAYLOAD, fakeJpeg, fakeWebp } from "../../test/map-fixtures";
import { aspectInRange, parseFocalPart, validateCoverSet, validateOgOnly } from "./cover-image";

const full = () => fakeWebp(1200, 800);
const small = () => fakeWebp(800, 533);
const og = () => fakeJpeg(1200, 630);

const refused = (r: ReturnType<typeof validateCoverSet>) => (r.ok ? "ok" : r.code === "invalid_upload" ? r.reason : r.code);

describe("validateCoverSet", () => {
  it("accepts a plain set and reports the dimensions from the headers", () => {
    const r = validateCoverSet(full(), small(), og());
    expect(r).toMatchObject({ ok: true, full: { width: 1200, height: 800 }, small: { width: 800, height: 533 }, og: { width: 1200, height: 630 } });
  });

  it("accepts ICC profiles but nothing else extra (VP8X with ICCP)", () => {
    expect(validateCoverSet(fakeWebp(1200, 800, { icc: true }), small(), og()).ok).toBe(true);
  });

  describe("type comes from the magic bytes only", () => {
    it.each([
      ["SVG as full", "full", new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>")],
      ["HTML as small", "small", new TextEncoder().encode("<!doctype html><script>1</script>")],
      ["PNG as og", "og", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
      ["GIF as full", "full", new TextEncoder().encode("GIF89a\u0001\u0000\u0001\u0000")],
      ["a JPEG full with a WebP small (mixed)", "full", fakeJpeg(1200, 800)],
      ["a WebP in the og slot", "og", fakeWebp(1200, 630)],
    ] as const)("%s is unsupported_image_type", (_name, slot, bytes) => {
      const set = { full: full(), small: small(), og: og(), [slot]: bytes };
      expect(refused(validateCoverSet(set.full, set.small, set.og))).toBe("unsupported_image_type");
    });
  });

  describe("JPEG full and small (browsers that cannot encode WebP)", () => {
    const jfull = () => fakeJpeg(1200, 800);
    const jsmall = () => fakeJpeg(800, 533);
    it("accepts a JPEG pair (progressive too) and reports the format", () => {
      expect(validateCoverSet(jfull(), jsmall(), og())).toMatchObject({ ok: true, format: "jpeg", full: { width: 1200, height: 800 } });
      expect(validateCoverSet(fakeJpeg(1200, 800, { progressive: true }), jsmall(), og()).ok).toBe(true);
      expect(validateCoverSet(full(), small(), og())).toMatchObject({ ok: true, format: "webp" });
    });
    it("refuses EXIF/GPS, trailing bytes and truncation", () => {
      const exif = { segments: [{ marker: 0xe1, payload: EXIF_GPS_PAYLOAD }] };
      expect(refused(validateCoverSet(fakeJpeg(1200, 800, exif), jsmall(), og()))).toBe("metadata_present");
      expect(refused(validateCoverSet(jfull(), fakeJpeg(800, 533, exif), og()))).toBe("metadata_present");
      expect(refused(validateCoverSet(fakeJpeg(1200, 800, { trailing: [0] }), jsmall(), og()))).toBe("corrupt_image");
    });
    it("keeps the same width, aspect and format rules; a mixed pair is unsupported_image_type", () => {
      expect(refused(validateCoverSet(fakeJpeg(959, 640), fakeJpeg(800, 533), og()))).toBe("full_size_out_of_range");
      expect(refused(validateCoverSet(jfull(), fakeJpeg(799, 533), og()))).toBe("small_size_out_of_range");
      expect(refused(validateCoverSet(jfull(), fakeJpeg(800, 600), og()))).toBe("aspect_mismatch");
      expect(refused(validateCoverSet(jfull(), small(), og()))).toBe("unsupported_image_type");
      expect(refused(validateCoverSet(full(), jsmall(), og()))).toBe("unsupported_image_type");
    });
  });

  describe("WebP structure", () => {
    it("refuses an animated WebP (flag, ANIM chunk and ANMF chunk) as animated_image", () => {
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { animated: true }), small(), og()))).toBe("animated_image");
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { extraChunk: "ANIM" }), small(), og()))).toBe("animated_image");
      expect(refused(validateCoverSet(full(), fakeWebp(800, 533, { extraChunk: "ANMF" }), og()))).toBe("animated_image");
    });
    it("refuses EXIF and XMP chunks and flags", () => {
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { exif: true }), small(), og()))).toBe("metadata_present");
      expect(refused(validateCoverSet(full(), fakeWebp(800, 533, { xmp: true }), og()))).toBe("metadata_present");
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { exifFlagOnly: true }), small(), og()))).toBe("metadata_present");
    });
    it("refuses trailing bytes (RIFF length must equal the file length) and truncation", () => {
      const f = full();
      expect(refused(validateCoverSet(new Uint8Array([...f, 0, 0]), small(), og()))).toBe("corrupt_image");
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { truncateAt: 30 }), small(), og()))).toBe("corrupt_image");
    });
    it("refuses an unknown chunk and a file that does not start with a bitstream or VP8X chunk", () => {
      expect(refused(validateCoverSet(fakeWebp(1200, 800, { extraChunk: "JUNK" }), small(), og()))).toBe("corrupt_image");
      const f = Array.from(full());
      // Rename the first chunk (VP8L) to ICCP: a plain RIFF whose first chunk is not VP8/VP8L/VP8X.
      f.splice(12, 4, ...Array.from("ICCP", (c) => c.charCodeAt(0)));
      expect(refused(validateCoverSet(new Uint8Array(f), small(), og()))).toBe("corrupt_image");
    });
  });

  describe("link-preview JPEG", () => {
    it("refuses a progressive JPEG as og_not_baseline", () => {
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(1200, 630, { progressive: true })))).toBe("og_not_baseline");
    });
    it("refuses APP1 (Exif/GPS), APP13 and COM as metadata_present", () => {
      for (const marker of [0xe1, 0xed, 0xfe]) {
        expect(refused(validateCoverSet(full(), small(), fakeJpeg(1200, 630, { segments: [{ marker, payload: EXIF_GPS_PAYLOAD }] })))).toBe("metadata_present");
      }
    });
    it("refuses bytes after EOI and truncation", () => {
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(1200, 630, { trailing: [0] })))).toBe("corrupt_image");
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(1200, 630, { truncateAt: 60 })))).toBe("corrupt_image");
    });
    it("allows JFIF (always present) and an ICC profile segment", () => {
      expect(validateCoverSet(full(), small(), fakeJpeg(1200, 630, { segments: [{ marker: 0xe2, payload: [0x49, 0x43, 0x43, 0, 1, 2] }] })).ok).toBe(true);
    });
    it("must be exactly 1200x630", () => {
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(1200, 631)))).toBe("og_size_invalid");
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(1199, 630)))).toBe("og_size_invalid");
      expect(refused(validateCoverSet(full(), small(), fakeJpeg(600, 315)))).toBe("og_size_invalid");
    });
  });

  describe("dimensions", () => {
    it("full width must be 960-1600", () => {
      expect(validateCoverSet(fakeWebp(960, 640), small(), og()).ok).toBe(true);
      expect(validateCoverSet(fakeWebp(1600, 1000), fakeWebp(800, 500), og()).ok).toBe(true);
      expect(refused(validateCoverSet(fakeWebp(959, 640), small(), og()))).toBe("full_size_out_of_range");
      expect(refused(validateCoverSet(fakeWebp(1601, 1000), small(), og()))).toBe("full_size_out_of_range");
    });
    it("aspect must be between 4:5 and 3:1 (1 px slack on the height)", () => {
      expect(aspectInRange(960, 1200)).toBe(true); // 4:5
      expect(aspectInRange(960, 1202)).toBe(false);
      expect(aspectInRange(1600, 534)).toBe(true); // ~3:1, rounding
      expect(aspectInRange(1600, 531)).toBe(false);
      expect(refused(validateCoverSet(fakeWebp(1200, 1600), fakeWebp(800, 1067), og()))).toBe("aspect_out_of_range");
      expect(refused(validateCoverSet(fakeWebp(1600, 400), fakeWebp(800, 200), og()))).toBe("aspect_out_of_range");
    });
    it("small must be exactly 800 wide and the same aspect as full (+-1 px)", () => {
      expect(refused(validateCoverSet(full(), fakeWebp(799, 533), og()))).toBe("small_size_out_of_range");
      expect(refused(validateCoverSet(full(), fakeWebp(1200, 800), og()))).toBe("small_size_out_of_range");
      expect(validateCoverSet(full(), fakeWebp(800, 534), og()).ok).toBe(true);
      expect(refused(validateCoverSet(full(), fakeWebp(800, 600), og()))).toBe("aspect_mismatch");
    });
  });
});

describe("validateOgOnly (focal route)", () => {
  it("applies the same JPEG rules", () => {
    expect(validateOgOnly(og()).ok).toBe(true);
    expect(validateOgOnly(fakeJpeg(1200, 630, { progressive: true }))).toMatchObject({ ok: false, reason: "og_not_baseline" });
    expect(validateOgOnly(fakeWebp(1200, 630))).toMatchObject({ ok: false, code: "unsupported_image_type" });
  });
});

describe("parseFocalPart", () => {
  it("accepts decimals in [0, 1] with at most 4 decimals and rounds to 2", () => {
    expect(parseFocalPart("0")).toBe(0);
    expect(parseFocalPart("1")).toBe(1);
    expect(parseFocalPart("1.0")).toBe(1);
    expect(parseFocalPart("0.5")).toBe(0.5);
    expect(parseFocalPart("0.1234")).toBe(0.12);
    expect(parseFocalPart("0.555")).toBe(0.56);
  });
  it.each(["", " 0.5", "0.5 ", "-0.1", "1.1", "2", "1.0001", "0.12345", ".5", "5e-1", "NaN", "Infinity", "0x1", "0,5", "50%", "1e0"])("refuses %j", (raw) => {
    expect(parseFocalPart(raw)).toBeNull();
  });
  it("refuses a non-text part", () => {
    expect(parseFocalPart(null)).toBeNull();
    expect(parseFocalPart(new Blob(["0.5"]))).toBeNull();
  });
});
