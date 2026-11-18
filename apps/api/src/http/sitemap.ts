/**
 * `GET|HEAD /sitemap.xml` (slice 25). Home, /privacy and every published event (demo events included).
 *
 * Every URL is PUBLIC_ORIGIN + a fixed path or `/e/<slug>`; Host and X-Forwarded-Host are never read. Visibility
 * comes from the shared publishedEvent() predicate, the same switch as the public event page, so drafts, events in
 * review, rejected, unpublished and deleted events are never listed. One indexed SELECT, capped, then cached at the
 * edge for an hour keyed on the canonical URL.
 */
import type { Context } from "hono";
import { SLUG_REGEX } from "@atlas/contract";
import { publishedEvent } from "../adapters/sql";
import { parsePublicOrigin } from "./event-page";
import { errorResponse } from "./errors";
import type { AppEnv } from "./types";

const MAX_URLS = 5000;
const CACHE_CONTROL = "public, max-age=3600";
const XML_TYPE = "application/xml; charset=utf-8";

const xmlEscape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const entry = (loc: string, lastmod?: number) =>
  `<url><loc>${xmlEscape(loc)}</loc>${lastmod !== undefined ? `<lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : ""}</url>`;

export async function handleSitemap(c: Context<AppEnv>): Promise<Response> {
  const origin = parsePublicOrigin(c.env.PUBLIC_ORIGIN);
  const cacheKey = new Request(`${origin}/sitemap.xml`);
  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const head = c.req.method === "HEAD";
  const respond = (body: string) =>
    new Response(head ? null : body, { status: 200, headers: { "Content-Type": XML_TYPE, "Cache-Control": CACHE_CONTROL } });

  try {
    const hit = await edge?.match(cacheKey);
    if (hit) return respond(await hit.text());
  } catch {
    // the cache is best effort
  }

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

  const { results } = await c.env.DB.prepare(
    `SELECT slug, updated_at FROM events WHERE ${publishedEvent()} ORDER BY start_date, slug LIMIT ${MAX_URLS}`,
  ).all<{ slug: string; updated_at: number }>();

  const urls = [entry(`${origin}/`), entry(`${origin}/privacy`)];
  for (const row of results) {
    if (!SLUG_REGEX.test(row.slug)) continue;
    urls.push(entry(`${origin}/e/${row.slug}`, Number.isFinite(row.updated_at) ? row.updated_at : undefined));
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`;

  try {
    await edge?.put(cacheKey, new Response(body, { headers: { "Content-Type": XML_TYPE, "Cache-Control": CACHE_CONTROL } }));
  } catch {
    // ignore
  }
  return respond(body);
}
