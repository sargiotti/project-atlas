import { pointIdSchema, slugSchema, type Session } from "@atlas/contract";

/**
 * Add to calendar (slice 09). Session text is untrusted: it only ever goes into text properties
 * (escaped for .ics, URLSearchParams for Google). Nothing here reads the `?at=` simulation.
 */

export interface CalendarInput {
  session: Pick<Session, "id" | "title" | "start" | "end" | "description">;
  placeName: string;
  eventName: string;
  slug: string;
  /** Bare https origin, fixed at build time. */
  origin: string;
  /** Epoch ms for DTSTAMP. */
  nowMs?: number;
}

/** RFC 5545 TEXT escaping, in this order: backslash, semicolon, comma, newline. CR is dropped first. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds one content line at 75 octets (UTF-8 bytes), never inside a multibyte character. Continuations start with a space. */
export function foldIcsLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = " ";
      bytes = 1; // the leading space counts
      limit = 75;
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out;
}

/** `2026-07-10T21:30:00Z` to `20260710T213000Z`. */
function compactInstant(iso: string): string {
  return iso.replace(/[-:]/g, "");
}

function toInstant(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
}

/** Link back to the event page: fixed origin + a slug that passed `slugSchema`; null when the slug is not valid. */
export function eventLink(origin: string, slug: string): string | null {
  return slugSchema.safeParse(slug).success ? `${origin}/e/${slug}` : null;
}

export function calendarTitle(title: string, placeName: string) {
  return `${title} — ${placeName}`;
}

export function calendarLocation(placeName: string, eventName: string) {
  return `${placeName}, ${eventName}`;
}

function calendarDescription(description: string | undefined, link: string | null) {
  return [description, link].filter(Boolean).join("\n\n");
}

/** Fixed-template VCALENDAR with one VEVENT. Lines are CRLF-joined, with a trailing CRLF. */
export function buildIcs(input: CalendarInput): string {
  const { session, placeName, eventName, slug, origin } = input;
  const host = new URL(origin).host;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlas//Event schedule//EN",
    "BEGIN:VEVENT",
    `UID:${session.id}@${host}`,
    `DTSTAMP:${toInstant(input.nowMs ?? Date.now())}`,
    `DTSTART:${compactInstant(session.start)}`,
    `DTEND:${compactInstant(session.end)}`,
    `SUMMARY:${escapeIcsText(calendarTitle(session.title, placeName))}`,
    `LOCATION:${escapeIcsText(calendarLocation(placeName, eventName))}`,
    `DESCRIPTION:${escapeIcsText(calendarDescription(session.description, eventLink(origin, slug)))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.flatMap(foldIcsLine).join("\r\n") + "\r\n";
}

/** Safe file name from the event slug and session id (never the title). */
export function icsFileName(slug: string, sessionId: string): string {
  return slugSchema.safeParse(slug).success && pointIdSchema.safeParse(sessionId).success
    ? `atlas-${slug}-${sessionId}.ics`
    : "atlas-session.ics";
}

const GOOGLE_BASE = "https://calendar.google.com/calendar/render";
const MAX_URL = 1900;

/** Google Calendar template link. `details` is shortened (description first, link back kept) to keep the URL short. */
export function googleCalendarUrl(input: CalendarInput): string {
  const { session, placeName, eventName, slug, origin } = input;
  const link = eventLink(origin, slug);
  const build = (description: string | undefined) => {
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: calendarTitle(session.title, placeName),
      dates: `${compactInstant(session.start)}/${compactInstant(session.end)}`,
      location: calendarLocation(placeName, eventName),
      details: calendarDescription(description, link),
    });
    return `${GOOGLE_BASE}?${params.toString()}`;
  };
  let description = session.description;
  let url = build(description);
  while (url.length > MAX_URL && description) {
    const cut = Math.max(0, Math.floor(description.length * 0.8) - 1);
    description = cut > 0 ? description.slice(0, cut).trimEnd() + "…" : undefined;
    url = build(description);
  }
  return url;
}

/** Downloads the .ics through a Blob; the object URL is revoked right after the click. */
export function downloadIcs(input: CalendarInput) {
  const blob = new Blob([buildIcs(input)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = icsFileName(input.slug, input.session.id);
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // A short delay keeps Safari from cancelling the download.
  setTimeout(() => URL.revokeObjectURL(url), 250);
}
