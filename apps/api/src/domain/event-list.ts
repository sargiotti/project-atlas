import type { EventSummary } from "@atlas/contract";

/** Raw facts about an event as stored. Free of framework and I/O types. */
export interface StoredEventSummary {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  cover: { key: string; width: number; height: number } | null;
}

/** Cover URL builder: always from the stored key, never a free-form URL. Static assets under /covers/. */
export function coverUrl(key: string): string {
  return `/covers/${key}`;
}

export function toEventSummary(s: StoredEventSummary): EventSummary {
  return {
    slug: s.slug,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    city: s.city,
    country: s.country,
    cover: s.cover ? { url: coverUrl(s.cover.key), width: s.cover.width, height: s.cover.height } : null,
  };
}
