import { MAX_EVENTS_IN_LIST } from "@atlas/contract";
import type { EventListRepository } from "../application/list-events";
import type { StoredEventSummary } from "../domain/event-list";
import { publishedEvent } from "./sql";
import { COVER_JOIN_COLUMNS, storedCoverFromJoin, toPublicCover, type CoverJoinRow } from "./d1-cover-repository";

interface EventRow extends CoverJoinRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export class D1EventListRepository implements EventListRepository {
  constructor(private readonly db: D1Database) {}

  async listSummaries(): Promise<StoredEventSummary[]> {
    // Explicit public columns only. ORDER BY matches idx_events_start_slug, so LIMIT bounds rows read.
    const { results } = await this.db
      .prepare(
        `SELECT e.id AS id, e.slug AS slug, e.name AS name, e.start_date AS start_date, e.end_date AS end_date, e.city AS city,
                e.country AS country, e.latitude AS latitude, e.longitude AS longitude, ${COVER_JOIN_COLUMNS}
         FROM events e LEFT JOIN event_covers c ON c.event_id = e.id
         WHERE ${publishedEvent("e")} ORDER BY e.start_date, e.slug LIMIT ?1`,
      )
      .bind(MAX_EVENTS_IN_LIST)
      .all<EventRow>();
    return results.map((r) => {
      const stored = storedCoverFromJoin(r);
      return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      city: r.city,
      country: r.country,
      latitude: r.latitude,
      longitude: r.longitude,
      cover: stored ? toPublicCover(stored) : null,
      };
    });
  }
}
