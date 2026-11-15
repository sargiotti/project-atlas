import { addDays, localToUtc, utcToLocal } from "@atlas/contract";

// Slice 13: the typed-time maths of the Schedule editor. Pure functions, no React. A typed clock time belongs to the
// festival day of the open tab: at or after the Event's `dayStart` it is on that calendar date, before it, it is early
// the next morning ("after midnight", still that day's programme, exactly as the visitor grid shows it).

export const MIN_MS = 60_000;
export const LENGTH_CHIPS = [30, 45, 60, 90, 120] as const;

/**
 * Forgiving 24 h / 12 h input to "HH:MM". Accepts `2130`, `930`, `21:30`, `21.30`, `21h`, `21h30`, `9pm`, `9:30 pm`,
 * `12am`. Anything else (or an impossible time) is null.
 */
export function parseTypedTime(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/\s+/g, "");
  let ap: "a" | "p" | null = null;
  const suffix = /(am|pm|a|p)$/.exec(s);
  if (suffix) {
    ap = suffix[1]!.startsWith("p") ? "p" : "a";
    s = s.slice(0, -suffix[1]!.length);
  }
  let h: number;
  let min = 0;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})$/.exec(s))) h = Number(m[1]);
  else if ((m = /^(\d{1,2})[:.h](\d{1,2})?$/.exec(s))) {
    h = Number(m[1]);
    if (m[2] !== undefined) {
      if (m[2].length === 1 && /[:.]/.test(s)) return null; // "9:3" is more likely a typo than 9:03
      min = Number(m[2]);
    }
  } else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) {
    h = Number(m[1]);
    min = Number(m[2]);
  } else return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === "p" ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "HH:MM" to minutes after midnight. */
export const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/**
 * The instant a typed time means on festival day `day`. Null when that wall-clock time does not exist (a DST gap).
 */
export function resolveTime(day: string, time: string, dayStart: string, timeZone: string): number | null {
  const date = time >= dayStart ? day : addDays(day, 1);
  const ms = localToUtc(date, time, timeZone);
  return utcToLocal(ms, timeZone).time === time ? ms : null;
}

export type EndResult = { ok: true; ms: number } | { ok: false; reason: "gap" | "equal" | "long" };

/** The end instant for a typed end time given the start. An end earlier than the start means "the next morning". */
export function resolveEnd(startMs: number, day: string, time: string, dayStart: string, timeZone: string): EndResult {
  let ms = resolveTime(day, time, dayStart, timeZone);
  if (ms === null) return { ok: false, reason: "gap" };
  if (ms === startMs) return { ok: false, reason: "equal" };
  if (ms < startMs) {
    const next = localToUtc(addDays(utcToLocal(ms, timeZone).date, 1), time, timeZone);
    if (utcToLocal(next, timeZone).time !== time) return { ok: false, reason: "gap" };
    ms = next;
  }
  if (ms - startMs > 24 * 60 * MIN_MS) return { ok: false, reason: "long" };
  return { ok: true, ms };
}

/** All `YYYY-MM-DD` from start to end (inclusive). Capped, as a guard against a bad range. */
export function eventDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let d = startDate; d <= endDate && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

export type Span = { id: string; startMs: number; endMs: number; title: string };

/** First span overlapping [startMs, endMs). Half open: a show starting exactly when another ends is fine. */
export function findClash(spans: Span[], startMs: number, endMs: number): Span | null {
  let hit: Span | null = null;
  for (const s of spans) if (s.startMs < endMs && startMs < s.endMs && (!hit || s.startMs < hit.startMs)) hit = s;
  return hit;
}

export type Fix = { startMs: number; endMs: number; kind: "start" | "free" };

/**
 * Up to two one-click fixes for a clashing candidate: "start when the clashing show ends" (same length) and "use the
 * nearest free time" (the whole gap, at least 15 min). The gaps are looked for inside the festival day
 * [dayBeginMs, dayEndMs) only.
 */
export function suggestFixes(spans: Span[], startMs: number, endMs: number, clash: Span, dayBeginMs: number, dayEndMs: number): Fix[] {
  const len = endMs - startMs;
  const out: Fix[] = [];
  const after = clash.endMs;
  if (!findClash(spans, after, after + len) && after < dayEndMs) out.push({ startMs: after, endMs: after + len, kind: "start" });
  const sorted = spans.slice().sort((a, b) => a.startMs - b.startMs);
  const gaps: [number, number][] = [];
  let cursor = dayBeginMs;
  for (const s of sorted) {
    if (s.startMs > cursor) gaps.push([cursor, Math.min(s.startMs, dayEndMs)]);
    cursor = Math.max(cursor, s.endMs);
  }
  if (cursor < dayEndMs) gaps.push([cursor, dayEndMs]);
  const usable = gaps
    .filter(([a, b]) => b - a >= 15 * MIN_MS && b - a <= 24 * 60 * MIN_MS && !out.some((f) => f.startMs === a))
    .sort((g1, g2) => Math.abs(g1[0] - startMs) - Math.abs(g2[0] - startMs));
  if (usable[0]) out.push({ startMs: usable[0][0], endMs: usable[0][1], kind: "free" });
  return out.slice(0, 2);
}

/** Minutes of the length between two instants, rounded. */
export const minutesBetween = (a: number, b: number) => Math.round((b - a) / MIN_MS);

/** The instant the festival day `day` ends (start of the next one), in the Event's zone. */
export const dayEnd = (day: string, dayStart: string, timeZone: string) => localToUtc(addDays(day, 1), dayStart, timeZone);
export const dayBegin = (day: string, dayStart: string, timeZone: string) => localToUtc(day, dayStart, timeZone);
