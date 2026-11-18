/**
 * Slice 25: navigations that reach the Worker. Only an explicit allowlist of SPA routes is served as the app (200);
 * every other path gets the noindex 404 shell, so crawlers stop seeing the SPA fallback as a real page.
 *
 * Allowlist (keep in sync with apps/web/src/App.tsx): `/`, `/privacy` (and `/privacy/`), `/panel`, `/panel/*`
 * (includes /panel/invite/*) and `/e/*` (handled by event-page.ts). Canonical and per-page meta come from
 * PUBLIC_ORIGIN plus a fixed path, never from the request URL.
 */
import type { Context } from "hono";
import { canonicalLink, goneResponse, html, loadShell, parsePublicOrigin } from "./event-page";
import type { AppEnv } from "./types";

export type SpaRoute = "home" | "privacy" | "panel" | "unknown";

export function classifyPath(path: string): SpaRoute {
  if (path === "/") return "home";
  if (path === "/privacy" || path === "/privacy/") return "privacy";
  if (path === "/panel" || path.startsWith("/panel/")) return "panel";
  return "unknown";
}

const PRIVACY_TITLE = "Privacy · leyenda.ink";
const PRIVACY_DESCRIPTION = "How leyenda.ink handles your data: what we collect, why, and your rights.";

const setContent = (value: string) => ({
  element(el: Element) {
    el.setAttribute("content", value);
  },
});

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
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const isHtml = (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
  if (route === "panel" || res.status !== 200 || !isHtml) return res;
  try {
    const origin = parsePublicOrigin(c.env.PUBLIC_ORIGIN);
    const rw = new HTMLRewriter().on("head", canonicalLink(`${origin}${route === "home" ? "/" : "/privacy"}`));
    if (route === "privacy") {
      rw.on("title", {
        element(el) {
          el.setInnerContent(PRIVACY_TITLE);
        },
      })
        .on('meta[name="description"]', setContent(PRIVACY_DESCRIPTION))
        .on('meta[property="og:url"]', setContent(`${origin}/privacy`))
        .on('meta[property="og:title"]', setContent(PRIVACY_TITLE))
        .on('meta[property="og:description"]', setContent(PRIVACY_DESCRIPTION))
        .on('meta[name="twitter:title"]', setContent(PRIVACY_TITLE))
        .on('meta[name="twitter:description"]', setContent(PRIVACY_DESCRIPTION));
    }
    return rw.transform(res);
  } catch (err) {
    console.error(`[html-error] requestId=${c.get("requestId")} name=${err instanceof Error ? err.name : "NonError"}`);
    return res;
  }
}
