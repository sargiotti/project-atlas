import { addDays, localToUtc, sessionDay, utcToLocal } from "@atlas/contract";
import type { TimedSession } from "./schedule";

/** Schedule grid logic (slice 10). Pure functions; all time zone maths comes from @atlas/contract. */

const MIN = 60_000;
const HOUR = 60 * MIN;

// ---- zoom (three fixed steps, px per minute) -----------------------------------------------
export const ZOOM_STEPS = [
  { id: "compact", ppm: 0.6 },
  { id: "normal", ppm: 1.6 },
  { id: "detail", ppm: 2.8 },
] as const;
export const ZOOM_KEY = "atlas.schedule.zoom";
export const DEFAULT_ZOOM = 1;

/** Reads the stored step against the allowlist; anything else is Normal. */
export function readZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY);
    const i = ZOOM_STEPS.findIndex((z) => z.id === raw);
    return i >= 0 ? i : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}
export function writeZoom(i: number) {
  try {
    localStorage.setItem(ZOOM_KEY, ZOOM_STEPS[i]!.id);
  } catch {
    // storage may be blocked; the step just is not remembered
  }
}

// ---- day window and bucketing --------------------------------------------------------------
/** The instants a festival day covers. Never assumes 24 h: a DST day is 23 or 25 h long. */
export function dayWindow(day: string, timeZone: string, dayStart: string) {
  return { startMs: localToUtc(day, dayStart, timeZone), endMs: localToUtc(addDays(day, 1), dayStart, timeZone) };
}

/** Sessions of one festival day, per place (columns follow `placeOrder`; places without Sessions that day are left out). */
export interface DayBuckets {
  days: string[];
  byDay: Map<string, Map<string, TimedSession[]>>;
}
export function bucketByDay(sessions: TimedSession[], placeOrder: string[]): DayBuckets {
  const byDay = new Map<string, Map<string, TimedSession[]>>();
  for (const s of sessions) {
    let d = byDay.get(s.day);
    if (!d) byDay.set(s.day, (d = new Map()));
    const list = d.get(s.pointId);
    if (list) list.push(s);
    else d.set(s.pointId, [s]);
  }
  const rank = new Map(placeOrder.map((id, i) => [id, i]));
  // Re-key every day in the Event's Point order.
  for (const [day, m] of byDay) {
    const ordered = new Map([...m].sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0)));
    byDay.set(day, ordered);
  }
  return { days: [...byDay.keys()].sort(), byDay };
}

/** Floor of an instant to a whole local hour. */
function floorHour(ms: number, timeZone: string) {
  const { date, time } = utcToLocal(ms, timeZone);
  return localToUtc(date, `${time.slice(0, 2)}:00`, timeZone);
}

/** The vertical span of a day: floor hour of the first start to ceiling hour of the last end (extended to include now). */
export function daySpan(daySessions: TimedSession[], timeZone: string, nowMs: number | null) {
  let a = Infinity;
  let b = -Infinity;
  for (const s of daySessions) {
    a = Math.min(a, s.startMs);
    b = Math.max(b, s.endMs);
  }
  if (nowMs !== null) {
    a = Math.min(a, nowMs);
    b = Math.max(b, nowMs + 30 * MIN);
  }
  if (!Number.isFinite(a)) return { startMs: 0, endMs: 0 };
  const startMs = floorHour(a, timeZone);
  const f = floorHour(b, timeZone);
  return { startMs, endMs: f === b ? b : f + HOUR };
}

export interface Block {
  session: TimedSession;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}
export interface Column {
  pointId: string;
  /** Most Sessions running at once in this place that day (drives the column width). */
  maxLanes: number;
  blocks: Block[];
}

/**
 * Positions the blocks of one place: top/height in px from the span start, and side-by-side lanes for overlaps.
 * Lanes use the DRAWN height (blocks are enlarged to the minimum tap height), so enlarged short blocks never overlap.
 */
