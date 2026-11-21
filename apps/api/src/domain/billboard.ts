import type { BillboardEvent, BillboardWindow } from "@atlas/contract";
import { BILLBOARD_WINDOWS } from "@atlas/contract";

/** What the billboard needs about one event. `nearby` is computed per request by the caller. */
export interface BillboardCandidate {
  event: BillboardEvent;
  timeZone: string;
}

const DAY_MS = 86_400_000;

const dayNumber = (isoDate: string): number => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!) / DAY_MS;
};

/** Today's calendar date (YYYY-MM-DD) in an IANA time zone. An unknown zone falls back to UTC. */
export function localDate(nowMs: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(nowMs);
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/**
 * Window of one event, by its dates and "today" in the event's own time zone. Null when it has ended.
 * - `now`: started and not ended (start <= today <= end). Wins over `weekend`, so a festival that is running is "Now".
 * - `weekend`: not started yet and starting on this week's Friday, Saturday or Sunday (weeks end on Sunday).
 * - `later`: everything else that has not started, including a Monday-to-Thursday start.
 * Windows depend only on the start date, so an event is in exactly one window.
 */
export function windowOf(startDate: string, endDate: string, today: string): BillboardWindow | null {
  const t = dayNumber(today);
  const start = dayNumber(startDate);
  if (dayNumber(endDate) < t) return null;
  if (start <= t) return "now";
  const dow = new Date(t * DAY_MS).getUTCDay(); // 0 = Sunday
  const sunday = t + ((7 - dow) % 7);
  return start >= sunday - 2 && start <= sunday ? "weekend" : "later";
}

/**
 * Groups candidates into windows (ended events dropped), each ordered nearby first, then start date, then slug.
 * Empty windows are omitted. Pure: `nowMs` is a parameter.
 */
export function groupBillboard(candidates: readonly BillboardCandidate[], nowMs: number): Array<{ id: BillboardWindow; events: BillboardEvent[] }> {
  const buckets: Record<BillboardWindow, BillboardEvent[]> = { now: [], weekend: [], later: [] };
  for (const c of candidates) {
    const w = windowOf(c.event.startDate, c.event.endDate, localDate(nowMs, c.timeZone));
    if (w) buckets[w].push(c.event);
  }
  return BILLBOARD_WINDOWS.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    events: buckets[id].sort(
      (a, b) =>
        Number(b.nearby) - Number(a.nearby) ||
        a.startDate.localeCompare(b.startDate) ||
        a.slug.localeCompare(b.slug),
    ),
  }));
}
