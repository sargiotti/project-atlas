import { env } from "cloudflare:workers";
import app from "../src/index";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const get = (e: unknown, method = "GET") =>
  app.fetch(new Request("http://atlas.test/api/v1/health", { method, headers: { "cf-ray": "ray1-DUB" } }), e as never);

describe("GET /api/v1/health", () => {
  it("answers 200 {status:ok} on a fully migrated database", async () => {
    const res = await get(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers 503 {status:fail} with no internals when a probe throws, never a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error("D1_ERROR: no such column: terms_version");
        },
        batch: () => Promise.reject(new Error("D1_ERROR: no such column: terms_version")),
      },
    };
    const res = await get(broken);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"status":"fail"}');
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.map(String).join(" ");
    expect(logged).toContain("ray1-DUB");
    expect(logged).not.toContain("terms_version");
  });

  it("answers 503 when the applied migration is not the expected one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES ('9999_future.sql')").run();
    try {
      expect((await get(env)).status).toBe(503);
    } finally {
      await env.DB.prepare("DELETE FROM d1_migrations WHERE name = '9999_future.sql'").run();
    }
  });
});
