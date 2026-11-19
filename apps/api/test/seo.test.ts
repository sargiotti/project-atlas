import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import shellSource from "../../web/index.html?raw";

const ORIGIN = "https://leyenda.ink";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", ORIGIN).replaceAll("__BRAND_CARD_URL__", `${ORIGIN}/og/brand-card.0badcafe.jpg`);
// Stands in for the static assets: the SPA fallback for any path, with the _headers rule of /panel* (applied by the platform in production).
const ASSETS = {
  fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
    if (path.startsWith("/panel")) Object.assign(headers, { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" });
    return new Response(SHELL, { headers });
  },
};
const call = (path: string, init: RequestInit = {}, host = "leyenda.ink") =>
  app.fetch(new Request(`https://${host}${path}`, { redirect: "manual", ...init }), { ...env, ASSETS, PUBLIC_ORIGIN: ORIGIN } as never);

const insert = (slug: string, state: string) =>
  env.DB.prepare(
    `INSERT INTO events (id, slug, name, start_date, end_date, city, country, language, publish_state, created_at, updated_at)
     VALUES (?1, ?2, ?2, '2026-11-10', '2026-11-22', 'X', 'DK', 'en', ?3, 0, 1763424000000)`,
  ).bind(`evt_${slug}`, slug, state);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  await caches.default.delete(new Request(`${ORIGIN}/sitemap.xml`));
});

describe("/sitemap.xml", () => {
  it("lists Home, privacy and only published events", async () => {
    const states = ["published", "draft", "in_review", "rejected", "unpublished_admin"];
    await env.DB.batch(states.map((s) => insert(`ev-${s.replaceAll("_", "-")}`, s)));
    const res = await call("/sitemap.xml", {}, "leyenda.ink");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://leyenda.ink/</loc>");
    expect(xml).toContain("<loc>https://leyenda.ink/privacy</loc>");
    expect(xml).toContain("<loc>https://leyenda.ink/e/ev-published</loc><lastmod>2025-11-18</lastmod>");
    for (const s of ["draft", "in-review", "rejected", "unpublished-admin"]) expect(xml).not.toContain(`/e/ev-${s}<`);
    expect(xml).not.toMatch(/\/(panel|api|media)/);
  });

  it("ignores Host-like headers, answers HEAD without a body and refuses other methods", async () => {
    const res = await call("/sitemap.xml", { headers: { "X-Forwarded-Host": "evil.test" } }, "preview-atlas.sargiotti67.workers.dev");
    expect(await res.text()).not.toContain("evil.test");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const head = await call("/sitemap.xml", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await call("/sitemap.xml", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("SPA routes and 404", () => {
  it("serves every allowlisted route as 200, panel headers intact, with canonical where it applies", async () => {
    for (const path of ["/", "/privacy", "/privacy/", "/panel", "/panel/events/x/edit", "/panel/invite/abc123"]) {
      const res = await call(`${path}?utm=1`);
      expect(res.status, path).toBe(200);
      const body = await res.text();
      if (path.startsWith("/panel")) {
        expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(body).not.toContain('rel="canonical"');
      } else {
        const href = path === "/" ? "https://leyenda.ink/" : "https://leyenda.ink/privacy";
        expect(body).toContain(`<link rel="canonical" href="${href}">`);
      }
    }
  });

  it("gives /privacy its own title, description and og:url", async () => {
    const body = await (await call("/privacy")).text();
    expect(body).toContain("<title>Privacy · leyenda.ink</title>");
    expect(body).toContain('<meta property="og:url" content="https://leyenda.ink/privacy"');
    expect(body).not.toContain("Mapas interactivos gratis");
  });

  it("gives /organizadores its own Spanish title and og:image", async () => {
    const body = await (await call("/organizadores")).text();
    expect(body).toContain("<title>Crea el mapa interactivo de tu evento · leyenda.ink</title>");
    expect(body).toContain('<meta property="og:image" content="https://leyenda.ink/organizers/og.jpg"');
    expect(body).toContain('<link rel="canonical" href="https://leyenda.ink/organizadores">');
    expect(body).not.toContain("Mapas interactivos gratis");
  });

  it("returns the noindex 404 shell for unknown paths and keeps unknown /api JSON", async () => {
    for (const path of ["/foo", "/privacy/x", "/index.html"]) {
      const res = await call(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toContain('<meta name="robots" content="noindex">');
    }
    const api = await call("/api/v1/nope");
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
  });

  it("sets a canonical on event pages from the validated slug", async () => {
    await env.DB.batch([insert("havnelobet", "published")]);
    const body = await (await call("/e/havnelobet?x=1")).text();
    expect(body).toContain('<link rel="canonical" href="https://leyenda.ink/e/havnelobet">');
  });
});
