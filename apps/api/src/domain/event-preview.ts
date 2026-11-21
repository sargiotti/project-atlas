/**
 * Link-preview text for an event (slice 04). Pure: no I/O, no framework. English only (crawlers send
 * no language). Copy rules: design deliverable 05, section 6.
 */

import { CLEAN_STRIP, toneOf } from "@atlas/contract";

export interface StoredEventPreview {
  /** Event id: domain only (tone, and the owner prefix of the stored og key). Never printed into the page. */
  id: string;
  slug: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  city: string;
  country: string; // ISO 3166-1 alpha-2
  /** `covers/{eventId}/{hex32}-og.jpg` as stored; re-validated before it becomes a URL. Null: no cover. */
  ogKey: string | null;
  /** Organizer-written description as stored (may hold links or junk). Null or empty: none. Slice 26 cleans it. */
  description: string | null;
  /** `owner_id IS NULL`: a seeded demo event (slice 37). Demo pages are noindex and carry no JSON-LD. */
  isDemo: boolean;
}

export interface EventPreview {
  title: string;
  description: string;
  /**
   * Path under the public origin: the cover's link-preview JPEG (`/media/covers/{eventId}/{hex32}-og.jpg`), or the static
   * image of the event's tone (`/tone-og/{0..7}.jpg`) when there is no cover or the stored key is not valid.
   */
  imagePath: string;
  imageAlt: string;
  /** Slice 26: what the crawlable page shows as text, all cleaned. `description` is null when there is nothing to show. */
  page: { heading: string; dates: string | null; place: string; description: string | null };
  isDemo: boolean;
  /** Plain city and ISO country for the JSON-LD Place (cleaned). */
  city: string;
  country: string;
  startDate: string;
  endDate: string;
}

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 200;
export const MAX_ALT = 200;
export const MAX_INDEXED_DESCRIPTION = 300;

/** Same shape the cover upload writes (slice 14): `covers/{eventId}/{hex32}-og.jpg`. */
export const OG_KEY_REGEX = /^covers\/[a-z0-9_-]{1,64}\/[0-9a-f]{32}-og\.jpg$/;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const EN_DASH = String.fromCharCode(0x2013);
const MIDDLE_DOT = String.fromCharCode(0xb7);

// Invisible and direction-changing characters never belong in a one-line preview: C0/C1 controls
// (whitespace is handled separately) and the shared INVISIBLE_RANGES set (zero-width, bidi, soft hyphen, fillers,
// tag characters, BOM...). Also < and >: the rewriter encodes " and & in attribute values but leaves < and > as they
// are, and no real event name needs them, so they are dropped rather than left for sloppy parsers to trip over.
const STRIP = CLEAN_STRIP;
// JS \s already covers U+2028 and U+2029.
const WHITESPACE = /\s+/g;

/** Strips invisible/bidi characters, collapses all whitespace to single spaces, trims, caps by code point. */
export function cleanText(input: string, max: number): string {
  const cleaned = input.replace(STRIP, "").replace(WHITESPACE, " ").trim();
  const points = Array.from(cleaned);
  if (points.length <= max) return cleaned;
  return points.slice(0, max - 1).join("").trimEnd() + String.fromCharCode(0x2026);
}

/** Removes URL-like tokens (`https?://...`, `www....`). The website field is where an event's link belongs (slice 26, S5). */
export function stripUrls(input: string): string {
  return input.replace(/https?:\/\/\S*/gi, " ").replace(/(^|[^a-z0-9])www\.\S*/gi, "$1 ");
}

/**
 * The description as Google may index it: plain text, no links, capped at 300 code points (slice 26, S5).
 * Cleaned once before the URL pass so invisible characters cannot split "https://" and sneak a link past it.
 */
export function indexedDescription(raw: string | null): string | null {
  if (!raw) return null;
  const text = cleanText(stripUrls(cleanText(raw, Infinity)), MAX_INDEXED_DESCRIPTION);
  return text === "" ? null : text;
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseYmd(iso: string): Ymd {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const m = match ? Number(match[2]) : 0;
  if (!match || m < 1 || m > 12) throw new Error("invalid event date");
  return { y: Number(match[1]), m, d: Number(match[3]) };
}

/** "4 Dec 2026", "10–22 Nov 2026", "28 Nov – 2 Dec 2026", "30 Dec 2026 – 2 Jan 2027". */
export function formatDateRange(startIso: string, endIso: string): string {
  const s = parseYmd(startIso);
  const e = parseYmd(endIso);
  const mon = (x: Ymd) => MONTHS[x.m - 1]!;
  if (s.y === e.y && s.m === e.m && s.d === e.d) return `${s.d} ${mon(s)} ${s.y}`;
  if (s.y === e.y && s.m === e.m) return `${s.d}${EN_DASH}${e.d} ${mon(s)} ${s.y}`;
  if (s.y === e.y) return `${s.d} ${mon(s)} ${EN_DASH} ${e.d} ${mon(e)} ${e.y}`;
  return `${s.d} ${mon(s)} ${s.y} ${EN_DASH} ${e.d} ${mon(e)} ${e.y}`;
}

let regionNames: Intl.DisplayNames | null | undefined;

/** English country name for an ISO code; falls back to the code itself. */
export function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    const name = regionNames?.of(code);
    // ICU answers "Unknown Region" for well-formed but unassigned codes: keep the code instead.
    return name && name !== code && !name.startsWith("Unknown") ? name : code;
  } catch {
    return code;
  }
}

export function buildEventPreview(event: StoredEventPreview): EventPreview {
  const title = cleanText(event.name, MAX_TITLE);
  const place = `${event.city}, ${countryName(event.country)}`;
  let when: string | null = null;
  try {
    when = formatDateRange(event.startDate, event.endDate);
  } catch {
    // Malformed stored dates: still give the event a preview, without the date part.
  }
  const description = cleanText(when ? `${when} ${MIDDLE_DOT} ${place}` : place, MAX_DESCRIPTION);
  // The key must be well formed AND belong to this very event; anything else falls back to the tone image.
  const hasImage = event.ogKey !== null && OG_KEY_REGEX.test(event.ogKey) && event.ogKey.startsWith(`covers/${event.id}/`);
  return {
    title,
    description,
    imagePath: hasImage ? `/media/${event.ogKey}` : `/tone-og/${toneOf(event.id)}.jpg`,
    imageAlt: cleanText(`Cover image for ${event.name}`, MAX_ALT),
    page: { heading: title, dates: when, place: cleanText(place, MAX_TITLE), description: indexedDescription(event.description) },
    isDemo: event.isDemo,
    city: cleanText(event.city, 100),
    country: event.country,
    startDate: event.startDate,
    endDate: event.endDate,
  };
}

/**
 * schema.org/Event for a non-demo page (slice 26, S4). Fixed allowlist of fields built from cleaned data; `url` is the
 * canonical and `image` the exact og:image value. No organizer data, no website. Dates are date-only (no time zone is
 * claimed). Returns plain data: the one serializer is `jsonLdScript` in the HTTP layer.
 */
export function buildEventJsonLd(p: EventPreview, url: string, imageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: p.page.heading,
    startDate: p.startDate,
    endDate: p.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: p.city,
      address: { "@type": "PostalAddress", addressLocality: p.city, addressCountry: p.country },
    },
    ...(p.page.description ? { description: p.page.description } : {}),
    image: imageUrl,
    url,
  };
}
