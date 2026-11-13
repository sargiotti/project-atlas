import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it, vi } from "vitest";
import shellSource from "../../web/index.html?raw";
import headersFile from "../../web/public/_headers?raw";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { API_CSP, HTML_CSP } from "../src/http/security-headers";

const ORIGIN = "https://atlas.test.example";
const BRAND_CARD = `${ORIGIN}/og/brand-card.0badcafe.jpg`;
// The real shell with the two build-time tokens filled in, exactly as vite.config.ts does.
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", ORIGIN).replaceAll("__BRAND_CARD_URL__", BRAND_CARD);
const BIDI = String.fromCodePoint(0x202e);

const assetFetches: Request[] = [];
const ASSETS = {
  fetch: async (req: Request) => {
    assetFetches.push(req);
    return new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"shell-1"' } });
  },
};
const testEnv = (over: Record<string, unknown> = {}) => ({ DB: env.DB, ASSETS, PUBLIC_ORIGIN: ORIGIN, ...over });

const get = (path: string, init: RequestInit & { cf?: unknown } = {}, over: Record<string, unknown> = {}) =>
  app.fetch(new Request(`http://elsewhere.test${path}`, init as RequestInit), testEnv(over) as never);

const insert = (slug: string, name: string, opts: { ogKey?: string | null } = {}) =>
  env.DB.prepare(
    `INSERT INTO events (id, slug, name, start_date, end_date, city, country, og_key, language, created_at, updated_at)
     VALUES (?1, ?2, ?3, '2026-11-10', '2026-11-22', 'København', 'DK', ?4, 'en', 0, 0)`,
  ).bind(`evt_${slug}`, slug, name, opts.ogKey ?? null);

const metaContent = (html: string, selector: string) => {
  return new RegExp(`<meta ${selector} content="([^"]*)"`).exec(html)?.[1];
};

beforeEach(async () => {
  assetFetches.length = 0;
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearEventPreviewCache();
});

