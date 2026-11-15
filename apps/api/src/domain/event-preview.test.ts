import { describe, expect, it } from "vitest";
import { toneOf } from "@atlas/contract";
import { buildEventPreview, cleanText, countryName, formatDateRange } from "./event-preview";

describe("formatDateRange", () => {
  it.each([
    ["2026-12-04", "2026-12-04", "4 Dec 2026"],
    ["2026-11-10", "2026-11-22", "10–22 Nov 2026"],
    ["2026-11-28", "2026-12-02", "28 Nov – 2 Dec 2026"],
    ["2026-12-30", "2027-01-02", "30 Dec 2026 – 2 Jan 2027"],
    ["2026-09-01", "2026-09-09", "1–9 Sep 2026"],
  ])("%s .. %s", (a, b, out) => expect(formatDateRange(a, b)).toBe(out));
});

describe("buildEventPreview", () => {
  const base = {
    id: "evt-1",
    slug: "x",
    name: "Havneløbet 2026",
    startDate: "2026-11-10",
    endDate: "2026-11-22",
    city: "København",
    country: "DK",
    ogKey: null,
  };

  it("builds title, description and alt", () => {
    expect(buildEventPreview(base)).toEqual({
      title: "Havneløbet 2026",
      description: "10–22 Nov 2026 · København, Denmark",
      imagePath: `/tone-og/${toneOf("evt-1")}.jpg`,
      imageAlt: "Cover image for Havneløbet 2026",
    });
  });

  it("falls back to the ISO code for an unknown country and drops a malformed date", () => {
    expect(countryName("ZZ")).toBe("ZZ");
    expect(buildEventPreview({ ...base, country: "ZZ" }).description).toBe("10–22 Nov 2026 · København, ZZ");
    expect(buildEventPreview({ ...base, startDate: "2026-13-01" }).description).toBe("København, Denmark");
  });

  it("uses the cover's og image only for a well-formed key of this very event, else the tone image", () => {
    const tone = `/tone-og/${toneOf("evt-1")}.jpg`;
    const key = `covers/evt-1/${"0123abcd".repeat(4)}-og.jpg`;
    expect(buildEventPreview({ ...base, ogKey: key }).imagePath).toBe(`/media/${key}`);
    expect(buildEventPreview({ ...base, ogKey: `covers/evt-2/${"0123abcd".repeat(4)}-og.jpg` }).imagePath).toBe(tone);
    expect(buildEventPreview({ ...base, ogKey: `covers/evt-1/${"0123abcd".repeat(4)}-full.webp` }).imagePath).toBe(tone);
    expect(buildEventPreview({ ...base, ogKey: `covers/evt-1/../x/${"0123abcd".repeat(4)}-og.jpg` }).imagePath).toBe(tone);
    expect(buildEventPreview({ ...base, ogKey: "A.0123abcd.jpg" }).imagePath).toBe(tone);
  });
});

describe("cleanText", () => {
  it("truncates by code point, never splitting a surrogate pair", () => {
    const out = cleanText("😀".repeat(10), 5);
    expect(Array.from(out)).toHaveLength(5);
    expect(out.endsWith("…")).toBe(true);
  });
});
