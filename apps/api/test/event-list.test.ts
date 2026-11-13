import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_EVENTS_IN_LIST, eventListSchema } from "@atlas/contract";
import { clearListEventsCache } from "../src/application/list-events";

const get = (path: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`http://atlas.test${path}`, { headers }), env);

const insert = (slug: string, start: string, cover: string | null) =>
  env.DB.prepare(
    `INSERT INTO events (id, slug, name, start_date, end_date, city, country, cover_key, cover_width, cover_height, language, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4, 'Galway', 'IE', ?5, ?6, ?7, 'en', 0, 0)`,
  ).bind(`evt_${slug}`, slug, slug, start, cover, cover ? 960 : null, cover ? 640 : null);

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
    const res = await get("/api/v1/events?lat=1&near=XX", { "cf-connecting-ip": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
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
    });
    expect(list.find((e) => e.slug === "zeta-fest")!.cover).toEqual({
      url: "/covers/zeta-fest.0123abcd.webp",
      width: 960,
      height: 640,
    });
    expect(Object.keys(tiny).sort()).toEqual(["city", "country", "cover", "endDate", "name", "slug", "startDate"]);
  });

  it("answers 304 to a matching If-None-Match", async () => {
    const first = await get("/api/v1/events");
    const second = await get("/api/v1/events", { "If-None-Match": first.headers.get("etag")! });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
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
