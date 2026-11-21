/**
 * `GET /e/*`: the SPA shell with per-event Open Graph / Twitter meta (slice 04, ADR 0009).
 *
 * The response depends only on the path (the slug) and public event data: never on request.cf, the
 * query, cookies, Accept-Language, User-Agent, Host or IP (B7). Text only ever reaches the HTML through
 * HTMLRewriter `setAttribute("content", ...)` on tags that already exist in the shell, and
 * `setInnerContent(text)` on `<title>` (escaped by the rewriter). No HTML is built from strings (B4).
 *
 * Slice 26 adds, for Google: readable event text inside `#root` (fixed tags as constants, every organizer value as
 * text), a schema.org/Event JSON-LD block (one sink: `jsonLdScript`), and `noindex` for demo events.
 */
import type { Context } from "hono";
import { slugSchema } from "@atlas/contract";
import { buildEventJsonLd, type EventPreview } from "../domain/event-preview";
import { getEventPreview } from "../application/get-event-preview";
import { D1EventPreviewRepository } from "../adapters/d1-event-preview-repository";
import { etagMatches, etagOf } from "./etag";
import { HTML_CSP } from "./security-headers";

export interface EventPageEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
}

const REVALIDATE = "public, max-age=0, must-revalidate";
/**
 * Slice 08b: every slug that is not public (never existed, invalid, draft, in review, rejected, unpublished, deleted)
 * gets this ONE response: same status, body and headers, so the page cannot tell a visitor which of them it is, and
 * nothing here depends on a session. Short shared cache (30 s) and `noindex`, in a header and a meta tag.
 */
const GONE_CACHE = "public, max-age=30";

/** Placeholder contract with apps/web/index.html. Every selector must match exactly once. */
const SEL = {
  root: "#root",
  title: "title",
  description: 'meta[name="description"]',
  ogUrl: 'meta[property="og:url"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  ogImage: 'meta[property="og:image"]',
  ogImageAlt: 'meta[property="og:image:alt"]',
  twTitle: 'meta[name="twitter:title"]',
  twDescription: 'meta[name="twitter:description"]',
  twImage: 'meta[name="twitter:image"]',
  twImageAlt: 'meta[name="twitter:image:alt"]',
} as const;

const BS = String.fromCharCode(0x5c);

/** The one place organizer data becomes script content: JSON with every HTML-significant character as a \uXXXX escape (S3). */
export function jsonLdScript(data: unknown): string {
  const json = JSON.stringify(data)
    .replaceAll("<", BS + "u003c")
    .replaceAll(">", BS + "u003e")
    .replaceAll("&", BS + "u0026")
    .replaceAll(String.fromCharCode(0x2028), BS + "u2028")
    .replaceAll(String.fromCharCode(0x2029), BS + "u2029");
  return `<script type="application/ld+json">${json}</script>`;
}

interface MetaValues {
  title: string;
  description: string;
  url: string;
  /** Null: the event has no generated image; the shell's brand card tags stay as they are. */
  image: { url: string; alt: string } | null;
  /** Slice 26: visible text for `#root`, and the head extras. `jsonLd` is null for demo events. */
  page: EventPreview["page"];
  isDemo: boolean;
  jsonLd: Record<string, unknown> | null;
}

/** Fixed `https://host[:port]` origin from configuration; anything else is a deployment error. */
export function parsePublicOrigin(raw: string | undefined): string {
  const u = new URL(raw ?? "");
  if (u.protocol !== "https:" || u.username || u.password || u.pathname !== "/" || u.search || u.hash) {
    throw new Error("PUBLIC_ORIGIN must be a bare https origin");
  }
  return u.origin;
}

export async function loadShell(assets: Fetcher): Promise<string> {
  // Fresh GET for "/": no client headers forwarded (no If-None-Match, Range, ...), so the answer is
  // always a full 200 body.
  const res = await assets.fetch(new Request("https://assets.invalid/", { method: "GET" }));
  const type = res.headers.get("content-type") ?? "";
  if (res.status !== 200 || !type.toLowerCase().includes("text/html")) {
    throw new Error(`shell fetch failed: status=${res.status}`);
  }
  return res.text();
}

/** Appends <link rel=canonical> to the head. href is always PUBLIC_ORIGIN + a fixed path or a validated slug. */
export function canonicalLink(href: string) {
  return {
    element(el: Element) {
      el.append(`<link rel="canonical" href="${href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;")}">`, { html: true });
    },
  };
}

