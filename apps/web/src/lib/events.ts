import type { EventSummary } from "@atlas/contract";

/** The visitor's local calendar date as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function isEnded(e: Pick<EventSummary, "endDate">, today: string) {
  return e.endDate < today;
}

/**
 * Nearby events first, then the rest; inside each group: in progress first (earliest start first), then upcoming by start date ascending,
 * then ended, most recently ended first. Dates are ISO strings, so string comparison is date comparison.
 */
export function sortEvents(events: EventSummary[], today: string): EventSummary[] {
  const group = (e: EventSummary) => (e.endDate < today ? 2 : e.startDate > today ? 1 : 0);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...events].sort((a, b) => {
    if (a.nearby !== b.nearby) return a.nearby ? -1 : 1;
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const byDate = ga === 2 ? cmp(b.endDate, a.endDate) || cmp(b.startDate, a.startDate) : cmp(a.startDate, b.startDate);
    return byDate || cmp(a.slug, b.slug);
  });
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);

export function formatEventDates(start: string, end: string, lang: string) {
  const f = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return start === end ? f.format(utc(start)) : f.formatRange(utc(start), utc(end));
}

export function countryName(code: string, lang: string) {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
