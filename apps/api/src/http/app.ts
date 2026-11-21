import { Hono } from "hono";
import { slugSchema, geoLangSchema } from "@atlas/contract";
import { getMapBundle } from "../application/get-map-bundle";
import { listEvents } from "../application/list-events";
import { applyGeoOverride, geoLang } from "../domain/geo-lang";
import { applyNearOverride, parseVisitorLocation } from "../domain/nearby";
import { D1EventMapRepository } from "../adapters/d1-event-map-repository";
import { D1EventListRepository } from "../adapters/d1-event-list-repository";
import { etagMatches, etagOf } from "./etag";
import { handleEventPage } from "./event-page";
import { handleSitemap } from "./sitemap";
import { classifyPath, serveSpaRoute } from "./spa-pages";
import { API_CSP, HTML_CSP, MEDIA_CSP } from "./security-headers";
import { errorResponse } from "./errors";
import { decideHost, REDIRECT_STATUS } from "./canonical-host";
import { registerAuthRoutes } from "./auth-routes";
import { registerPanelRoutes } from "./panel-routes";
import { registerAdminEventRoutes } from "./admin-event-routes";
import { registerOrganizerRoutes } from "./organizer-routes";
import { registerMediaRoutes } from "./map-routes";
import { registerCoverMediaRoutes } from "./cover-routes";
import { registerHealthRoutes } from "./health-routes";
import type { AppContext, AppEnv } from "./types";

export type { Env } from "./types";

const PREVIEW_HOST_SUFFIX = "-atlas.sargiotti67.workers.dev";
const COVER_OG_PATH = /^\/media\/covers\/[a-z0-9_-]{1,64}\/[0-9a-f]{32}-og\.jpg$/;

