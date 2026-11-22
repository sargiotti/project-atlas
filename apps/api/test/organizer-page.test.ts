import { env } from "cloudflare:workers";
import app from "../src/index";
import { describe, expect, it } from "vitest";
import { ORGANIZER_PAGE_STRINGS, ORGANIZER_ROUTES, organizerRouteForPath } from "@atlas/contract";
import shellSource from "../../web/index.html?raw";
import { classifyPath } from "../src/http/spa-pages";
import { jsonLdScript } from "../src/http/event-page";

const ORIGIN = "https://leyenda.ink";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", ORIGIN).replaceAll("__BRAND_CARD_URL__", `${ORIGIN}/og/brand-card.0badcafe.jpg`);
const seen: Headers[] = [];
// The platform answers the SPA fallback with a validator; the Worker must never pass it on for the rewritten page.
const ASSETS = {
  fetch: async (req: Request) => {
    seen.push(req.headers);
    return new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"raw-shell"', "Cache-Control": "public, max-age=0, must-revalidate" } });
  },
};
const call = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`https://leyenda.ink${path}`, { redirect: "manual", ...init }), { ...env, ASSETS, PUBLIC_ORIGIN: ORIGIN } as never);

const INDEXABLE = ORGANIZER_ROUTES.filter((r) => r.indexable);
const ldBlocks = (body: string) => [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

describe("organizer language URLs: indexable pages", () => {
  for (const route of INDEXABLE) {
    for (const suffix of ["", "/"]) {
      it(`${route.path}${suffix} serves its own language, canonical, hreflang and FAQ text`, async () => {
        const res = await call(`${route.path}${suffix}?utm=1`);
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
        expect(res.headers.get("etag")).toBeNull();
        expect(res.headers.get("x-robots-tag")).toBeNull();
        expect(res.headers.get("vary")).toBeNull();
        const body = await res.text();
        const s = ORGANIZER_PAGE_STRINGS[route.lang];
        const canonical = `${ORIGIN}${route.path}`;
        expect(body).toContain(`<html lang="${route.lang}"`);
        expect(body).toContain(`<title>${s.orgDocTitle}</title>`);
        expect(body).toContain(`<link rel="canonical" href="${canonical}">`);
        expect(body).toContain(`<meta property="og:url" content="${canonical}"`);
        expect(body).toContain(`content="${ORIGIN}/organizers/og.jpg"`);
        expect(body).toContain(`<meta property="og:image:alt" content="${s.orgImageAlt}"`);
        expect(body).not.toContain('name="robots"');
        for (const r of INDEXABLE) expect(body).toContain(`<link rel="alternate" hreflang="${r.lang}" href="${ORIGIN}${r.path}">`);
        expect(body).toContain(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/en/organizers">`);
        expect(body).not.toContain("/da/arrangorer");
        expect(body).toContain(`<h1>${s.orgH1}</h1>`);
        for (const n of [1, 2, 3, 4, 5]) {
          expect(body).toContain(s[`orgFaq${n}Q` as "orgFaq1Q"]);
          expect(body).toContain(s[`orgFaq${n}A` as "orgFaq1A"]);
        }
        expect(body).toContain(s.orgFree);
        expect(body).toContain('href="#pedi-tu-mapa"');
        const blocks = ldBlocks(body);
        expect(blocks).toHaveLength(1);
        const ld = JSON.parse(blocks[0]!);
        expect(ld["@type"]).toBe("FAQPage");
        expect(ld.mainEntity).toHaveLength(5);
        expect(ld.mainEntity[0].name).toBe(s.orgFaq1Q);
        expect(ld.mainEntity[0].acceptedAnswer.text).toBe(s.orgFaq1A);
      });
    }
  }

  it("strips conditional request headers before the asset fetch", async () => {
    seen.length = 0;
    const res = await call("/en/organizers", { headers: { "If-None-Match": '"raw-shell"', "If-Modified-Since": "Sat, 01 Jan 2000 00:00:00 GMT" } });
    expect(res.status).toBe(200);
    expect(seen.at(-1)?.get("if-none-match")).toBeNull();
    expect(seen.at(-1)?.get("if-modified-since")).toBeNull();
  });
});

describe("organizer language URLs: Danish stays out of Google", () => {
  it("has exactly one noindex meta and the header, no hreflang, no JSON-LD, Danish copy", async () => {
    const res = await call("/da/arrangorer");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("etag")).toBeNull();
    const body = await res.text();
    expect(body.match(/<meta name="robots" content="noindex">/g)).toHaveLength(1);
    expect(body).not.toContain("hreflang");
    expect(body).not.toContain("ld+json");
    expect(body).toContain('<html lang="da"');
    expect(body).toContain(`<h1>${ORGANIZER_PAGE_STRINGS.da.orgH1}</h1>`);
    expect(body).toContain(`<link rel="canonical" href="${ORIGIN}/da/arrangorer">`);
  });
});

describe("organizer language URLs: exact allowlist (S6)", () => {
  it("only the four paths (and their trailing-slash form) are organizer pages", () => {
    for (const r of ORGANIZER_ROUTES) {
      expect(classifyPath(r.path)).toBe("organizers");
      expect(classifyPath(`${r.path}/`)).toBe("organizers");
      expect(organizerRouteForPath(r.path)?.lang).toBe(r.lang);
    }
    for (const p of ["/EN/organizers", "/xx/organizers", "/en/organizers/x", "/en/organitzadors", "/da/arrangører", "/es/organizadores", "/en/organizers//", "/organizadores/x", "/ca/organizers"]) {
      expect(classifyPath(p), p).toBe("unknown");
    }
  });

  it("answers the rest with the noindex 404 shell, never a redirect", async () => {
    for (const p of ["/EN/organizers", "/xx/organizers", "/en/organizers/x", "/en/organitzadors", "/da/arrang%C3%B8rer", "/es/organizadores"]) {
      const res = await call(p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get("x-robots-tag"), p).toBe("noindex");
      expect(res.headers.get("cache-control"), p).toBe("no-store");
      expect(res.headers.get("location"), p).toBeNull();
    }
  });
});

describe("FAQPage JSON-LD escaping (S3)", () => {
  it("keeps a hostile answer inside a valid JSON string with no raw < or >", () => {
    const evil = "</script><script>alert(1)</script> & more";
    const script = jsonLdScript({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "q?", acceptedAnswer: { "@type": "Answer", text: evil } }],
    });
    const inner = script.slice('<script type="application/ld+json">'.length, -"</script>".length);
    expect(inner).not.toContain("<");
    expect(inner).not.toContain(">");
    expect(JSON.parse(inner).mainEntity[0].acceptedAnswer.text).toBe(evil);
  });
});
