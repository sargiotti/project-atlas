import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_EVENTS_IN_LIST, billboardSchema, eventListSchema, toneOf } from "@atlas/contract";
import { clearBillboardCache } from "../src/application/get-billboard";
import { clearListEventsCache } from "../src/application/list-events";

const get = (path: string, headers: Record<string, string> = {}, cf?: Record<string, unknown>) =>
  app.fetch(new Request(`http://atlas.test${path}`, { headers, ...(cf ? { cf } : {}) } as RequestInit), env);

const nearbyBySlug = async (res: Response) =>
  Object.fromEntries(eventListSchema.parse(await res.json()).map((e) => [e.slug, e.nearby]));

const HEX = "0123abcd".repeat(4);
const insert = (
  slug: string,
  start: string,
  cover: boolean,
  place: { country: string; lat: number | null; lng: number | null } = { country: "IE", lat: null, lng: null },
) => [
  env.DB.prepare(
    `INSERT INTO events (id, slug, name, start_date, end_date, city, country, latitude, longitude, language, publish_state, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 'Galway', ?5, ?6, ?7, 'en', 'published', 0, 0)`,
  ).bind(`evt_${slug}`, slug, slug, start, place.country, place.lat, place.lng),
  ...(cover
    ? [
        env.DB.prepare(
          `INSERT INTO event_covers (event_id, full_key, full_width, full_height, small_key, small_width, small_height, og_key, focal_x, focal_y, created_at, updated_at)
           VALUES (?1, ?2, 960, 640, ?3, 800, 533, ?4, 0.3, 0.7, 0, 0)`,
        ).bind(`evt_${slug}`, `covers/evt_${slug}/${HEX}-full.webp`, `covers/evt_${slug}/${HEX}-800.webp`, `covers/evt_${slug}/${HEX}-og.jpg`),
      ]
    : []),
];

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearListEventsCache();
});

