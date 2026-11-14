import { MAX_EVENTS_IN_LIST } from "@atlas/contract";
import type { EventPreviewRepository } from "../application/get-event-preview";
import type { StoredEventPreview } from "../domain/event-preview";
import { publishedEvent } from "./sql";

interface Row {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  og_key: string | null;
}

export class D1EventPreviewRepository implements EventPreviewRepository {
  constructor(private readonly db: D1Database) {}

  async listPreviews(): Promise<StoredEventPreview[]> {
    // One bounded query for every event (same ordering and cap as the list, so LIMIT bounds rows read).
    const { results } = await this.db
      .prepare(
        `SELECT slug, name, start_date, end_date, city, country, og_key
         FROM events WHERE ${publishedEvent()} ORDER BY start_date, slug LIMIT ?1`,
      )
      .bind(MAX_EVENTS_IN_LIST)
      .all<Row>();
    return results.map((r) => ({
      slug: r.slug,
      name: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      city: r.city,
      country: r.country,
      ogKey: r.og_key,
    }));
  }
}
