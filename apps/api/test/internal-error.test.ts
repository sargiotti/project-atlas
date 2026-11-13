import { env } from "cloudflare:workers";
import app from "../src/index";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("unexpected failures", () => {
  it("return a generic 500 without internals, and log only name, message and request id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenEnv = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error("D1_ERROR: no such table: secret_table");
        },
      },
    };
    const res = await app.fetch(
      new Request("http://atlas.test/api/v1/events?token=s3cret", {
        headers: { "cf-ray": "ray123-DUB", "cf-connecting-ip": "203.0.113.9" },
      }),
      brokenEnv as never,
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: "internal_error", message: "Internal error.", requestId: "ray123-DUB" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0]!.map(String).join(" ");
    expect(logged).toContain("ray123-DUB");
    expect(logged).toContain("D1_ERROR");
    expect(logged).not.toContain("203.0.113.9");
    expect(logged).not.toContain("s3cret");
  });
});