/** 200 JSON with weak ETag and the given Cache-Control, or 304 when If-None-Match matches. */
async function cachedJson(c: AppContext, body: string, cacheControl = "public, max-age=300"): Promise<Response> {
  const etag = await etagOf(body);
  const headers = { "Cache-Control": cacheControl, ETag: etag };
  if (etagMatches(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  // Request id + security headers on every response, including errors and 304s.
  // No CORS middleware: the API is same-origin only.
  app.use("*", async (c, next) => {
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    await next();
    // Slice 25: preview hosts are never indexed.
    if (new URL(c.req.url).hostname.endsWith(PREVIEW_HOST_SUFFIX)) {
      c.res = new Response(c.res.body, c.res);
      if (!c.res.headers.has("X-Robots-Tag")) c.res.headers.set("X-Robots-Tag", "noindex");
    }
    // Navigations served from static assets (slice 24) keep the headers from apps/web/public/_headers untouched.
    if (c.get("passthroughAsset")) return;
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    const path = c.req.path;
    c.res.headers.set("Content-Security-Policy", path.startsWith("/e/") ? HTML_CSP : path.startsWith("/media/") ? MEDIA_CSP : API_CSP);
    // Link-preview crawlers embed the og image from another origin, so only `-og.jpg` of covers is cross-origin (public once
    // published; the only cost is hotlinking). Everything else under /media stays same-site.
    if (path.startsWith("/media/")) c.res.headers.set("Cross-Origin-Resource-Policy", COVER_OG_PATH.test(path) ? "cross-origin" : "same-site");
  });

  // Slice 24: non-canonical hosts (www, old workers.dev) redirect GET/HEAD to https://leyenda.ink (Location only, no body)
  // and refuse everything else with 403, never 307/308. Runs right after the headers middleware, before the rate limiter, so no handler (or D1) is touched.
  app.use("*", async (c, next) => {
    const decision = decideHost(c.req.url, c.req.method);
    if (decision.action === "serve") return next();
    if (decision.action === "reject") return errorResponse(c, 403, "invalid_origin", "no-store");
    return new Response(null, { status: REDIRECT_STATUS, headers: { Location: decision.location, "Cache-Control": "no-store" } });
  });

  // Per-IP rate limit (60 req / 60 s, configured in wrangler.toml). Fails open if the
  // binding is absent or errors, so a limiter outage never takes the API down.
  app.use("/api/*", async (c, next) => {
    const limiter = c.env.RATE_LIMITER;
    if (limiter) {
      let allowed = true;
      try {
        allowed = (await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" })).success;
      } catch {
        allowed = true;
      }
      if (!allowed) return errorResponse(c, 429, "rate_limited", "no-store", { "Retry-After": "60" });
    }
    await next();
  });

  registerAuthRoutes(app);
  registerAdminEventRoutes(app);
  registerOrganizerRoutes(app);
  registerPanelRoutes(app);
  registerMediaRoutes(app);
  registerCoverMediaRoutes(app);
  registerHealthRoutes(app);

  app.get("/api/v1/events/:slug/map-bundle", async (c) => {
    const parsed = slugSchema.safeParse(c.req.param("slug"));
    if (!parsed.success) return errorResponse(c, 400, "invalid_slug", "no-store");

    const bundle = await getMapBundle(new D1EventMapRepository(c.env.DB), parsed.data);
    if (!bundle) return errorResponse(c, 404, "event_not_found", "public, max-age=30");

    return cachedJson(c, JSON.stringify(bundle));
  });

  // Public and read-only. The body depends on the visitor's coarse location (a `nearby` flag per event),
  // read from request.cf (or the `?near=` override) and used only to compute that flag: never stored,
  // logged, returned or used as a cache key. Because it varies per visitor it is `private` (browser
  // cache only), never `public`. Any `near` param, valid or not, switches to `no-store`, no ETag and
  // no conditional requests, so the override is never cached or reflected.
  app.get("/api/v1/events", async (c) => {
    const url = new URL(c.req.url);
    const hasNear = url.searchParams.has("near");
    const visitor = applyNearOverride(
      parseVisitorLocation((c.req.raw as { cf?: unknown }).cf),
      hasNear ? url.searchParams.get("near") : null,
    );
    const body = JSON.stringify(await listEvents(new D1EventListRepository(c.env.DB), visitor));
    if (hasNear) {
      return new Response(body, {
        status: 200,
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return cachedJson(c, body, "private, max-age=300");
  });

  // Default-language hint (slice 21b). Public, read-only, no DB. `request.cf` country + regionCode are read once
  // by geoLang and dropped: never stored, logged or used as a cache key. The answer varies per visitor, so it is
  // `private` (browser cache only), never `public`, and never goes through the Cache API. Any `geo` param, valid
  // or not, switches to `no-store` (the override is never cached or echoed). No ETag: the body is tiny.
  app.get("/api/v1/geo-lang", (c) => {
    const geo = new URL(c.req.url).searchParams.get("geo");
    const lang = applyGeoOverride(geoLang((c.req.raw as { cf?: unknown }).cf), geo);
    return new Response(JSON.stringify(geoLangSchema.parse({ lang })), {
      status: 200,
      headers: {
        "Cache-Control": geo !== null ? "no-store" : "private, max-age=600",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  });

  // Link previews: the SPA shell with per-event meta. No rate limit here (R5): crawler bursts share IPs
  // and a Worker-side limiter would not save invocations; D1 is protected by slug validation and the
  // isolate cache. HEAD is answered by Hono from this GET handler (same headers, no body).
  app.get("/e/*", handleEventPage);

  // Slice 25: sitemap. GET and HEAD only.
  app.on(["GET", "HEAD"], "/sitemap.xml", handleSitemap);
  app.all("/sitemap.xml", () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } }));

  // Slice 24: navigations (Home, /panel, SPA routes) reach the Worker so the host check above can redirect them.
  // Anything that is not an API path goes to the static assets unchanged, which apply `_headers` and the SPA fallback.
  app.notFound((c) => {
    const p = c.req.path;
    const isGetLike = c.req.method === "GET" || c.req.method === "HEAD";
    if (isGetLike && p !== "/api" && !p.startsWith("/api/") && !p.startsWith("/media/")) {
      // Slice 25: explicit allowlist of SPA routes; everything else is the noindex 404 shell.
      return serveSpaRoute(c, classifyPath(p));
    }
    return errorResponse(c, 404, "not_found", "no-store");
  });

  // Generic handler: never leak internals (stack traces, SQL, D1 messages) to the client.
  // Workers invocation logs are off, so log one privacy-safe line: error name, message and request
  // id only. Never the IP, headers, request.cf, URL (query string) or body. The stack is omitted too.
  app.onError((err, c) => {
    const name = err instanceof Error ? err.name : "NonError";
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api-error] requestId=${c.get("requestId")} name=${name} message=${message}`);
    return errorResponse(c, 500, "internal_error", "no-store");
  });

  return app;
}
