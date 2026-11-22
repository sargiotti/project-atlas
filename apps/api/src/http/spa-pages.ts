/**
 * Slice 25: navigations that reach the Worker. Only an explicit allowlist of SPA routes is served as the app (200);
 * every other path gets the noindex 404 shell, so crawlers stop seeing the SPA fallback as a real page.
 *
 * Allowlist (keep in sync with apps/web/src/App.tsx): `/`, `/privacy` and `/terms` (each also with a trailing slash), `/panel`, `/panel/*`
 * (includes /panel/invite/*), the four organizer language URLs (slice 30, 42: route table in @atlas/contract, with or without a
 * trailing slash) and `/e/*` (handled by event-page.ts). Canonical and per-page meta come from PUBLIC_ORIGIN plus a fixed path,
 * never from the request URL.
 */
import { organizerRouteForPath } from "@atlas/contract";
import type { Context } from "hono";
import { canonicalLink, goneResponse, html, loadShell, parsePublicOrigin } from "./event-page";
import { buildOrganizerPage, organizerHeadExtras } from "./organizer-page";
import type { AppEnv } from "./types";

export type SpaRoute = "home" | "privacy" | "terms" | "organizers" | "panel" | "unknown";

export function classifyPath(path: string): SpaRoute {
  if (path === "/") return "home";
  if (path === "/privacy" || path === "/privacy/") return "privacy";
  if (path === "/terms" || path === "/terms/") return "terms";
  if (organizerRouteForPath(path)) return "organizers";
  if (path === "/panel" || path.startsWith("/panel/")) return "panel";
  return "unknown";
}

const PRIVACY_TITLE = "Privacy · leyenda.ink";
const PRIVACY_DESCRIPTION = "How leyenda.ink handles your data: what we collect, why, and your rights.";

const TERMS_TITLE = "Terms of use · leyenda.ink";
const TERMS_DESCRIPTION = "The terms that apply to using leyenda.ink and to publishing events on it.";

// The rewriter encodes " but leaves & raw in attribute values, so & is encoded here (as rewriteShell does in event-page.ts).
const setContent = (value: string) => ({
  element(el: Element) {
    el.setAttribute("content", value.replaceAll("&", "&amp;"));
  },
});

const REVALIDATE = "public, max-age=0, must-revalidate";

/** Slice 42: the four organizer language URLs. Everything comes from the route table, the shared catalog and PUBLIC_ORIGIN. */
async function serveOrganizerPage(c: Context<AppEnv>): Promise<Response> {
  const route = organizerRouteForPath(c.req.path);
  // S9: the rewritten body must never be answered from a validator of the raw shell, so conditional headers are dropped.
  const req = new Request(c.req.raw);
  req.headers.delete("if-none-match");
  req.headers.delete("if-modified-since");
  const asset = await c.env.ASSETS.fetch(req);
  if (!route || asset.status !== 200 || !(asset.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) return asset;
  // Copy before touching headers (the platform response may be immutable).
  const res = new Response(asset.body, asset);
  res.headers.delete("etag");
  res.headers.delete("last-modified");
  res.headers.set("Cache-Control", REVALIDATE);
  if (!route.indexable) res.headers.set("X-Robots-Tag", "noindex");
  try {
    const page = buildOrganizerPage(route, parsePublicOrigin(c.env.PUBLIC_ORIGIN));
    const rw = new HTMLRewriter()
      .on("html", {
        element(el) {
          el.setAttribute("lang", page.lang);
        },
      })
      .on("head", canonicalLink(page.canonical))
      .on("head", {
        element(el) {
          el.append(organizerHeadExtras(page), { html: true });
        },
      })
      .on("#root", {
        element(el) {
          for (const part of page.body) {
            if ("html" in part) el.append(part.html, { html: true });
            else el.append(part.text);
          }
        },
      })
      .on("title", {
        element(el) {
          el.setInnerContent(page.title);
        },
      })
      .on('meta[name="description"]', setContent(page.description))
      .on('meta[property="og:url"]', setContent(page.canonical))
      .on('meta[property="og:title"]', setContent(page.title))
      .on('meta[property="og:description"]', setContent(page.description))
      .on('meta[name="twitter:title"]', setContent(page.title))
      .on('meta[name="twitter:description"]', setContent(page.description))
      .on('meta[property="og:image"]', setContent(page.imageUrl))
      .on('meta[property="og:image:type"]', setContent("image/jpeg"))
      .on('meta[property="og:image:width"]', setContent("1200"))
      .on('meta[property="og:image:height"]', setContent("630"))
      .on('meta[property="og:image:alt"]', setContent(page.imageAlt))
      .on('meta[name="twitter:image"]', setContent(page.imageUrl))
      .on('meta[name="twitter:image:alt"]', setContent(page.imageAlt));
    return rw.transform(res);
  } catch (err) {
    console.error(`[html-error] requestId=${c.get("requestId")} name=${err instanceof Error ? err.name : "NonError"}`);
    return res;
  }
}

const UNAVAILABLE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>leyenda.ink</title></head><body><p>leyenda.ink is temporarily unavailable. Please try again in a moment.</p></body></html>';

export async function serveSpaRoute(c: Context<AppEnv>, route: SpaRoute): Promise<Response> {
  if (route === "unknown") {
    try {
      return await goneResponse(await loadShell(c.env.ASSETS), "no-store");
    } catch {
      return html(UNAVAILABLE, 503, "no-store");
    }
  }

  // Static assets apply apps/web/public/_headers (CSP, panel no-store and noindex), so those headers stay untouched.
  c.set("passthroughAsset", true);
  if (route === "organizers") return serveOrganizerPage(c);
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const isHtml = (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
  if (route === "panel" || res.status !== 200 || !isHtml) return res;
  try {
    const origin = parsePublicOrigin(c.env.PUBLIC_ORIGIN);
    const rw = new HTMLRewriter().on("head", canonicalLink(`${origin}${route === "home" ? "/" : route === "terms" ? "/terms" : "/privacy"}`));
    const meta =
      route === "privacy"
        ? { title: PRIVACY_TITLE, description: PRIVACY_DESCRIPTION, path: "/privacy" }
        : route === "terms"
          ? { title: TERMS_TITLE, description: TERMS_DESCRIPTION, path: "/terms" }
          : null;
    if (meta) {
      rw.on("title", {
        element(el) {
          el.setInnerContent(meta.title);
        },
      })
        .on('meta[name="description"]', setContent(meta.description))
        .on('meta[property="og:url"]', setContent(`${origin}${meta.path}`))
        .on('meta[property="og:title"]', setContent(meta.title))
        .on('meta[property="og:description"]', setContent(meta.description))
        .on('meta[name="twitter:title"]', setContent(meta.title))
        .on('meta[name="twitter:description"]', setContent(meta.description));
    }
    return rw.transform(res);
  } catch (err) {
    console.error(`[html-error] requestId=${c.get("requestId")} name=${err instanceof Error ? err.name : "NonError"}`);
    return res;
  }
}
