import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_MULTI_LINE,
  FORBIDDEN_SINGLE_LINE,
  INVISIBLE_RANGES,
  REASON_MAX,
  adminUnpublishRequestSchema,
  eventInputSchema,
  reasonSchema,
  rejectRequestSchema,
  sessionSchema,
  toFieldErrors,
} from "@atlas/contract";
import { cleanText } from "./event-preview";

const cp = (n: number) => String.fromCodePoint(n);

describe("INVISIBLE_RANGES (one shared blocklist)", () => {
  it("covers the slice 08b additions and the existing zero-width and bidi characters", () => {
    const has = (n: number) => INVISIBLE_RANGES.some(([a, b]) => n >= a && n <= b);
    for (const n of [0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x2061, 0x2065, 0x206a, 0x206f, 0x3164, 0xffa0, 0xfff9, 0xfffb, 0xe0000, 0xe0041, 0xe007f]) {
      expect(has(n), n.toString(16)).toBe(true);
    }
    for (const n of [0x200b, 0x200d, 0x200e, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff]) expect(has(n), n.toString(16)).toBe(true);
    // Just outside every range: ordinary text neighbours
    for (const n of [0x00ac, 0x00ae, 0x034e, 0x0350, 0x061b, 0x061d, 0x115e, 0x1161, 0x17b3, 0x17b6, 0x180d, 0x180f, 0x2057, 0x2070, 0x3163, 0x3165, 0xff9f, 0xffa1, 0xfff8, 0xfffc, 0xdffff, 0xe0080]) {
      expect(has(n), n.toString(16)).toBe(false);
    }
  });

  it("every listed character is refused by the event text fields, the session text fields and the link-preview cleaner", () => {
    const valid = { name: "Fiesta", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en" };
    for (const [a, b] of INVISIBLE_RANGES) {
      // First, last and (for long ranges) a middle code point.
      for (const n of new Set([a, b, a + Math.floor((b - a) / 2)])) {
        const bad = `ab${cp(n)}cd`;
        const name = eventInputSchema.safeParse({ ...valid, name: bad });
        expect(name.success, `name U+${n.toString(16)}`).toBe(false);
        if (!name.success) expect(toFieldErrors(name.error)).toContainEqual({ path: "name", code: "control_chars" });
        expect(eventInputSchema.safeParse({ ...valid, description: bad }).success, `description U+${n.toString(16)}`).toBe(false);
        expect(FORBIDDEN_SINGLE_LINE.test(bad)).toBe(true);
        expect(FORBIDDEN_MULTI_LINE.test(bad)).toBe(true);
        expect(cleanText(bad, 50), `preview U+${n.toString(16)}`).toBe("abcd");
      }
    }
    const session = { id: "s1", pointId: "p1", start: "2026-07-10T10:00:00Z", end: "2026-07-10T11:00:00Z" };
    expect(sessionSchema.safeParse({ ...session, title: `Show${cp(0x00ad)}` }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...session, title: "Show", description: `x${cp(0xe0041)}` }).success).toBe(false);
  });

  it("does not touch real text: accents, Korean, emoji, newlines in the description", () => {
    const valid = { name: "København 한국 🎉", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en", description: "line one\nline two" };
    expect(eventInputSchema.safeParse(valid).success).toBe(true);
    expect(FORBIDDEN_SINGLE_LINE.test("a\nb")).toBe(true);
    expect(FORBIDDEN_MULTI_LINE.test("a\nb")).toBe(false);
  });
});

describe("reasonSchema", () => {
  const parse = (v: unknown) => reasonSchema.safeParse(v);

  it("is optional: missing, null and blank all become null", () => {
    expect(parse(undefined)).toMatchObject({ success: true, data: null });
    expect(parse(null)).toMatchObject({ success: true, data: null });
    expect(parse("  \n\t ")).toMatchObject({ success: true, data: null });
    expect(parse(`${cp(0x200b)}${cp(0x00ad)}`)).toMatchObject({ success: true, data: null });
    expect(rejectRequestSchema.parse({})).toEqual({ reason: null });
    expect(adminUnpublishRequestSchema.parse({ reason: null })).toEqual({ reason: null });
  });

  it("cleans: NFC, invisible characters and angle brackets removed, whitespace collapsed, trimmed", () => {
    expect(parse("  Not   enough\n info <b>please</b>­ ")).toMatchObject({ success: true, data: "Not enough info bplease/b" });
    expect(parse("Café")).toMatchObject({ success: true, data: "Café" });
    expect(parse(`a${cp(0xe0041)}b`)).toMatchObject({ success: true, data: "ab" });
  });

  it("limits to 200 Unicode code points after cleaning, never truncating", () => {
    expect(REASON_MAX).toBe(200);
    expect(parse("x".repeat(200)).success).toBe(true);
    // 200 astral characters are 400 UTF-16 units but 200 code points: allowed. 201 is not.
    expect(parse("\u{1F389}".repeat(200)).success).toBe(true);
    const long = rejectRequestSchema.safeParse({ reason: "\u{1F389}".repeat(201) });
    expect(long.success).toBe(false);
    if (!long.success) expect(toFieldErrors(long.error)).toEqual([{ path: "reason", code: "too_long" }]);
    // Characters that are stripped do not count
    expect(parse(`${"x".repeat(200)}${cp(0x200b)}<>`).success).toBe(true);
  });

  it("refuses non-strings and unknown keys", () => {
    expect(parse(5).success).toBe(false);
    expect(rejectRequestSchema.safeParse({ reason: "x", extra: 1 }).success).toBe(false);
  });
});