describe("GET /api/v1/events", () => {
  it("lists event summaries ordered by start date then slug, with cover or null", async () => {
    await env.DB.batch([
      ...insert("zeta-fest", "2026-07-10", true),
      ...insert("alpha-fest", "2026-07-10", false),
      ...insert("early-fest", "2026-01-01", false),
    ]);
    const res = await get("/api/v1/events?lat=1", { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{16}"$/);

    const list = eventListSchema.parse(await res.json());
    expect(list.map((e) => e.slug)).toEqual(["early-fest", "alpha-fest", "tiny-fest", "zeta-fest"]);
    const tiny = list.find((e) => e.slug === "tiny-fest")!;
    expect(tiny).toEqual({
      slug: "tiny-fest",
      name: "Tiny Fest",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      city: "Testville",
      country: "IE",
      cover: null,
      tone: toneOf("evt_tiny-fest"),
      nearby: false,
    });
    expect(list.find((e) => e.slug === "zeta-fest")!.cover).toEqual({
      url: `/media/covers/evt_zeta-fest/${HEX}-full.webp`,
      url800: `/media/covers/evt_zeta-fest/${HEX}-800.webp`,
      width: 960,
      height: 640,
      focal: { x: 0.3, y: 0.7 },
    });
    // Public keys only: no id field (only the bounded tone; the id appears only inside a cover URL, as for maps), no og file.
    expect(Object.keys(tiny).sort()).toEqual(["city", "country", "cover", "endDate", "name", "nearby", "slug", "startDate", "tone"]);
    expect(JSON.stringify(tiny)).not.toContain("evt_");
    expect(JSON.stringify(list)).not.toContain("-og.jpg");
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await get("/api/v1/events");
    const second = await get("/api/v1/events", { "If-None-Match": first.headers.get("etag")! });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("marks events nearby per request from request.cf, without mutating shared state", async () => {
    await env.DB.batch([
      ...insert("dublin-fest", "2026-08-01", false, { country: "IE", lat: 53.35, lng: -6.26 }),
      ...insert("madrid-fest", "2026-08-02", false, { country: "ES", lat: 40.42, lng: -3.7 }),
      ...insert("nocoords-es", "2026-08-03", false, { country: "ES", lat: null, lng: null }),
    ]);
    const inDublin = { country: "IE", latitude: "53.3", longitude: "-6.3" };
    const inMadrid = { country: "ES", latitude: "40.4", longitude: "-3.7" };
    const a = await nearbyBySlug(await get("/api/v1/events", {}, inDublin));
    const b = await nearbyBySlug(await get("/api/v1/events", {}, inMadrid));
    const c = await nearbyBySlug(await get("/api/v1/events", {}, inDublin));
    expect(a).toMatchObject({ "dublin-fest": true, "madrid-fest": false, "nocoords-es": false, "tiny-fest": true });
    expect(b).toMatchObject({ "dublin-fest": false, "madrid-fest": true, "nocoords-es": true, "tiny-fest": false });
    expect(c).toEqual(a);
  });

  it("flags nothing when the location is unknown (cf absent, XX, T1)", async () => {
    const unknown = [undefined, { country: "XX" }, { country: "T1" }, { country: "XX", latitude: "abc", longitude: "1" }];
    for (const cf of unknown) {
      const flags = Object.values(await nearbyBySlug(await get("/api/v1/events", {}, cf)));
      expect(flags.length).toBeGreaterThan(0);
      expect(flags.every((f) => f === false)).toBe(true);
    }
  });

  it("changes the ETag when the nearby set changes", async () => {
    const inIreland = await get("/api/v1/events", {}, { country: "IE" });
    const inSpain = await get("/api/v1/events", {}, { country: "ES" });
    const inIreland2 = await get("/api/v1/events", {}, { country: "IE" });
    expect(inIreland.headers.get("etag")).not.toBe(inSpain.headers.get("etag"));
    expect(inIreland.headers.get("etag")).toBe(inIreland2.headers.get("etag"));
  });

  it.each(["?near=es&x=1", "?near=garbage"])(
    "any near param (%s) is no-store, has no ETag and ignores If-None-Match",
    async (qs) => {
      const plain = await get("/api/v1/events");
      const res = await get(`/api/v1/events${qs}`, { "If-None-Match": plain.headers.get("etag")! });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("etag")).toBeNull();
    },
  );

  it("near override replaces the country (coordinates ignored); invalid falls back to the real location", async () => {
    const real = { country: "IE", latitude: "53.3", longitude: "-6.3" };
    expect((await nearbyBySlug(await get("/api/v1/events?near=ES", {}, real)))["tiny-fest"]).toBe(false);
    expect((await nearbyBySlug(await get("/api/v1/events?near=ie", {}, { country: "ES" })))["tiny-fest"]).toBe(true);
    expect((await nearbyBySlug(await get("/api/v1/events?near=none", {}, real)))["tiny-fest"]).toBe(false);
    expect((await nearbyBySlug(await get("/api/v1/events?near=nope", {}, real)))["tiny-fest"]).toBe(true);
  });

  it(`never returns more than ${MAX_EVENTS_IN_LIST} events`, async () => {
    await env.DB.batch(
      Array.from({ length: 60 }, (_, i) => insert(`bulk-${String(i).padStart(2, "0")}`, "2026-08-01", false)).flat(),
    );
    const list = eventListSchema.parse(await (await get("/api/v1/events")).json());
    expect(list).toHaveLength(MAX_EVENTS_IN_LIST);
  });

  it("returns an empty array, not 404, when there are no events", async () => {
    await env.DB.prepare("DELETE FROM events").run();
    const res = await get("/api/v1/events");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    await env.DB.batch(env.TEST_SEED.map((sql) => env.DB.prepare(sql)));
  });
});

describe("GET /api/v1/billboard", () => {
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const parse = (text: string) => billboardSchema.parse(JSON.parse(text));
  const galwayCf = { country: "IE", latitude: "53.27", longitude: "-9.05" };

  beforeEach(() => clearBillboardCache());

  it("groups published events, flags demo events, hides ended ones", async () => {
    await env.DB.batch([
      ...insert("ended-fest", plusDays(-30), false),
      ...insert("running-fest", today, false),
      ...insert("far-fest", plusDays(60), false),
    ]);
    await env.DB.prepare("UPDATE events SET end_date = ?1 WHERE slug = 'ended-fest'").bind(plusDays(-20)).run();
    const res = await get("/api/v1/billboard");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const text = await res.text();
    const b = parse(text);
    const all = b.windows.flatMap((w) => w.events);
    expect(all.map((e) => e.slug)).not.toContain("ended-fest");
    expect(b.windows.find((w) => w.id === "now")!.events.map((e) => e.slug)).toContain("running-fest");
    expect(b.windows.find((w) => w.id === "later")!.events.map((e) => e.slug)).toContain("far-fest");
    expect(all.find((e) => e.slug === "running-fest")!.isDemo).toBe(true);
    expect(text).not.toMatch(/evt_|latitude|longitude|timeZone|time_zone/);
  });

  it("a valid place marks nearby events and is no-store; an unknown place is ignored and never echoed", async () => {
    await env.DB.batch([
      ...insert("valencia-fest", plusDays(60), false, { country: "ES", lat: 39.47, lng: -0.38 }),
      ...insert("galway-fest", plusDays(61), false, { country: "IE", lat: 53.27, lng: -9.05 }),
    ]);
    const picked = await get("/api/v1/billboard?place=valencia", {}, galwayCf);
    expect(picked.headers.get("cache-control")).toBe("no-store");
    expect(picked.headers.get("etag")).toBeNull();
    const events = parse(await picked.text()).windows.flatMap((w) => w.events);
    expect(events.find((e) => e.slug === "valencia-fest")!.nearby).toBe(true);
    expect(events.find((e) => e.slug === "galway-fest")!.nearby).toBe(false);

    const unknown = await get("/api/v1/billboard?place=%3Cb%3Eatlantis", {}, galwayCf);
    expect(unknown.headers.get("cache-control")).toBe("no-store");
    const text = await unknown.text();
    expect(text).not.toContain("atlantis");
    const ub = parse(text).windows.flatMap((w) => w.events);
    expect(ub.find((e) => e.slug === "galway-fest")!.nearby).toBe(true);
  });

  it("never reveals the visitor's location", async () => {
    await env.DB.batch(insert("galway-fest", plusDays(60), false, { country: "IE", lat: 53.27, lng: -9.05 }));
    const res = await get("/api/v1/billboard", {}, { ...galwayCf, city: "Galway" });
    const text = await res.text();
    expect(text).not.toMatch(/53\.27|-9\.05|detected/);
    expect(Object.keys(JSON.parse(text))).toEqual(["windows"]);
  });
});
