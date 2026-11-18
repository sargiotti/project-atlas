import { env } from "cloudflare:workers";
import app from "../src/index";
import { describe, expect, it } from "vitest";
import { decideHost, PUBLIC_ORIGIN, REDIRECT_STATUS } from "../src/http/canonical-host";

describe("decideHost", () => {
  it("serves the canonical host", () => {
    expect(decideHost("https://leyenda.ink/e/havnelobet", "GET")).toEqual({ action: "serve" });
    expect(decideHost("https://leyenda.ink/api/v1/panel/events", "POST")).toEqual({ action: "serve" });
  });

  it("redirects www and the old workers.dev host, keeping path and query", () => {
    for (const host of ["www.leyenda.ink", "atlas.sargiotti67.workers.dev"]) {
      expect(decideHost(`https://${host}/e/havnelobet?lang=ca&x=%20y`, "GET")).toEqual({
        action: "redirect",
        location: `${PUBLIC_ORIGIN}/e/havnelobet?lang=ca&x=%20y`,
      });
      expect(decideHost(`https://${host}/`, "HEAD")).toEqual({ action: "redirect", location: "https://leyenda.ink/" });
    }
  });

  it("serves unknown, preview and local hosts unchanged (exact match only)", () => {
    for (const host of [
      "abc123-atlas.sargiotti67.workers.dev",
      "evil-www.leyenda.ink",
      "www.leyenda.ink.evil.test",
      "localhost:8787",
      "atlas.test",
    ]) {
      expect(decideHost(`https://${host}/x`, "GET")).toEqual({ action: "serve" });
    }
  });

  it("rejects non-GET/HEAD on a redirected host", () => {
    expect(decideHost("https://www.leyenda.ink/api/v1/panel/events", "POST")).toEqual({ action: "reject" });
  });
});

describe("canonical host in the Worker", () => {
  const call = (url: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
    app.fetch(new Request(url, { ...init, headers, redirect: "manual" }), env);

  it("redirects navigations on the old host to the fixed origin, ignoring Host-like headers", async () => {
    const res = await call("https://atlas.sargiotti67.workers.dev/e/havnelobet?a=1", {}, { "X-Forwarded-Host": "evil.test", Host: "evil.test" });
    expect(res.status).toBe(REDIRECT_STATUS);
    expect(res.headers.get("location")).toBe("https://leyenda.ink/e/havnelobet?a=1");
    expect(await res.text()).toBe("");
  });

  it("POST to the panel API on a non-canonical host is 403, never a redirect", async () => {
    for (const host of ["www.leyenda.ink", "atlas.sargiotti67.workers.dev"]) {
      const res = await call(`https://${host}/api/v1/panel/events`, { method: "POST", body: "{}" }, { "content-type": "application/json" });
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_origin");
    }
  });
});