export function layoutColumn(items: TimedSession[], spanStartMs: number, ppm: number, minHeightPx: number): Column {
  // Real overlap, for the column width.
  const ends: number[] = [];
  let maxLanes = 1;
  for (const s of items) {
    let i = ends.findIndex((e) => e <= s.startMs);
    if (i < 0) {
      i = ends.length;
      ends.push(0);
    }
    ends[i] = s.endMs;
    maxLanes = Math.max(maxLanes, ends.filter((e) => e > s.startMs).length);
  }
  // Visual lanes inside clusters of drawn overlap.
  const minMs = (minHeightPx / ppm) * MIN;
  const blocks: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const flush = () => {
    const n = laneEnds.length || 1;
    for (const b of cluster) b.lanes = n;
  };
  for (const s of items) {
    const drawnEnd = Math.max(s.endMs, s.startMs + minMs);
    if (s.startMs >= clusterEnd) {
      flush();
      cluster = [];
      laneEnds = [];
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= s.startMs);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = drawnEnd;
    clusterEnd = Math.max(clusterEnd, drawnEnd);
    const top = ((s.startMs - spanStartMs) / MIN) * ppm + 1;
    const height = Math.max(minHeightPx, ((s.endMs - s.startMs) / MIN) * ppm - 2);
    const block: Block = { session: s, top, height, lane, lanes: 1 };
    blocks.push(block);
    cluster.push(block);
  }
  flush();
  return { pointId: items[0]?.pointId ?? "", maxLanes, blocks };
}

// ---- status and opening rule ---------------------------------------------------------------
export type EventState = "before" | "live" | "gap" | "after";

export interface Opening {
  state: EventState;
  /** Day tab to open on. */
  day: string;
  /** Day the real "now" belongs to (only meaningful while the Event is running). */
  nowDay: string | null;
  /** First Session after now (gap state). */
  next: TimedSession | null;
  /** First Session overall (before state). */
  first: TimedSession | null;
}

/**
 * Where the grid opens, from the Sessions only (not the Event's dates): before the first start, after the last end,
 * a Session running now, or a gap in between. `sessions` is sorted by start (withTimes).
 */
export function openingFor(sessions: TimedSession[], days: string[], nowMs: number, timeZone: string, dayStart: string): Opening | null {
  if (sessions.length === 0 || days.length === 0) return null;
  const first = sessions[0]!;
  let lastEnd = -Infinity;
  let running = false;
  let next: TimedSession | null = null;
  for (const s of sessions) {
    lastEnd = Math.max(lastEnd, s.endMs);
    if (s.startMs <= nowMs && nowMs < s.endMs) running = true;
    if (!next && s.startMs > nowMs) next = s;
  }
  if (nowMs < first.startMs) return { state: "before", day: days[0]!, nowDay: null, next: null, first };
  if (nowMs >= lastEnd) return { state: "after", day: days[0]!, nowDay: null, next: null, first };
  const nowDay = sessionDay(nowMs, timeZone, dayStart);
  if (running) {
    const day = days.includes(nowDay) ? nowDay : (days.find((d) => d > nowDay) ?? days[days.length - 1]!);
    return { state: "live", day, nowDay, next, first };
  }
  // Running with nothing on: the next Session's day (it exists, because now is before the last end).
  return { state: "gap", day: next ? next.day : days[days.length - 1]!, nowDay, next, first };
}

/** Event running (some Session is on, or one is still to come after now). */
export function isRunning(state: EventState) {
  return state === "live" || state === "gap";
}

// ---- labels --------------------------------------------------------------------------------
const noDot = (s: string) => s.replace(/\.$/, "");
const fmt = (lang: string, date: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang, { timeZone: "UTC", ...o }).format(new Date(`${date}T12:00:00Z`));

export function weekdayLong(date: string, lang: string) {
  return fmt(lang, date, { weekday: "long" });
}
/** "Friday 4 Dec" (da: "fredag 4. dec."): always weekday + day + month, so far-away dates are unambiguous. */
export function longDate(date: string, lang: string) {
  const wd = fmt(lang, date, { weekday: "long" });
  const dn = String(Number(date.slice(8, 10)));
  const mo = noDot(fmt(lang, date, { month: "short" }));
  return lang === "da" ? `${wd} ${dn}. ${mo}.` : `${wd} ${dn} ${mo}`;
}

/** Day tab text: short weekday + day of month ("Fri 4", da "Fre 4"). */
export function dayTabLabel(date: string, lang: string) {
  const wd = noDot(fmt(lang, date, { weekday: "short" }));
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${Number(date.slice(8, 10))}`;
}
