import { describe, expect, it } from "vitest";
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
      imagePath: null,
      imageAlt: "Cover illustration for Havneløbet 2026",
    });
  });

  it("falls back to the ISO code for an unknown country and drops a malformed date", () => {
    expect(countryName("ZZ")).toBe("ZZ");
    expect(buildEventPreview({ ...base, country: "ZZ" }).description).toBe("10–22 Nov 2026 · København, ZZ");
    expect(buildEventPreview({ ...base, startDate: "2026-13-01" }).description).toBe("København, Denmark");
  });

  it("only accepts well-formed image keys", () => {
    expect(buildEventPreview({ ...base, ogKey: "a-b.0123abcd.jpg" }).imagePath).toBe("/og/a-b.0123abcd.jpg");
    expect(buildEventPreview({ ...base, ogKey: "A.0123abcd.jpg" }).imagePath).toBeNull();
    expect(buildEventPreview({ ...base, ogKey: "a.0123abcd.jpg/../x" }).imagePath).toBeNull();
  });
});

describe("cleanText", () => {
  it("truncates by code point, never splitting a surrogate pair", () => {
    const out = cleanText("😀".repeat(10), 5);
    expect(Array.from(out)).toHaveLength(5);
    expect(out.endsWith("…")).toBe(true);
  });
});