async function rewriteShell(shell: string, meta: MetaValues): Promise<string> {
  const seen = new Map<string, number>();
  const attr = (selector: string, value: string) => ({
    element(el: Element) {
      seen.set(selector, (seen.get(selector) ?? 0) + 1);
      // The rewriter encodes " but leaves & and < > raw in attribute values (verified). < > were already
      // dropped by cleanText; & is encoded here so entities typed into a name cannot change the text.
      el.setAttribute("content", value.replaceAll("&", "&amp;"));
    },
  });
  const rw = new HTMLRewriter();
  rw.on("head", canonicalLink(meta.url));
  rw.on("head", {
    element(el: Element) {
      if (meta.isDemo) el.append('<meta name="robots" content="noindex">', { html: true });
      else if (meta.jsonLd) el.append(jsonLdScript(meta.jsonLd), { html: true });
    },
  });
  rw.on(SEL.root, {
    element(el: Element) {
      seen.set(SEL.root, (seen.get(SEL.root) ?? 0) + 1);
      // Fixed tags are constants; every organizer value goes in as text (escaped by the rewriter) (S2).
      el.append('<main class="ssr-event"><h1>', { html: true });
      el.append(meta.page.heading);
      el.append("</h1>", { html: true });
      for (const line of [meta.page.dates, meta.page.place, meta.page.description]) {
        if (line === null) continue;
        el.append("<p>", { html: true });
        el.append(line);
        el.append("</p>", { html: true });
      }
      el.append("</main>", { html: true });
    },
  });
  rw.on(SEL.title, {
      element(el) {
        seen.set(SEL.title, (seen.get(SEL.title) ?? 0) + 1);
        el.setInnerContent(meta.title); // text mode: escaped
      },
    });
  rw.on(SEL.description, attr(SEL.description, meta.description))
    .on(SEL.ogUrl, attr(SEL.ogUrl, meta.url))
    .on(SEL.ogTitle, attr(SEL.ogTitle, meta.title))
    .on(SEL.ogDescription, attr(SEL.ogDescription, meta.description))
    .on(SEL.twTitle, attr(SEL.twTitle, meta.title))
    .on(SEL.twDescription, attr(SEL.twDescription, meta.description));
  if (meta.image) {
    rw.on(SEL.ogImage, attr(SEL.ogImage, meta.image.url))
      .on(SEL.ogImageAlt, attr(SEL.ogImageAlt, meta.image.alt))
      .on(SEL.twImage, attr(SEL.twImage, meta.image.url))
      .on(SEL.twImageAlt, attr(SEL.twImageAlt, meta.image.alt));
  }
  const out = await rw.transform(new Response(shell)).text();

  const expected: string[] = [SEL.root, SEL.title, SEL.description, SEL.ogUrl, SEL.ogTitle, SEL.ogDescription, SEL.twTitle, SEL.twDescription];
  if (meta.image) expected.push(SEL.ogImage, SEL.ogImageAlt, SEL.twImage, SEL.twImageAlt);
  for (const selector of expected) {
    if (seen.get(selector) !== 1) throw new Error(`shell placeholder ${selector} matched ${seen.get(selector) ?? 0} times`);
  }
  return out;
}

export function htmlHeaders(cacheControl: string, etag?: string): Headers {
  const h = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": cacheControl,
    "Content-Security-Policy": HTML_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    Vary: "Accept-Encoding",
  });
  if (etag) h.set("ETag", etag);
  return h;
}

export const html = (body: string, status: number, cacheControl: string, etag?: string) =>
  new Response(body, { status, headers: htmlHeaders(cacheControl, etag) });

/** The shell with generic brand meta (no event title or description) and a robots noindex tag. */
export async function goneResponse(shell: string, cacheControl = GONE_CACHE): Promise<Response> {
  const body = await new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append('<meta name="robots" content="noindex">', { html: true });
      },
    })
    .transform(new Response(shell))
    .text();
  const res = html(body, 404, cacheControl);
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}

const UNAVAILABLE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>leyenda.ink</title></head><body><p>leyenda.ink is temporarily unavailable. Please try again in a moment.</p></body></html>';

export async function handleEventPage(c: Context<{ Bindings: EventPageEnv; Variables: { requestId: string } }>): Promise<Response> {
  const requestId = c.get("requestId");
  const logError = (err: unknown) => {
    const name = err instanceof Error ? err.name : "NonError";
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[html-error] requestId=${requestId} name=${name} message=${message}`);
  };

  let shell: string;
  try {
    shell = await loadShell(c.env.ASSETS);
  } catch (err) {
    logError(err);
    return html(UNAVAILABLE, 503, "no-store");
  }

  // B6: validate before any D1 access. Exactly one path segment; anything else is the same unavailable response.
  // One trailing slash is tolerated, like the client router does. "/e/" and "/e//" stay invalid.
  const segment = c.req.path.slice("/e/".length).replace(/(?<=.)\/$/, "");
  const slug = slugSchema.safeParse(segment);
  if (!slug.success) return goneResponse(shell);

  try {
    const origin = parsePublicOrigin(c.env.PUBLIC_ORIGIN);
    const preview = await getEventPreview(new D1EventPreviewRepository(c.env.DB), slug.data);
    if (!preview) return goneResponse(shell);

    const url = `${origin}/e/${slug.data}`;
    const imageUrl = `${origin}${preview.imagePath}`;
    const meta: MetaValues = {
      title: preview.title,
      description: preview.description,
      url,
      image: preview.imagePath ? { url: imageUrl, alt: preview.imageAlt } : null,
      page: preview.page,
      isDemo: preview.isDemo,
      jsonLd: preview.isDemo ? null : buildEventJsonLd(preview, url, imageUrl),
    };
    const body = await rewriteShell(shell, meta);
    // Weak ETag over the shell as served plus the injected values: changes with a deploy or an edit.
    const etag = await etagOf(`${shell}\u0000${JSON.stringify(meta)}`);
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      const notModified = new Response(null, { status: 304, headers: htmlHeaders(REVALIDATE, etag) });
      if (meta.isDemo) notModified.headers.set("X-Robots-Tag", "noindex");
      return notModified;
    }
    const res = html(body, 200, REVALIDATE, etag);
    if (meta.isDemo) res.headers.set("X-Robots-Tag", "noindex");
    return res;
  } catch (err) {
    // R4: fail open with the unmodified shell (brand meta), never cached.
    logError(err);
    return html(shell, 200, "no-store");
  }
}
