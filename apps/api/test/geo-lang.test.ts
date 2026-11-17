import { env } from "cloudflare:workers";
import app from "../src/index";
import { describe, expect, it } from "vitest";
import { geoLangSchema } from "@atlas/contract";
import { API_CSP } from "../src/http/security-headers";

const get = (path: string, cf?: Record<string, unknown>) =>
  app.fetch(new Request(`http://atlas.test${path}`, (cf ? { cf } : {}) as RequestInit), env);

describe("GET /api/v1/geo-lang", () => {
  it("answers ca for Catalonia and null elsewhere, private-cached, with API security headers", async () => {
    const ct = await get("/api/v1/geo-lang", { country: "ES", regionCode: "CT" });
    expect(ct.status).toBe(200);
    expect(geoLangSchema.parse(await ct.json())).toEqual({ lang: "ca" });
    expect(ct.headers.get("cache-control")).toBe("private, max-age=600");
    expect(ct.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ct.headers.get("content-security-policy")).toBe(API_CSP);
    expect(ct.headers.get("access-control-allow-origin")).toBeNull();

    for (const cf of [{ country: "US", regionCode: "CT" }, { country: "ES", regionCode: "MD" }, undefined]) {
      const res = await get("/api/v1/geo-lang", cf);
      expect(geoLangSchema.parse(await res.json())).toEqual({ lang: null });
      expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    }
  });

  it("?geo= override forces the answer, is no-store, has no ETag and is never echoed", async () => {
    const ct = await get("/api/v1/geo-lang?geo=ct", { country: "IE" });
    expect(await ct.json()).toEqual({ lang: "ca" });
    const none = await get("/api/v1/geo-lang?geo=NONE", { country: "ES", regionCode: "CT" });
    expect(await none.json()).toEqual({ lang: null });
    const junk = await get("/api/v1/geo-lang?geo=%3Cscript%3E", { country: "ES", regionCode: "CT" });
    const text = await junk.text();
    expect(JSON.parse(text)).toEqual({ lang: "ca" }); // invalid: real location used
    expect(text).not.toContain("script");
    for (const res of [ct, none, junk]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("etag")).toBeNull();
    }
  });
});
