import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_EVENTS_IN_LIST, eventListSchema } from "@atlas/contract";
import { clearListEventsCache } from "../src/application/list-events";

const get = (path: string, headers: Record<string, string> = {}, cf?: Record<string, unknown>) =>
  app.fetch(new Request(`http://atlas.test${path}`, { headers, ...(cf ? { cf } : {}) } as RequestInit), env);

const nearbyBySlug = async (res: Response) =>
  Object.fromEntries(eventListSchema.parse(await res.json()).map((e) => [e.slug, e.nearby]));

const insert = (
  slug: string,
  start: string,
  cover: string | null,
  place: { country: string; lat: number | null; lng: number | null } = { country: "IE", lat: null, lng: null },
) =>
  env.DB.prepare(
    `INSERT INTO events (id, slug, name, start_date, end_date, city, country, latitude, longitude, cover_key, cover_width, cover_height, language, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 'Galway', ?8, ?9, ?10, ?5, ?6, ?7, 'en', 0, 0)`,
  ).bind(`evt_${slug}`, slug, slug, start, cover, cover ? 960 : null, cover ? 640 : null, place.country, place.lat, place.lng);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearListEventsCache();
});

describe("GET /api/v1/events", () => {
  it("lists event summaries ordered by start date then slug, with cover or null", async () => {
    await env.DB.batch([
      insert("zeta-fest", "2026-07-10", "zeta-fest.0123abcd.webp"),
      insert("alpha-fest", "2026-07-10", null),
      insert("early-fest", "2026-01-01", null),
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
      nearby: false,
    });
    expect(list.find((e) => e.slug === "zeta-fest")!.cover).toEqual({
      url: "/covers/zeta-fest.0123abcd.webp",
      width: 960,
      height: 640,
    });
    expect(Object.keys(tiny).sort()).toEqual(["city", "country", "cover", "endDate", "name", "nearby", "slug", "startDate"]);
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await get("/api/v1/events");
    const second = await get("/api/v1/events", { "If-None-Match": first.headers.get("etag")! });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("marks events nearby per request from request.cf, without mutating shared state", async () => {
    await env.DB.batch([
      insert("dublin-fest", "2026-08-01", null, { country: "IE", lat: 53.35, lng: -6.26 }),
      insert("madrid-fest", "2026-08-02", null, { country: "ES", lat: 40.42, lng: -3.7 }),
      insert("nocoords-es", "2026-08-03", null, { country: "ES", lat: null, lng: null }),
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

  it.each(["?near=ES", "?near=none", "?near=garbage", "?near=", "?near=es&x=1"])(
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
      Array.from({ length: 60 }, (_, i) => insert(`bulk-${String(i).padStart(2, "0")}`, "2026-08-01", null)),
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
