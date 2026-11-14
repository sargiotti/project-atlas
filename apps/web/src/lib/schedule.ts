import { localToUtc, parseUtcInstant, sessionDay, utcToLocal, type Session } from "@atlas/contract";

/** Point sheet schedule logic (slice 09). All time zone maths comes from @atlas/contract. */

const AT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * `?at=YYYY-MM-DDTHH:MM` (event-local) to epoch ms, for rendering Now/Next only. Anything malformed or
 * impossible is ignored (null, so the real clock is used). Never sent, stored or reflected.
 */
export function parseAt(search: string, timeZone: string): number | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("at");
  } catch {
    return null;
  }
  if (!raw || !AT_REGEX.test(raw)) return null;
  const [date, time] = raw.split("T") as [string, string];
  try {
    const ms = localToUtc(date, time, timeZone);
    // Round trip rejects impossible values the engine would roll over (2026-02-31, 25:00, a DST gap).
    const back = utcToLocal(ms, timeZone);
    return Number.isFinite(ms) && back.date === date && back.time === time ? ms : null;
  } catch {
    return null;
  }
}

export interface TimedSession extends Session {
  startMs: number;
  endMs: number;
  /** Festival day (YYYY-MM-DD) this session belongs to. */
  day: string;
}

export function withTimes(sessions: Session[], timeZone: string, dayStart: string): TimedSession[] {
  const out: TimedSession[] = [];
  for (const s of sessions) {
    const startMs = parseUtcInstant(s.start);
    const endMs = parseUtcInstant(s.end);
    if (startMs === null || endMs === null) continue;
    out.push({ ...s, startMs, endMs, day: sessionDay(startMs, timeZone, dayStart) });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
}

export function daysOf(sessions: TimedSession[]): string[] {
  return [...new Set(sessions.map((s) => s.day))].sort();
}

/** The day to open first: today's grid day if the Point has sessions then, else the next day with some, else the last. */
export function defaultDay(days: string[], nowMs: number, timeZone: string, dayStart: string): string {
  const today = sessionDay(nowMs, timeZone, dayStart);
  return days.find((d) => d === today) ?? days.find((d) => d > today) ?? days[days.length - 1]!;
}

export type SessionState = "past" | "now" | "future";
export function stateOf(s: TimedSession, nowMs: number): SessionState {
  return nowMs >= s.endMs ? "past" : nowMs >= s.startMs ? "now" : "future";
}

/** Splits one day's sessions (already sorted) into the running one, the upcoming ones and the finished ones. */
export function splitDay(sessions: TimedSession[], nowMs: number) {
  const now = sessions.find((s) => stateOf(s, nowMs) === "now") ?? null;
  const future = sessions.filter((s) => stateOf(s, nowMs) === "future");
  const past = sessions.filter((s) => stateOf(s, nowMs) === "past");
  return { now, future, past };
}

/** HH:MM in the Event's zone. */
export function timeLabel(ms: number, timeZone: string): string {
  return utcToLocal(ms, timeZone).time;
}

/** Local date of an instant when it differs from the grid day (after-midnight sessions), else null. */
export function spillDate(ms: number, timeZone: string, day: string): string | null {
  const { date } = utcToLocal(ms, timeZone);
  return date === day ? null : date;
}

/** Weekday and day of month of a `YYYY-MM-DD`, in the UI language. */
export function weekdayShort(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
export function dayChipLabel(date: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** "Europe/Dublin" -> "Dublin"; "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
export function cityOfZone(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

export function deviceTimeZone(): string | null {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Whole minutes to the sheet's short duration ("45 min", "1 h 20 min"). */
export function durationLabel(minutes: number, hourUnit: string): string {
  const m = Math.max(1, Math.ceil(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ${hourUnit} ${r} min` : `${h} ${hourUnit}`;
}
