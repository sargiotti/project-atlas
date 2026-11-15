import { toneOf, type CoverImage, type EventSummaryBase } from "@atlas/contract";

/** Raw facts about an event as stored. Free of framework and I/O types. */
export interface StoredEventSummary {
  slug: string;
  name: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  /** Event id, domain only: the public summary carries `tone` (a bounded integer from it), never the id. */
  id: string;
  /** Already in its public shape (null: none, or a stored key that does not pass the public URL rules). */
  cover: CoverImage | null;
  /** City-level coordinates, domain only (used to compute `nearby`). Never copied to the public summary. */
  latitude: number | null;
  longitude: number | null;
}

export function toEventSummary(s: StoredEventSummary): EventSummaryBase {
  return {
    slug: s.slug,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    city: s.city,
    country: s.country,
    cover: s.cover,
    tone: toneOf(s.id),
  };
}
