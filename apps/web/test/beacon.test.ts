import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { beaconTag } from "../beaconTag";

const loader = readFileSync(resolve(import.meta.dirname, "../public/beacon-loader.js"), "utf8");
const TOKEN = "0123456789abcdef0123456789abcdef";

function runLoader(path: string, token: string | null) {
  document.head.innerHTML = token ? `<script data-atlas-beacon="${token}"></script>` : "";
  window.history.pushState({}, "", path);
  new Function(loader)();
  return document.head.querySelector<HTMLScriptElement>('script[src*="cloudflareinsights"]');
}

describe("beacon loader", () => {
  beforeEach(() => (document.head.innerHTML = ""));

  it("loads the beacon with the token on normal pages, including the rest of the panel", () => {
    for (const path of ["/", "/e/some-event", "/panel", "/panel/login", "/panel/events/abc"]) {
      const s = runLoader(path, TOKEN);
      expect(s, path).not.toBeNull();
      expect(s!.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
      expect(JSON.parse(s!.getAttribute("data-cf-beacon")!)).toEqual({ token: TOKEN });
    }
  });

  it("never loads the beacon on a token-bearing invite URL", () => {
    expect(runLoader("/panel/invite/abcDEF123_-token", TOKEN)).toBeNull();
    expect(runLoader("/panel/invite/abc/?error=err_invite_email_mismatch", TOKEN)).toBeNull();
  });

  it("does nothing without a token", () => {
    expect(runLoader("/", null)).toBeNull();
  });
});

describe("beaconTag plugin", () => {
  async function tags(command: "build" | "serve", mode: string, token?: string) {
    if (token === undefined) delete process.env.VITE_CF_BEACON_TOKEN;
    else process.env.VITE_CF_BEACON_TOKEN = token;
    const p: any = beaconTag();
    p.configResolved({ command, mode, root: resolve(import.meta.dirname, "../test/__none__") });
    return p.transformIndexHtml.handler();
  }

  it("adds the loader tag only for a production build with a token", async () => {
    const t = await tags("build", "production", TOKEN);
    expect(t).toHaveLength(1);
    expect(t[0].attrs).toMatchObject({ src: "/beacon-loader.js", "data-atlas-beacon": TOKEN });
    expect(await tags("build", "production")).toEqual([]);
    expect(await tags("serve", "development", TOKEN)).toEqual([]);
    expect(await tags("build", "test", TOKEN)).toEqual([]);
    delete process.env.VITE_CF_BEACON_TOKEN;
  });

  it("rejects a malformed token", async () => {
    await expect(tags("build", "production", 'x"><script>')).rejects.toThrow();
    delete process.env.VITE_CF_BEACON_TOKEN;
  });
});