describe("GET /e/{slug}", () => {
  it("serves the shell with the event's meta, headers and cache policy (T2)", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026", { ogKey: "havnelobet.0123abcd.jpg" })]);
    const res = await get("/e/havnelobet");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(HTML_CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("etag")).toMatch(/^W\/"[0-9a-f]{16}"$/);

    expect(html).toContain("<title>Havneløbet 2026</title>");
    expect(metaContent(html, 'name="description"')).toBe("10–22 Nov 2026 · København, Denmark");
    expect(metaContent(html, 'property="og:url"')).toBe(`${ORIGIN}/e/havnelobet`);
    expect(metaContent(html, 'property="og:title"')).toBe("Havneløbet 2026");
    expect(metaContent(html, 'property="og:image"')).toBe(`${ORIGIN}/og/havnelobet.0123abcd.jpg`);
    expect(metaContent(html, 'name="twitter:image"')).toBe(`${ORIGIN}/og/havnelobet.0123abcd.jpg`);
    expect(metaContent(html, 'property="og:image:alt"')).toBe("Cover illustration for Havneløbet 2026");
    expect(metaContent(html, 'name="twitter:card"')).toBe("summary_large_image");
    expect(metaContent(html, 'property="og:site_name"')).toBe("Atlas");
    expect(metaContent(html, 'property="og:image:width"')).toBe("1200");
  });

  it("an event without an OG image keeps the brand card tags", async () => {
    await env.DB.batch([insert("fiesta", "Fiestas del Barrio", { ogKey: null })]);
    const html = await (await get("/e/fiesta")).text();
    expect(metaContent(html, 'property="og:title"')).toBe("Fiestas del Barrio");
    expect(metaContent(html, 'property="og:image"')).toBe(BRAND_CARD);
    expect(metaContent(html, 'name="twitter:image"')).toBe(BRAND_CARD);
    expect(metaContent(html, 'property="og:image:alt"')).toContain("Atlas logo and the tagline Find your way");
  });

  it("a stored image key with an unexpected shape is ignored (brand card)", async () => {
    await env.DB.batch([insert("odd", "Odd", { ogKey: "../../evil.jpg" })]);
    const html = await (await get("/e/odd")).text();
    expect(metaContent(html, 'property="og:image"')).toBe(BRAND_CARD);
  });

  it("escapes hostile event names in every injected attribute and in <title> (T1)", async () => {
    const name = `"><script>alert(1)</script>&'<${BIDI}`;
    await env.DB.batch([insert("evil", name, { ogKey: "evil.0123abcd.jpg" })]);
    const html = await (await get("/e/evil")).text();

    const scripts = (s: string) => s.match(/<script\b/g)?.length ?? 0;
    expect(scripts(html)).toBe(scripts(SHELL));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain(BIDI);

    // <title> is text content (setInnerContent): & is an entity, no raw angle brackets survive.
    const title = /<title>([^<]*)<\/title>/.exec(html)![1]!;
    expect(title).toBe(`"scriptalert(1)/script&amp;'`);
    expect(html).not.toContain("&amp;amp;");

    // No raw angle brackets are injected anywhere (the rewriter would leave them raw inside attributes).
    expect(html.match(/</g)!.length).toBe(SHELL.match(/</g)!.length);
    // Attributes: the quote is an entity, so every value stays inside its quotes. The regex used by
    // metaContent stops at the first raw quote, so a leak would show up as a truncated value.
    for (const sel of ['property="og:title"', 'name="twitter:title"', 'property="og:image:alt"', 'name="twitter:image:alt"']) {
      const v = metaContent(html, sel)!;
      if (sel === 'property="og:title"') expect(v).toBe("&quot;scriptalert(1)/script&amp;'");
      expect(v).toContain("&quot;");
      expect(v).toContain("alert(1)");
      expect(v).toContain("&amp;");
      expect(v).not.toContain("&amp;amp;");
    }

    // Everything outside the rewritten tags is byte-identical to the shell.
    const strip = (s: string) =>
      s
        .replace(/<title>[\s\S]*?<\/title>/, "")
        .replace(
          /<meta (?:name|property)="(?:description|og:url|og:title|og:description|og:image|og:image:alt|twitter:title|twitter:description|twitter:image|twitter:image:alt)" content="[^"]*" \/>/g,
          "",
        );
    expect(strip(html)).toBe(strip(SHELL));
  });

  it("collapses newlines and caps long text", async () => {
    await env.DB.batch([insert("long", `Line one\r\nline\ttwo ${"x".repeat(300)}`)]);
    const html = await (await get("/e/long")).text();
    const title = metaContent(html, 'property="og:title"')!;
    expect(title).not.toMatch(/[\r\n\t]/);
    expect(Array.from(title)).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
  });

  it("is byte-identical whatever the requester sends (T3) and ignores the query", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026", { ogKey: "havnelobet.0123abcd.jpg" })]);
    const variants: Array<[string, RequestInit & { cf?: unknown }]> = [
      ["/e/havnelobet", {}],
      ["/e/havnelobet?near=IE&utm=x", { cf: { country: "IE", city: "Galway", latitude: "53.27", longitude: "-9.05" } }],
      [
        "/e/havnelobet",
        { headers: { "user-agent": "WhatsApp/2.23", "accept-language": "de", cookie: "a=b", "x-forwarded-host": "evil.example" } },
      ],
      ["/e/havnelobet/", { cf: { country: "DK" } }],
    ];
    const bodies = await Promise.all(variants.map(async ([p, init]) => (await get(p, init)).text()));
    for (const b of bodies) expect(b).toBe(bodies[0]);
    expect(metaContent(bodies[0]!, 'property="og:url"')).toBe(`${ORIGIN}/e/havnelobet`);
    expect(bodies[0]).not.toContain("evil.example");
    expect(bodies[0]).not.toContain("elsewhere.test");
  });

  it("fetches the shell cleanly: client headers are not forwarded to ASSETS (B3)", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026")]);
    await get("/e/havnelobet", {
      headers: { "if-none-match": '"x"', range: "bytes=0-10", "if-modified-since": "Wed, 01 Jan 2020 00:00:00 GMT" },
    });
    expect(assetFetches).toHaveLength(1);
    expect(assetFetches[0]!.method).toBe("GET");
    expect(new URL(assetFetches[0]!.url).pathname).toBe("/");
    const names = [...assetFetches[0]!.headers.keys()];
    expect(names).not.toContain("if-none-match");
    expect(names).not.toContain("range");
    expect(names).not.toContain("if-modified-since");
  });

  it("answers 304 on a matching If-None-Match and HEAD with the same headers and no body (R6)", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026")]);
    const first = await get("/e/havnelobet");
    const etag = first.headers.get("etag")!;

    const notModified = await get("/e/havnelobet", { headers: { "if-none-match": etag } });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");

    const head = await get("/e/havnelobet", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const h of ["etag", "cache-control", "content-security-policy", "content-type"]) {
      expect(head.headers.get(h)).toBe(first.headers.get(h));
    }
  });

  it("changes the ETag when the event's text changes", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026")]);
    const a = (await get("/e/havnelobet")).headers.get("etag");
    await env.DB.prepare("UPDATE events SET name = 'Havneløbet 2027' WHERE slug = 'havnelobet'").run();
    clearEventPreviewCache();
    expect((await get("/e/havnelobet")).headers.get("etag")).not.toBe(a);
  });
});

