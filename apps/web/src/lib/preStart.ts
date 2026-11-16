import { utcToLocal } from "@atlas/contract";

export type PreStartCopy =
  | { key: "preInMin"; n: number }
  | { key: "preInDur"; minutes: number }
  | { key: "preToday"; time: string }
  | { key: "preTomorrow" }
  | { key: "preInDays"; n: number }
  | { key: "preOnDate"; date: string };

const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

/**
 * Relative "Starts ..." copy for the pre-start banner (slice 16). Minutes round up; "today/tomorrow/N days" count
 * calendar days in the event's zone, not 24 h blocks. Null once the start has been reached.
 */
export function preStartCopy(startMs: number, nowMs: number, timeZone: string): PreStartCopy | null {
  const diffMin = Math.ceil((startMs - nowMs) / 60_000);
  if (diffMin <= 0) return null;
  if (diffMin < 60) return { key: "preInMin", n: Math.max(1, diffMin) };
  if (diffMin < 180) return { key: "preInDur", minutes: diffMin };
  const start = utcToLocal(startMs, timeZone);
  const days = dayNumber(start.date) - dayNumber(utcToLocal(nowMs, timeZone).date);
  if (days <= 0) return { key: "preToday", time: start.time };
  if (days === 1) return { key: "preTomorrow" };
  if (days <= 30) return { key: "preInDays", n: days };
  return { key: "preOnDate", date: start.date };
}
