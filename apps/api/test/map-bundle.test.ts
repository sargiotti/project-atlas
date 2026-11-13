import { env } from "cloudflare:workers";
import app from "../src/index";
import { describe, expect, it } from "vitest";
import { mapBundleSchema, errorResponseSchema } from "@atlas/contract";

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

  it("returns 404 event_not_found for a valid but unknown slug", async () => {
    const res = await get("/api/v1/events/no-such-event/map-bundle");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("event_not_found");
  });

  it("returns 400 invalid_slug before touching the database", async () => {
    for (const bad of ["Bad_Slug", "ab", "a--b", "x'%20OR%201=1"]) {
      const res = await get(`/api/v1/events/${bad}/map-bundle`);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("invalid_slug");
    }
  });

  it("returns the generic not_found error for other API paths", async () => {
    const res = await get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("not_found");
  });
});
