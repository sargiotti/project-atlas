import { Hono, type Context } from "hono";
import { slugSchema, type ErrorCode } from "@atlas/contract";
import { getMapBundle } from "../application/get-map-bundle";
import { listEvents } from "../application/list-events";
import { D1EventMapRepository } from "../adapters/d1-event-map-repository";
import { D1EventListRepository } from "../adapters/d1-event-list-repository";

export interface Env {
  DB: D1Database;
  /** Optional: remove the [[ratelimits]] block in wrangler.toml to switch limiting off. */
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

type AppEnv = { Bindings: Env; Variables: { requestId: string } };
type AppContext = Context<AppEnv>;

const API_CSP =
  "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";

const MESSAGES: Record<ErrorCode, string> = {
  invalid_slug: "Invalid event slug.",
  event_not_found: "Event not found.",
  not_found: "Not found.",
  rate_limited: "Too many requests. Try again later.",
  internal_error: "Internal error.",
};

function errorResponse(
  c: AppContext,
  status: 400 | 404 | 429 | 500,
  code: ErrorCode,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return c.json({ error: { code, message: MESSAGES[code], requestId: c.get("requestId") } }, status, {
    "Cache-Control": cacheControl,
    ...extraHeaders,
  });
}

async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `W/"${hex.slice(0, 16)}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const strip = (v: string) => v.trim().replace(/^W\//, "");
  return header.split(",").some((candidate) => candidate.trim() === "*" || strip(candidate) === strip(etag));
}

/** 200 JSON with weak ETag and `public, max-age=300`, or 304 when If-None-Match matches. */
async function cachedJson(c: AppContext, body: string): Promise<Response> {
  const etag = await etagOf(body);
  const headers = { "Cache-Control": "public, max-age=300", ETag: etag };
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
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("Content-Security-Policy", API_CSP);
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

  app.get("/api/v1/events/:slug/map-bundle", async (c) => {
    const parsed = slugSchema.safeParse(c.req.param("slug"));
    if (!parsed.success) return errorResponse(c, 400, "invalid_slug", "no-store");

    const bundle = await getMapBundle(new D1EventMapRepository(c.env.DB), parsed.data);
    if (!bundle) return errorResponse(c, 404, "event_not_found", "public, max-age=30");

    return cachedJson(c, JSON.stringify(bundle));
  });

  // Public, read-only, location-free: a pure function of the database. It deliberately ignores
  // every header (except If-None-Match), cookie, IP, request.cf and query parameter, so the response
  // is identical for every visitor and safe to cache anywhere. Date-state ordering is done client-side.
  app.get("/api/v1/events", async (c) => {
    const events = await listEvents(new D1EventListRepository(c.env.DB));
    return cachedJson(c, JSON.stringify(events));
  });

  app.notFound((c) => errorResponse(c, 404, "not_found", "no-store"));

  // Generic handler: never leak internals (stack traces, SQL, D1 messages).
  app.onError((_err, c) => errorResponse(c, 500, "internal_error", "no-store"));

  return app;
}