describe("unknown and invalid paths", () => {
  it.each(["/e/does-not-exist", "/e/", "/e//", "/e/a/b", "/e/UPPER", "/e/bad_slug", "/e/%00", "/e/" + "a".repeat(100)])(
    "%s is a 404 HTML shell with brand meta (T2, B2)",
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      expect(res.headers.get("content-security-policy")).toBe(HTML_CSP);
      expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
      const html = await res.text();
      expect(html).toBe(SHELL);
      expect(metaContent(html, 'property="og:title"')).toBe("Atlas — Find YOUR way");
      expect(metaContent(html, 'property="og:image"')).toBe(BRAND_CARD);
    },
  );

  it("invalid slugs never reach D1 (B6)", async () => {
    const prepare = vi.fn(() => {
      throw new Error("D1 must not be used");
    });
    const res = await get("/e/Not_A_Slug", {}, { DB: { prepare } });
    expect(res.status).toBe(404);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("valid unknown slugs are answered from one bounded query, not one per slug", async () => {
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026")]);
    const prepare = vi.fn((sql: string) => env.DB.prepare(sql));
    for (const slug of ["a-1", "a-2", "a-3", "havnelobet"]) await get(`/e/${slug}`, {}, { DB: { prepare } });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});

describe("failure handling", () => {
  it("fails open with the unmodified shell, 200 and no-store when D1 throws (R4)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(
      "/e/havnelobet?secret=1",
      { headers: { "cf-ray": "ray9" } },
      {
        DB: {
          prepare: () => {
            throw new Error("D1_ERROR: boom");
          },
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(HTML_CSP);
    expect(await res.text()).toBe(SHELL);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]![0]);
    expect(line).toContain("requestId=ray9");
    expect(line).not.toContain("secret");
    spy.mockRestore();
  });

  it("fails open when PUBLIC_ORIGIN is misconfigured, and when the shell lost a placeholder", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.batch([insert("havnelobet", "Havneløbet 2026")]);
    const badOrigin = await get("/e/havnelobet", {}, { PUBLIC_ORIGIN: "http://insecure.example/path" });
    expect(badOrigin.status).toBe(200);
    expect(await badOrigin.text()).toBe(SHELL);

    clearEventPreviewCache();
    const broken = SHELL.replace(/<meta property="og:title"[^>]*>/, "");
    const res = await get("/e/havnelobet", {}, {
      ASSETS: { fetch: async () => new Response(broken, { headers: { "content-type": "text/html" } }) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(broken);
    spy.mockRestore();
  });

  it("answers an HTML 503 (not JSON) when the shell itself cannot be loaded", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("/e/havnelobet", {}, { ASSETS: { fetch: async () => new Response("nope", { status: 500 }) } });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    spy.mockRestore();
  });
});

describe("headers stay in line", () => {
  it("HTML_CSP and API_CSP equal the /* block of _headers", () => {
    const csp = /^\s*Content-Security-Policy: (.+)$/m.exec(headersFile)![1];
    expect(HTML_CSP).toBe(csp);
    expect(API_CSP).toBe(csp);
  });

  it("the API keeps its own CSP, unaffected by the HTML route", async () => {
    const res = await get("/api/v1/events/nope-nope/map-bundle");
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
  });
});
