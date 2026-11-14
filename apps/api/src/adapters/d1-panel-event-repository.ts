import { MAX_EVENTS_PER_ORGANIZER, type EventInput, type PanelEvent } from "@atlas/contract";

interface Row {
  id: string;
  slug: string;
  status: "draft" | "published";
  name: string;
  start_date: string;
  end_date: string;
  time_zone: string;
  city: string;
  country: string;
  language: string;
  description: string | null;
  website: string | null;
  day_start: string;
  created_at: number;
  updated_at: number;
}

const COLUMNS = `id, slug, status, name, start_date, end_date, time_zone, city, country, language,
  description, website, day_start, created_at, updated_at`;

export interface OwnedEvent extends PanelEvent {
  dayStart: string;
}

const toEvent = (r: Row): OwnedEvent => ({
  id: r.id,
  slug: r.slug,
  status: r.status,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  timeZone: r.time_zone,
  city: r.city,
  country: r.country,
  language: r.language,
  description: r.description,
  website: r.website,
  dayStart: r.day_start,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

export type InsertOutcome = "inserted" | "limit_reached" | "slug_taken";

/**
 * Organizer-scoped event storage. Ownership is part of every statement (AND owner_id = ?): a row that
 * is not yours, does not exist or is a demo event (owner_id NULL) is indistinguishable (no row / no change).
 */
export class D1PanelEventRepository {
  constructor(private readonly db: D1Database) {}

  async list(ownerId: string): Promise<OwnedEvent[]> {
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM events WHERE owner_id = ?1 ORDER BY created_at DESC, id LIMIT ?2`)
      .bind(ownerId, MAX_EVENTS_PER_ORGANIZER)
      .all<Row>();
    return results.map(toEvent);
  }

  async get(id: string, ownerId: string): Promise<OwnedEvent | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM events WHERE id = ?1 AND owner_id = ?2`)
      .bind(id, ownerId)
      .first<Row>();
    return row ? toEvent(row) : null;
  }

  /**
   * One atomic statement: inserts only while the owner has fewer than 10 events (all statuses).
   * Always writes status 'draft' (the column default is 'published', so it must never be omitted).
   * A slug collision (UNIQUE) is reported as `slug_taken` so the caller can retry with a new suffix.
   */
  async insertDraft(args: {
    id: string;
    slug: string;
    ownerId: string;
    input: EventInput;
    now: number;
  }): Promise<InsertOutcome> {
    const { id, slug, ownerId, input: e, now } = args;
    try {
      const res = await this.db
        .prepare(
          `INSERT INTO events (id, slug, name, start_date, end_date, time_zone, city, country, language,
                               description, website, status, owner_id, day_start, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'draft', ?12, '06:00', ?13, ?13
           WHERE (SELECT COUNT(*) FROM events WHERE owner_id = ?12) < ?14`,
        )
        .bind(
          id, slug, e.name, e.startDate, e.endDate, e.timeZone, e.city, e.country, e.language,
          e.description, e.website, ownerId, now, MAX_EVENTS_PER_ORGANIZER,
        )
        .run();
      return res.meta.changes === 1 ? "inserted" : "limit_reached";
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: events\.slug/i.test(err.message)) return "slug_taken";
      throw err;
    }
  }

  /** Full replace of the editable fields. Slug, status, owner and day start are never touched. */
  async update(id: string, ownerId: string, e: EventInput, now: number): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE events SET name = ?3, start_date = ?4, end_date = ?5, time_zone = ?6, city = ?7, country = ?8,
                language = ?9, description = ?10, website = ?11, updated_at = ?12
         WHERE id = ?1 AND owner_id = ?2`,
      )
      .bind(id, ownerId, e.name, e.startDate, e.endDate, e.timeZone, e.city, e.country, e.language, e.description, e.website, now)
      .run();
    return res.meta.changes === 1;
  }

  /** Hard delete. Maps, points and sessions go with it (ON DELETE CASCADE). */
  async delete(id: string, ownerId: string): Promise<boolean> {
    const res = await this.db.prepare(`DELETE FROM events WHERE id = ?1 AND owner_id = ?2`).bind(id, ownerId).run();
    return res.meta.changes === 1;
  }
}
