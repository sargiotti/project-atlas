import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mapBundleSchema, parseUtcInstant, sessionDay } from "@atlas/contract";
import { loadAllSeeds, resolveSessions } from "../scripts/seed-lib";

const root = resolve(import.meta.dirname, "../../..");
// Same folders and precedence as `npm run seed` (AI maps replace the SVG ones with the same slug).
const seeds = loadAllSeeds([resolve(root, "design/assets/demo-maps"), resolve(root, "design/assets/demo-maps-ai")]);
const bySlug = (slug: string) => seeds.find((s) => s.seed.event.slug === slug)!;

/** What the API would serve for a seed: the seed run through the same contract as the Map Bundle. */
function bundleOf(slug: string) {
  const { seed } = bySlug(slug);
  return mapBundleSchema.parse({
    event: {
      slug,
      name: seed.event.name,
      startDate: seed.event.dates.start,
      endDate: seed.event.dates.end,
      language: seed.event.language,
      timeZone: seed.event.timeZone,
      dayStart: seed.event.dayStart,
    },
    map: { id: "m", theme: seed.event.mapTheme, width: seed.map.width, height: seed.map.height, image: { format: "webp", variants: [{ url: "/maps/x.webp", width: 1 }] } },
    points: seed.points.map((p) => ({ ...p, id: `${slug}-${p.id}` })),
    sessions: resolveSessions(seed),
  });
}

describe("demo seed programme", () => {
  it("all demo events pass the Map Bundle contract with their sessions", () => {
    for (const s of seeds) expect(() => bundleOf(s.seed.event.slug), s.seed.event.slug).not.toThrow();
  });

  it("nightfall-meadows has 3+ stages, overlapping sets, an after-midnight set and a very long name", () => {
    const b = bundleOf("nightfall-meadows");
    const stages = b.points.filter((p) => p.category === "stage");
    expect(stages.length).toBeGreaterThanOrEqual(3);
    const ms = (iso: string) => parseUtcInstant(iso)!;
    const overlaps = b.sessions.some((a) =>
      b.sessions.some((c) => a.pointId !== c.pointId && ms(a.start) < ms(c.end) && ms(c.start) < ms(a.end)),
    );
    expect(overlaps).toBe(true);
    // Starts after local midnight but belongs to the previous day's grid.
    const late = b.sessions.find((s) => sessionDay(ms(s.start), b.event.timeZone, b.event.dayStart) < b.event.endDate && s.title === "Neon Orchard")!;
    expect(sessionDay(ms(late.start), "Europe/Dublin", "06:00")).toBe("2026-07-10");
    expect(Math.max(...b.sessions.map((s) => s.title.length))).toBeGreaterThan(80);
  });

  it("fiestas-la-alameda has the church landmark clear of every other point, with a programme", () => {
    const b = bundleOf("fiestas-la-alameda");
    const church = b.points.find((p) => p.category === "landmark")!;
    expect(church.name).toBe("Parroquia de San Valero");
    for (const p of b.points.filter((p) => p !== church)) {
      expect(Math.hypot(p.x - church.x, (p.y - church.y) * 1.33), p.id).toBeGreaterThan(0.08);
    }
    expect(b.sessions.filter((s) => s.pointId === church.id).length).toBeGreaterThanOrEqual(3);
  });
});
