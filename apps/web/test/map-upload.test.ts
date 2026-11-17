import { describe, expect, it } from "vitest";
import { mapFailure, INVALID_UPLOAD_REASONS } from "../src/api/panelMap";
import { MESSAGES } from "../src/i18n/messages";
import {
  classifyTheme, meanLightness, qualityLadder, resizeSteps, sniffFormat, validateDimensions, validateInput, variantSizes,
} from "../src/lib/mapImageRules";

const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...text("ftyp" + brand), 0, 0, 0, 0]);

describe("input validation", () => {
  it("rejects formats by their bytes, not by name", () => {
    expect(validateInput(1000, text("%PDF-1.7"))).toMatchObject({ ok: false, error: { key: "errFormatPdf" } });
    expect(validateInput(1000, text('<?xml version="1.0"?><svg xmlns="x"/>'))).toMatchObject({ error: { key: "errFormatSvg" } });
    expect(validateInput(1000, text("GIF89a"))).toMatchObject({ error: { key: "errFormatOther" } });
    expect(validateInput(1000, bytes(0x42, 0x4d))).toMatchObject({ error: { key: "errFormatOther" } });
    expect(validateInput(1000, bytes(0x49, 0x49, 0x2a, 0))).toMatchObject({ error: { key: "errFormatOther" } });
  });
  it("accepts PNG, JPEG, WebP, AVIF; lets HEIC through to the decoder", () => {
    expect(validateInput(1000, bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toMatchObject({ ok: true, format: "png" });
    expect(validateInput(1000, bytes(0xff, 0xd8, 0xff))).toMatchObject({ ok: true, format: "jpeg" });
    expect(sniffFormat(new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP")]))).toBe("webp");
    expect(sniffFormat(ftyp("avif"))).toBe("avif");
    expect(sniffFormat(ftyp("heic"))).toBe("heic");
    expect(sniffFormat(ftyp("mif1"))).toBe("heic");
  });
  it("caps the input at 25 MB", () => {
    expect(validateInput(25 * 1024 * 1024, bytes(0xff, 0xd8, 0xff)).ok).toBe(true);
    expect(validateInput(25 * 1024 * 1024 + 1, bytes(0xff, 0xd8, 0xff))).toMatchObject({ error: { key: "errTooBig" } });
  });
});

describe("dimension rules", () => {
  it("enforces 40 MP, 1600 long, 1000 short and 3:1", () => {
    expect(validateDimensions(8000, 5001)).toMatchObject({ error: { key: "errTooManyPx" } });
    expect(validateDimensions(1100, 800)).toMatchObject({ error: { key: "errTooSmall", w: 1100, h: 800 } });
    expect(validateDimensions(2400, 900)).toMatchObject({ error: { key: "errTooNarrow" } });
    expect(validateDimensions(4800, 1200)).toMatchObject({ error: { key: "errRatio" } });
    expect(validateDimensions(3000, 1000)).toMatchObject({ ok: true }); // exactly 3:1
    expect(validateDimensions(1600, 1000)).toMatchObject({ ok: true });
  });
  it("warns softly between 1600 and 2399 px", () => {
    expect(validateDimensions(1800, 2400)).toEqual({ ok: true, soft: false });
    expect(validateDimensions(1800, 1200)).toEqual({ ok: true, soft: true });
    expect(validateDimensions(2399, 1500)).toEqual({ ok: true, soft: true });
  });
});

describe("variant sizes", () => {
  it("never upscales: an 1800 px map keeps 1800 for full", () => {
    expect(variantSizes(1800, 1350).full).toEqual({ width: 1800, height: 1350 });
    expect(variantSizes(1800, 1350).small.width).toBe(1200);
  });
  it("caps full at 2400 and small at 1200, keeping the aspect", () => {
    const v = variantSizes(3508, 4677);
    expect(v.full).toEqual({ width: 1800, height: 2400 });
    expect(v.small).toEqual({ width: 900, height: 1200 });
  });
  it("resizes in steps of at most half and 16.7 MP, landing exactly on the target", () => {
    const src = { width: 8000, height: 5000 };
    const target = { width: 2400, height: 1500 };
    const steps = resizeSteps(src, target);
    expect(steps.at(-1)).toEqual(target);
    let prev = src;
    for (const s of steps) {
      expect(s.width * s.height).toBeLessThanOrEqual(16_777_216);
      expect(s.width).toBeGreaterThanOrEqual(Math.floor(prev.width / 2));
      prev = s;
    }
    expect(resizeSteps(target, target)).toEqual([]);
  });
  it("steps quality down but never below the floor", () => {
    const q = qualityLadder(0.82);
    expect(q[0]).toBe(0.82);
    expect(q.at(-1)).toBeGreaterThanOrEqual(0.5);
    expect(q.length).toBeGreaterThan(2);
  });
});

describe("Map Theme detection (ADR 0008)", () => {
  const solid = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a, r, g, b, a]);
  it("white is light, black is dark, transparent counts as white", () => {
    expect(classifyTheme(meanLightness(solid(255, 255, 255))).theme).toBe("light");
    expect(classifyTheme(meanLightness(solid(0, 0, 0))).theme).toBe("dark");
    expect(classifyTheme(meanLightness(solid(0, 0, 0, 0))).theme).toBe("light");
  });
  it("threshold is mean L* 50, ambiguous hint is 40-60", () => {
    expect(classifyTheme(49.9).theme).toBe("dark");
    expect(classifyTheme(50).theme).toBe("light");
    expect(classifyTheme(39.9).ambiguous).toBe(false);
    expect(classifyTheme(40).ambiguous).toBe(true);
    expect(classifyTheme(60).ambiguous).toBe(true);
    expect(classifyTheme(60.1).ambiguous).toBe(false);
  });
});

describe("upload error mapping", () => {
  it("maps map_changed (409) to a retryable failure with its own message", () => {
    expect(mapFailure(409, { error: { code: "map_changed" } }, null)).toMatchObject({ status: "error", key: "peMapChanged", code: "map_changed", retryable: true });
  });

  const known = (k: string) => (["es", "en", "da", "ca"] as const).every((l) => (MESSAGES[l] as any)[k]);
  it("every message key it can return exists in en, es and da", () => {
    const outcomes = [
      mapFailure(409, { error: { code: "event_not_draft" } }, null),
      mapFailure(409, { error: { code: "map_changed" } }, null),
      mapFailure(413, { error: { code: "payload_too_large" } }, null),
      mapFailure(415, { error: { code: "unsupported_image_type" } }, null),
      mapFailure(415, { error: { code: "unsupported_media_type" } }, null),
      mapFailure(403, { error: { code: "invalid_origin" } }, null),
      mapFailure(500, { error: { code: "internal_error" } }, null),
      mapFailure(429, { error: { code: "rate_limited" } }, "60"),
      mapFailure(429, { error: { code: "rate_limited" } }, "40000"),
      ...INVALID_UPLOAD_REASONS.map((reason) => mapFailure(400, { error: { code: "invalid_upload", reason } }, null)),
    ];
    for (const o of outcomes) if ("key" in o) expect(known(o.key), o.key).toBe(true);
    expect(known("peMapNetT") && known("peMapThemeFail")).toBe(true);
  });
  it("401 and 404 go to the generic screens", () => {
    expect(mapFailure(401, null, null).status).toBe("unauthenticated");
    expect(mapFailure(404, { error: { code: "map_not_found" } }, null).status).toBe("not_found");
  });
  it("429 splits the minute limiter (countdown) from the daily quota", () => {
    expect(mapFailure(429, null, "60")).toMatchObject({ kind: "minute", retryAfter: 60, key: "peMapRateMinT" });
    expect(mapFailure(429, null, "25200")).toMatchObject({ kind: "day", retryAfter: 25200, key: "peMapRateDayT" });
    expect(mapFailure(429, null, null)).toMatchObject({ kind: "minute", retryAfter: 60 });
  });
  it("only 5xx is retryable; invalid uploads and a non-draft event are not", () => {
    expect(mapFailure(500, null, null)).toMatchObject({ retryable: true });
    expect(mapFailure(400, { error: { code: "invalid_upload", reason: "metadata_present" } }, null)).toMatchObject({ key: "peMapRejected", retryable: false });
    expect(mapFailure(409, { error: { code: "event_not_draft" } }, null)).toMatchObject({ key: "peMapNotDraft", retryable: false });
  });
});
