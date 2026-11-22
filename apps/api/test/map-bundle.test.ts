import { env } from "cloudflare:workers";
import app from "../src/index";
import { describe, expect, it } from "vitest";
import { mapBundleSchema, errorResponseSchema, toneOf } from "@atlas/contract";

const get = (path: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request(`http://atlas.test${path}`, { headers }), env);

describe("GET /api/v1/events/:slug/map-bundle", () => {
  it("returns the Map Bundle of a seeded event with contract headers and ETag/304", async () => {
    const res = await get("/api/v1/events/tiny-fest/map-bundle");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const bundle = mapBundleSchema.parse(await res.json());
    expect(bundle.event).toEqual({
      slug: "tiny-fest",
      name: "Tiny Fest",
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      language: "en",
      timeZone: "Europe/Dublin",
      dayStart: "06:00",
      city: "Testville",
      country: "IE",
      cover: null,
      tone: toneOf("evt_tiny-fest"),
      isDemo: true, // seeded: owner_id IS NULL
    });
    expect(bundle.map.theme).toBe("dark");
    expect(bundle.map.image.variants).toEqual([
      { url: expect.stringMatching(/^\/maps\/tiny-fest\.[0-9a-f]{8}\.svg$/), width: 200 },
    ]);
    // Ordered by category enum order (stage, food, toilets), ids prefixed with the slug.
    expect(bundle.points.map((p) => p.id)).toEqual(["tiny-fest-stage", "tiny-fest-burgers", "tiny-fest-wc"]);

    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);
    const cached = await get("/api/v1/events/tiny-fest/map-bundle", { "If-None-Match": etag });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
  });

  it("ships sessions in the bundle: UTC, ordered by start, optional description omitted", async () => {
    const bundle = mapBundleSchema.parse(await (await get("/api/v1/events/tiny-fest/map-bundle")).json());
    // Dublin is UTC+1 in July: 18:00 local = 17:00Z; 00:30 on Saturday local = 23:30Z on Friday.
    expect(bundle.sessions).toEqual([
      { id: "tiny-fest-s-fri-early", pointId: "tiny-fest-stage", title: "Opening Set", start: "2026-07-10T17:00:00Z", end: "2026-07-10T18:00:00Z" },
      {
        id: "tiny-fest-s-fri-late",
        pointId: "tiny-fest-stage",
        title: "Late Set",
        start: "2026-07-10T23:30:00Z",
        end: "2026-07-11T01:00:00Z",
        description: "After midnight.\nSecond line; with, commas.",
      },
      { id: "tiny-fest-s-sat-burgers", pointId: "tiny-fest-burgers", title: "Burger eating contest", start: "2026-07-11T12:00:00Z", end: "2026-07-11T13:00:00Z" },
    ]);
  });

  it("isDemo is false for an organizer's event (owner_id set)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org_bundle', 'sub-bundle', 'bundle@example.test', 'Bundle', 'organizer', 0)",
      ),
      env.DB.prepare(
        "INSERT INTO events (id, slug, name, start_date, end_date, language, publish_state, owner_id, created_at, updated_at) VALUES ('evt_owned', 'owned-fest', 'Owned', '2026-08-01', '2026-08-02', 'en', 'published', 'org_bundle', 0, 0)",
      ),
      env.DB.prepare(
        "INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES ('map_owned', 'evt_owned', 1, 10, 10, 'light', 'owned.aaaaaaaa.svg', 'svg', 0, 0)",
      ),
    ]);
    const bundle = mapBundleSchema.parse(await (await get("/api/v1/events/owned-fest/map-bundle")).json());
    expect(bundle.event.isDemo).toBe(false);
  });

  it("serves an empty sessions list for an event without a programme", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO events (id, slug, name, start_date, end_date, language, publish_state, created_at, updated_at) VALUES ('evt_bare', 'bare-fest', 'Bare', '2026-08-01', '2026-08-02', 'en', 'published', 0, 0)",
      ),
      env.DB.prepare(
        "INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES ('map_bare', 'evt_bare', 1, 10, 10, 'light', 'bare.aaaaaaaa.svg', 'svg', 0, 0)",
      ),
    ]);
    const bundle = mapBundleSchema.parse(await (await get("/api/v1/events/bare-fest/map-bundle")).json());
    expect(bundle.sessions).toEqual([]);
    expect(bundle.event.timeZone).toBe("UTC"); // migration default
    expect(bundle.event.dayStart).toBe("06:00");
  });

  it("a seeded event's session before the first day's start is dropped (and logged), not a 500", async () => {
    // tiny-fest: Europe/Dublin, dayStart 06:00, first day 2026-07-10. 00:30 local on the 10th is 23:30Z on the 9th: outside the window.
    await env.DB.prepare(
      "INSERT INTO point_sessions (id, event_id, point_id, title, start_utc, end_utc, created_at, updated_at) VALUES ('early-1', 'evt_tiny-fest', 'tiny-fest-stage', 'Too early', '2026-07-09T23:30:00Z', '2026-07-10T00:30:00Z', 0, 0)",
    ).run();
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    try {
      const res = await get("/api/v1/events/tiny-fest/map-bundle");
      expect(res.status).toBe(200);
      const bundle = mapBundleSchema.parse(await res.json());
      expect(bundle.sessions.map((x) => x.title)).not.toContain("Too early");
      expect(bundle.sessions.length).toBeGreaterThan(0);
    } finally {
      console.error = orig;
      await env.DB.prepare("DELETE FROM point_sessions WHERE id = 'early-1'").run();
    }
    expect(errors.join("\n")).toMatch(/\[bundle\] dropped 1 session\(s\) outside the event window slug=tiny-fest/);
  });

  it("answers 404 event_not_found, 400 invalid_slug (before the database) and the generic not_found", async () => {
    const res = await get("/api/v1/events/no-such-event/map-bundle");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("event_not_found");

    for (const bad of ["Bad_Slug", "ab", "a--b", "x'%20OR%201=1"]) {
      const res = await get(`/api/v1/events/${bad}/map-bundle`);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("invalid_slug");
    }

    const other = await get("/api/v1/nope");
    expect(other.status).toBe(404);
    expect(errorResponseSchema.parse(await other.json()).error.code).toBe("not_found");
  });

});
