import { MAX_EVENTS_IN_LIST } from "@atlas/contract";
import type { EventListRepository } from "../application/list-events";
import type { StoredEventSummary } from "../domain/event-list";

interface EventRow {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  cover_key: string | null;
  cover_width: number | null;
  cover_height: number | null;
}

export class D1EventListRepository implements EventListRepository {
  constructor(private readonly db: D1Database) {}

  async listSummaries(): Promise<StoredEventSummary[]> {
    // Explicit public columns only. ORDER BY matches idx_events_start_slug, so LIMIT bounds rows read.
    const { results } = await this.db
      .prepare(
        `SELECT slug, name, start_date, end_date, city, country, latitude, longitude, cover_key, cover_width, cover_height
         FROM events ORDER BY start_date, slug LIMIT ?1`,
      )
      .bind(MAX_EVENTS_IN_LIST)
      .all<EventRow>();
    return results.map((r) => ({
      slug: r.slug,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      city: r.city,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
      cover:
        r.cover_key !== null && r.cover_width !== null && r.cover_height !== null
          ? { key: r.cover_key, width: r.cover_width, height: r.cover_height }
          : null,
    }));
  }
}
