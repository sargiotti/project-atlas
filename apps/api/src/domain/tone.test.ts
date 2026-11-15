import { describe, expect, it } from "vitest";
import { TONE_COUNT, TONE_FILLS, fallbackCoverGeometry, fallbackCoverSvg, toneOf } from "@atlas/contract";

describe("toneOf", () => {
  // Golden values: existing events keep their colour (the panel always used this exact hash).
  it.each([
    ["evt_tiny-fest", 1],
    ["evt_havnelobet", 6],
    ["evt_nightfall-meadows", 2],
    ["a", 1],
    ["", 0],
    ["3f2b8c1e-9d4a-4e7b-8a61-0c5d2e9f7a13", 0],
  ])("%j -> %i", (id, tone) => {
    expect(toneOf(id)).toBe(tone);
  });

  it("is always an integer 0-7 and stable", () => {
    for (let i = 0; i < 500; i++) {
      const t = toneOf(crypto.randomUUID());
      expect(Number.isInteger(t) && t >= 0 && t < TONE_COUNT).toBe(true);
    }
    expect(toneOf("x")).toBe(toneOf("x"));
  });
});

describe("colour cover", () => {
  it("has 8 light fills", () => {
    expect(TONE_FILLS).toHaveLength(TONE_COUNT);
    for (const f of TONE_FILLS) expect(f).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("builds only from fixed values: no script, no foreign attribute, tone clamped", () => {
    for (let t = 0; t < TONE_COUNT; t++) {
      const svg = fallbackCoverSvg(t);
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg).toContain(`fill="${TONE_FILLS[t]}"`);
      expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    }
    expect(fallbackCoverGeometry(99).background).toBe(TONE_FILLS[0]);
    expect(fallbackCoverGeometry(Number.NaN).background).toBe(TONE_FILLS[0]);
    expect(fallbackCoverSvg(2, { size: { width: 1200, height: 630 } })).toContain('width="1200" height="630"');
  });
});
