import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TONE_FILLS, toneOf } from "@atlas/contract";
import { pastel } from "../src/pages/panel/events/common";
import { coverFailure } from "../src/api/panelCover";
import {
  CENTRE, clampFocal, cropRect, focalCss, fullSize, isBaselineJpeg, smallSize, surfaceRect, trimRect, validateCoverDimensions, validateCoverInput,
} from "../src/lib/coverRules";

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(32).fill(0)]);

describe("cover input checks", () => {
  it("refuses over 25 MB, PDFs, SVG and unknown files; accepts PNG/JPEG/WebP/AVIF and lets HEIC reach the decoder", () => {
    expect(validateCoverInput(26 * 1024 * 1024, bytes(0xff, 0xd8, 0xff))).toMatchObject({ ok: false, error: { key: "cvErrBig", mb: 26 } });
    expect(validateCoverInput(10, new TextEncoder().encode("%PDF-1.7"))).toMatchObject({ ok: false, error: { key: "cvErrType" } });
    expect(validateCoverInput(10, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatchObject({ ok: false, error: { key: "cvErrType" } });
    expect(validateCoverInput(10, bytes(1, 2, 3))).toMatchObject({ ok: false, error: { key: "cvErrDecode" } });
    expect(validateCoverInput(10, bytes(0xff, 0xd8, 0xff))).toMatchObject({ ok: true, format: "jpeg" });
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]);
    expect(validateCoverInput(10, heic)).toMatchObject({ ok: true, format: "heic" });
  });
  it("hard minimum 960x504, soft warning under 1600 wide, 40 MP ceiling", () => {
    expect(validateCoverDimensions(959, 600)).toMatchObject({ ok: false, error: { key: "cvErrSmall" } });
    expect(validateCoverDimensions(1200, 503)).toMatchObject({ ok: false, error: { key: "cvErrSmall" } });
    expect(validateCoverDimensions(1280, 800)).toEqual({ ok: true, soft: true });
    expect(validateCoverDimensions(1600, 900)).toEqual({ ok: true, soft: false });
    expect(validateCoverDimensions(8000, 6000)).toMatchObject({ ok: false, error: { key: "cvErrPixels" } });
  });
});

describe("the one focal rule", () => {
  it("object-position and the crop agree: the focal fraction picks the offset", () => {
    expect(focalCss({ x: 0.3, y: 0.6 })).toBe("30% 60%");
    const r = cropRect(2400, 1600, 2, { x: 1, y: 0 }); // 2:1 of 3:2: full width, 1200 tall, pinned to the top
    expect(r).toEqual({ sx: 0, sy: 0, sw: 2400, sh: 1200 });
    expect(cropRect(1600, 2400, 2, { x: 0.5, y: 1 })).toEqual({ sx: 0, sy: 2400 - 800, sw: 1600, sh: 800 });
  });
  it("clamps and rounds the point to 2 decimals", () => {
    expect(clampFocal(1.4, -2)).toEqual({ x: 1, y: 0 });
    expect(clampFocal(0.12345, 0.5)).toEqual({ x: 0.12, y: 0.5 });
    expect(clampFocal(NaN, 0.5)).toEqual(CENTRE);
  });
  it("trims pictures taller than 4:5 or wider than 3:1 around the point, never beyond", () => {
    expect(trimRect(1000, 1000, CENTRE)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 });
    const tall = trimRect(1000, 3000, { x: 0.5, y: 0 });
    expect(tall.sw / tall.sh).toBeCloseTo(0.8);
    expect(tall.sy).toBe(0);
    const wide = trimRect(6000, 1000, { x: 1, y: 0.5 });
    expect(wide.sw / wide.sh).toBeCloseTo(3);
    expect(wide.sx + wide.sw).toBeCloseTo(6000);
    // A surface of a trimmed original stays inside the original.
    const s = surfaceRect(1000, 3000, 2, { x: 0.5, y: 1 });
    expect(s.sy + s.sh).toBeLessThanOrEqual(3000);
  });
  it("stored sizes: at most 1600 wide, never upscaled; 800 variant keeps the aspect", () => {
    expect(fullSize(2400, 1600)).toEqual({ width: 1600, height: 1067 });
    expect(fullSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(smallSize({ width: 1600, height: 1067 })).toEqual({ width: 800, height: 534 });
    const f = fullSize(1000, 4000);
    expect(f.width / f.height).toBeCloseTo(0.8, 2);
  });
  it("recognises progressive JPEGs, which link-preview crawlers can drop", () => {
    const sof = (m: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, m, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
    expect(isBaselineJpeg(sof(0xc0))).toBe(true);
    expect(isBaselineJpeg(sof(0xc2))).toBe(false);
  });
});

describe("cover request failures", () => {
  it("maps statuses to message keys and the retry wait", () => {
    expect(coverFailure(429, errorBody("rate_limited"), "45")).toMatchObject({ status: "rate_limited", kind: "minute", retryAfter: 45 });
    expect(coverFailure(429, errorBody("rate_limited"), "40000")).toMatchObject({ kind: "day", key: "cvFailRateDay" });
    expect(coverFailure(409, errorBody("cover_changed"), null)).toMatchObject({ key: "cvFailChanged", retryable: true });
    expect(coverFailure(404, errorBody("event_not_found"), null)).toEqual({ status: "not_found" });
    expect(coverFailure(404, errorBody("cover_not_found"), null)).toMatchObject({ key: "cvFailGone" });
    expect(coverFailure(413, errorBody("payload_too_large"), null)).toMatchObject({ key: "cvFailRejected" });
    expect(coverFailure(400, { error: { code: "invalid_upload", reason: "bad_focal" } }, null)).toMatchObject({ key: "cvFailServer" });
    expect(coverFailure(500, null, null)).toMatchObject({ key: "cvFailServer", retryable: true });
  });
});
const errorBody = (code: string) => ({ error: { code } });

describe("light tones only, in both themes", () => {
  it("pastel() yields only the light fill from the contract (same colour as before), never a dark variant", () => {
    for (const id of ["a", "evt_fiesta", "5b1c2d3e-0000-4000-8000-000000000001", "x7k2q9"]) {
      const s = pastel(id) as Record<string, string>;
      expect(Object.keys(s)).toEqual(["--pf"]);
      expect(s["--pf"]).toBe(TONE_FILLS[toneOf(id)]);
    }
    expect(TONE_FILLS).toHaveLength(8);
  });
  it("no source file refers to a dark tone variant (--pfd)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(css|tsx?)$/.test(f) && readFileSync(p, "utf8").includes("--pfd")) hits.push(p);
      }
    };
    walk(join(__dirname, "..", "src"));
    expect(hits.filter((h) => !h.endsWith("cover-rules.test.ts"))).toEqual([]);
  });
});
