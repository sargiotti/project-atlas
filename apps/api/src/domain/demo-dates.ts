import { addDays, localToUtc, utcToLocal } from "@atlas/contract";

/**
 * Slice 39: the demo events are re-dated daily so the Home never shows them as ended. Hard-coded allowlist: real
 * organizer events are never touched. Each demo sits in one Home window (Now / This weekend / Coming up).
 */
export type DemoPlacement = "now" | "weekend" | "coming-up";

export const DEMO_PLACEMENTS: Readonly<Record<string, DemoPlacement>> = {
  "nightfall-meadows": "now", // 4 days, starts yesterday: today is its day 2
  "fiestas-la-alameda": "weekend", // 4 days, starts the Friday of the current or next weekend
  "mercado-medieval-toledo": "weekend", // 3 days Fri-Sun, same weekend window as the fiestas
  havnelobet: "coming-up", // 1 day (a race), in 3 weeks
};
export const DEMO_SLUGS = Object.keys(DEMO_PLACEMENTS);

const COMING_UP_DAYS = 21;

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
}

/**
 * The start date a demo should have, from today's date in the event's zone. Weekend: the Friday of the weekend we
 * are in (Fri, Sat, Sun) or the next one (Mon to Thu), so a Fri-Mon event always overlaps it.
 */
export function targetStartDate(placement: DemoPlacement, today: string): string {
  if (placement === "now") return addDays(today, -1);
  if (placement === "coming-up") return addDays(today, COMING_UP_DAYS);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  const sinceFriday = dow === 5 ? 0 : dow === 6 ? 1 : dow === 0 ? 2 : 0;
  return sinceFriday > 0 ? addDays(today, -sinceFriday) : addDays(today, (5 - dow + 7) % 7);
}

/** Days to move a demo whose current start date is `currentStart` (0 when already current). */
export function demoShiftDays(slug: string, currentStart: string, timeZone: string, nowMs: number): number {
  const placement = DEMO_PLACEMENTS[slug];
  if (!placement) return 0;
  return daysBetween(currentStart, targetStartDate(placement, utcToLocal(nowMs, timeZone).date));
}

/** Moves a local `YYYY-MM-DDTHH:MM` by whole days, keeping the wall-clock time. */
export function shiftLocalDateTime(local: string, days: number): string {
  return `${addDays(local.slice(0, 10), days)}${local.slice(10)}`;
}

/** Moves a stored UTC instant (`...Z`, second precision) by whole days of local time, keeping the local wall-clock time (DST safe). */
export function shiftUtcInstant(utc: string, days: number, timeZone: string): string {
  const ms = Date.parse(utc);
  const { date, time } = utcToLocal(ms, timeZone);
  const seconds = Math.floor(ms / 1000) % 60;
  return new Date(localToUtc(addDays(date, days), time, timeZone) + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}
