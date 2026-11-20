/**
 * Slice 25: navigations that reach the Worker. Only an explicit allowlist of SPA routes is served as the app (200);
 * every other path gets the noindex 404 shell, so crawlers stop seeing the SPA fallback as a real page.
 *
 * Allowlist (keep in sync with apps/web/src/App.tsx): `/`, `/privacy` and `/terms` (each also with a trailing slash), `/panel`, `/panel/*`
 * (includes /panel/invite/*), `/organizadores` (slice 30, with or without a trailing slash) and `/e/*` (handled by event-page.ts). Canonical and per-page meta come from
 * PUBLIC_ORIGIN plus a fixed path, never from the request URL.
 */
import type { Context } from "hono";
import { canonicalLink, goneResponse, html, loadShell, parsePublicOrigin } from "./event-page";
import type { AppEnv } from "./types";

export type SpaRoute = "home" | "privacy" | "terms" | "organizers" | "panel" | "unknown";

export function classifyPath(path: string): SpaRoute {
  if (path === "/") return "home";
  if (path === "/privacy" || path === "/privacy/") return "privacy";
  if (path === "/terms" || path === "/terms/") return "terms";
  if (path === "/organizadores" || path === "/organizadores/") return "organizers";
  if (path === "/panel" || path.startsWith("/panel/")) return "panel";
  return "unknown";
}

const PRIVACY_TITLE = "Privacy · leyenda.ink";
const PRIVACY_DESCRIPTION = "How leyenda.ink handles your data: what we collect, why, and your rights.";

const TERMS_TITLE = "Terms of use · leyenda.ink";
const TERMS_DESCRIPTION = "The terms that apply to using leyenda.ink and to publishing events on it.";

const ORGANIZERS_TITLE = "Crea el mapa interactivo de tu evento · leyenda.ink";
const ORGANIZERS_DESCRIPTION =
  "Mapa interactivo para fiestas, ferias, festivales y carreras. Sin descargar ninguna app: escanean el QR y se abre en el navegador. Gratis hoy.";
const ORGANIZERS_IMAGE_ALT = "Ilustración generada con IA de una plaza en fiesta y un celular con el mapa del evento";

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
    const rw = new HTMLRewriter().on("head", canonicalLink(`${origin}${route === "home" ? "/" : route === "organizers" ? "/organizadores" : route === "terms" ? "/terms" : "/privacy"}`));
    const meta =
      route === "privacy"
        ? { title: PRIVACY_TITLE, description: PRIVACY_DESCRIPTION, path: "/privacy" }
        : route === "terms"
          ? { title: TERMS_TITLE, description: TERMS_DESCRIPTION, path: "/terms" }
          : route === "organizers"
          ? { title: ORGANIZERS_TITLE, description: ORGANIZERS_DESCRIPTION, path: "/organizadores", image: `${origin}/organizers/og.jpg`, imageAlt: ORGANIZERS_IMAGE_ALT }
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
      if (meta.image) {
        rw.on('meta[property="og:image"]', setContent(meta.image))
          .on('meta[property="og:image:type"]', setContent("image/jpeg"))
          .on('meta[property="og:image:width"]', setContent("1200"))
          .on('meta[property="og:image:height"]', setContent("630"))
          .on('meta[property="og:image:alt"]', setContent(meta.imageAlt))
          .on('meta[name="twitter:image"]', setContent(meta.image))
          .on('meta[name="twitter:image:alt"]', setContent(meta.imageAlt));
      }
    }
    return rw.transform(res);
  } catch (err) {
    console.error(`[html-error] requestId=${c.get("requestId")} name=${err instanceof Error ? err.name : "NonError"}`);
    return res;
  }
}
