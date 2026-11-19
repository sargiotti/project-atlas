import { describe, expect, it } from "vitest";
import { seedFileSchema } from "../scripts/seed-lib";

const seed = (name: string, city = "Galway") => ({
  event: {
    slug: "x-fest",
    name,
    dates: { start: "2026-07-10", end: "2026-07-12" },
    city,
    country: "IE",
    language: "en",
    mapTheme: "dark",
    timeZone: "Europe/Dublin",
  },
  map: { file: "m.svg", width: 10, height: 10 },
  points: [{ id: "a", name: "A", category: "stage", description: "", x: 0.5, y: 0.5 }],
});

describe("seed validation of event name and city (R2)", () => {
  it("accepts ordinary and accented names", () => {
    expect(seedFileSchema.safeParse(seed("Havneløbet 2026", "København")).success).toBe(true);
  });

  it.each([
    ["C1 control", 0x85],
    ["bidi override", 0x202e],
    ["newline", 0x0a],
    ["angle bracket <", 0x3c],
  ])("rejects %s in the name and in the city", (_label, cp) => {
    const bad = `Fest${String.fromCodePoint(cp)}ival`;
    expect(seedFileSchema.safeParse(seed(bad)).success).toBe(false);
    expect(seedFileSchema.safeParse(seed("Fest", bad)).success).toBe(false);
  });
});
