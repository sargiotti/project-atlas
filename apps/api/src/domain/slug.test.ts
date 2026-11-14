import { describe, expect, it } from "vitest";
import { slugSchema } from "@atlas/contract";
import { generateSlug, randomSuffix, slugBase } from "./slug";

describe("slugBase", () => {
  it("lowercases, strips diacritics and joins [a-z0-9] runs with a single dash", () => {
    expect(slugBase("Fiesta de mi Barrio!")).toBe("fiesta-de-mi-barrio");
    expect(slugBase("  Havneløbet -- København  ")).toBe("havnel-bet-k-benhavn");
    expect(slugBase("Café Ångström 2026")).toBe("cafe-angstrom-2026");
  });

  it("falls back to 'event' when nothing is left", () => {
    expect(slugBase("🎉🎉🎉")).toBe("event");
    expect(slugBase("---")).toBe("event");
  });

  it("cuts to 40 characters without a trailing dash", () => {
    const base = slugBase(`${"a".repeat(39)} bbbbbbbbbb`);
    expect(base).toBe("a".repeat(39));
    expect(slugBase("x".repeat(100))).toHaveLength(40);
  });
});

describe("randomSuffix", () => {
  it("rejects bytes at or above 252 so every character is equally likely", () => {
    // 252..255 would bias towards the first characters (252 % 36 = 0): they must be skipped.
    const feed = [255, 254, 253, 252, 0, 1, 35, 36, 71, 72, 251, 250, 0, 0, 0, 0];
    expect(randomSuffix(6, (b) => b.set(feed))).toBe("ab9a9a");
  });

  it("returns 6 characters from [a-z0-9] with the real random source", () => {
    for (let i = 0; i < 200; i++) expect(randomSuffix()).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("generateSlug", () => {
  it("is base + dash + 6 chars, at most 47 characters, and always a valid slug", () => {
    for (const name of ["Fiesta", "x".repeat(80), "🎉", "Café Ångström"]) {
      const slug = generateSlug(name);
      expect(slug.length).toBeLessThanOrEqual(47);
      expect(slugSchema.safeParse(slug).success).toBe(true);
    }
    expect(generateSlug("Fiesta")).toMatch(/^fiesta-[a-z0-9]{6}$/);
  });

  it("differs between calls for the same name", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateSlug("Same name"))).size).toBe(50);
  });
});
