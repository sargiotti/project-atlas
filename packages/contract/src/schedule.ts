/**
 * Time helpers shared by the API (validation, seed) and the web app (day grid, Now/Next).
 * Pure functions over `Intl`; no dependencies. Instants travel as UTC ISO strings without milliseconds
 * (`2026-07-10T21:30:00Z`); local wall-clock times are always paired with an IANA time zone.
 */

export const UTC_INSTANT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const DAY_START_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_DAY_START = "06:00";
export const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

/** True when the runtime accepts the zone (an invalid one throws a RangeError). */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length < 1 || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Parses a strict UTC instant (see UTC_INSTANT_REGEX) to epoch ms; null when malformed or impossible. */
export function parseUtcInstant(iso: string): number | null {
  if (!UTC_INSTANT_REGEX.test(iso)) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  // Rejects impossible values the engine would roll over (e.g. 2026-02-30 is NaN, but be strict anyway).
  return new Date(ms).toISOString().slice(0, 19) + "Z" === iso ? ms : null;
}

export function formatUtcInstant(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19) + "Z";
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsOf(utcMs: number, timeZone: string): Record<string, string> {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return p;
}

export interface LocalParts {
  /** YYYY-MM-DD in the zone. */
  date: string;
  /** HH:MM in the zone (00:00-23:59). */
  time: string;
}

/** Wall-clock date and time of an instant in a zone. */
export function utcToLocal(utcMs: number, timeZone: string): LocalParts {
  const p = partsOf(utcMs, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = partsOf(utcMs, timeZone);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Instant (epoch ms) of a wall-clock `YYYY-MM-DD` + `HH:MM` in a zone. */
export function localToUtc(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

/** Calendar arithmetic on `YYYY-MM-DD` strings (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The festival day a session belongs to: its local date, except that anything starting before the Event's
 * `dayStart` (e.g. 00:30 with a 06:00 day start) belongs to the previous day's grid.
 */
export function sessionDay(startUtcMs: number, timeZone: string, dayStart: string): string {
  const { date, time } = utcToLocal(startUtcMs, timeZone);
  return time < dayStart ? addDays(date, -1) : date;
}

export interface SessionWindow {
  /** Epoch ms, inclusive. */
  from: number;
  /** Epoch ms, exclusive. */
  until: number;
}

/**
 * Slice 13: the one rule for where a Session may start. A Session belongs to the festival day `startDate..endDate`
 * (in the Event's zone, where a day runs from `dayStart` to the next `dayStart`), so it may start from `dayStart` on
 * `startDate` up to, but not including, `dayStart` on the day after `endDate` (the last night after midnight).
 * Equivalent to `sessionDay(start, tz, dayStart)` being within `startDate..endDate`. Only `start` is checked; `end` is
 * bounded by MAX_SESSION_MS. DST is handled by `localToUtc`. Used by the bundle refinement, the seed, the organizer
 * PUT, the event-edit check and the web client.
 */
export function sessionWindow(startDate: string, endDate: string, dayStart: string, timeZone: string): SessionWindow {
  return {
    from: localToUtc(startDate, dayStart, timeZone),
    until: localToUtc(addDays(endDate, 1), dayStart, timeZone),
  };
}

export const isInSessionWindow = (startMs: number, w: SessionWindow): boolean => startMs >= w.from && startMs < w.until;
