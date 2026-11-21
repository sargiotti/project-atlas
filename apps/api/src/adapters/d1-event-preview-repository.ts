import { MAX_EVENTS_IN_LIST } from "@atlas/contract";
import type { EventPreviewRepository } from "../application/get-event-preview";
import type { StoredEventPreview } from "../domain/event-preview";
import { publishedEvent } from "./sql";

interface Row {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  og_key: string | null;
  description: string | null;
  owner_id: string | null;
}

export class D1EventPreviewRepository implements EventPreviewRepository {
  constructor(private readonly db: D1Database) {}

  async listPreviews(): Promise<StoredEventPreview[]> {
    // One bounded query for every event (same ordering and cap as the list, so LIMIT bounds rows read).
    const { results } = await this.db
      .prepare(
        `SELECT e.id AS id, e.slug AS slug, e.name AS name, e.start_date AS start_date, e.end_date AS end_date, e.city AS city,
                e.country AS country, c.og_key AS og_key, e.description AS description, e.owner_id AS owner_id
         FROM events e LEFT JOIN event_covers c ON c.event_id = e.id
         WHERE ${publishedEvent("e")} ORDER BY e.start_date, e.slug LIMIT ?1`,
      )
      .bind(MAX_EVENTS_IN_LIST)
      .all<Row>();
    return results.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      city: r.city,
      country: r.country,
      ogKey: r.og_key,
      description: r.description,
      isDemo: r.owner_id === null,
    }));
  }
}
