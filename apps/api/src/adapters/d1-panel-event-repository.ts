import { MAX_EVENTS_PER_ORGANIZER, formatUtcInstant, sessionWindow, type EventInput, type EventStatus, type PanelEvent } from "@atlas/contract";
import { MAP_JOIN_COLUMNS, storedMapFromJoin, toPanelMap, type MapJoinRow, type StoredMapImage } from "./d1-map-image-repository";
import { COVER_JOIN_COLUMNS, storedCoverFromJoin, toPanelCover, type CoverJoinRow, type StoredCover } from "./d1-cover-repository";

interface Row extends MapJoinRow, CoverJoinRow {
  id: string;
  slug: string;
  status: EventStatus;
  status_reason: string | null;
  requested_at: number | null;
  approved_at: number | null;
  name: string;
  start_date: string;
  end_date: string;
  time_zone: string;
  city: string;
  country: string;
  language: string;
  description: string | null;
  website: string | null;
  venue_address: string | null;
  day_start: string;
  owner_id: string | null;
  created_at: number;
  updated_at: number;
}

export const COLUMNS = `e.id AS id, e.slug AS slug, e.publish_state AS status, e.status_reason AS status_reason,
  e.requested_at AS requested_at, e.approved_at AS approved_at, e.owner_id AS owner_id, e.name AS name, e.start_date AS start_date,
  e.end_date AS end_date, e.time_zone AS time_zone, e.city AS city, e.country AS country, e.language AS language,
  e.description AS description, e.website AS website, e.venue_address AS venue_address, e.day_start AS day_start, e.created_at AS created_at,
  e.updated_at AS updated_at, ${MAP_JOIN_COLUMNS}, ${COVER_JOIN_COLUMNS}`;
export const FROM = `events e LEFT JOIN event_map_images m ON m.event_id = e.id LEFT JOIN event_covers c ON c.event_id = e.id`;

export interface OwnedEvent extends PanelEvent {
  dayStart: string;
  /** Null for seeded demo events. Never part of a response; the Admin routes look the organizer up from it. */
  ownerId: string | null;
  /** Same map as `map`, as stored (the preview route needs the raw numbers and keys). */
  storedMap: StoredMapImage | null;
  /** Same cover as `cover`, as stored (the preview route needs the public shape and the keys). */
  storedCover: StoredCover | null;
}

export const toEvent = (r: Row): OwnedEvent => {
  const storedMap = storedMapFromJoin(r);
  const storedCover = storedCoverFromJoin(r);
  return {
  id: r.id,
  slug: r.slug,
  status: r.status,
  statusReason: r.status_reason,
  requestedAt: r.requested_at === null ? null : new Date(r.requested_at).toISOString(),
  approvedAt: r.approved_at === null ? null : new Date(r.approved_at).toISOString(),
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  timeZone: r.time_zone,
  city: r.city,
  country: r.country,
  language: r.language,
  description: r.description,
  website: r.website,
  venueAddress: r.venue_address,
  dayStart: r.day_start,
  ownerId: r.owner_id,
  map: storedMap ? toPanelMap(storedMap) : null,
  storedMap,
  cover: storedCover ? toPanelCover(storedCover) : null,
  storedCover,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
  };
};

export type InsertOutcome = "inserted" | "limit_reached" | "slug_taken";

/**
 * Organizer-scoped event storage. Ownership is part of every statement (AND owner_id = ?): a row that
 * is not yours, does not exist or is a demo event (owner_id NULL) is indistinguishable (no row / no change).
 */
export class D1PanelEventRepository {
  constructor(private readonly db: D1Database) {}

  async list(ownerId: string): Promise<OwnedEvent[]> {
    const { results } = await this.db
      .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE e.owner_id = ?1 ORDER BY e.created_at DESC, e.id LIMIT ?2`)
      .bind(ownerId, MAX_EVENTS_PER_ORGANIZER)
      .all<Row>();
    return results.map(toEvent);
  }

  async get(id: string, ownerId: string): Promise<OwnedEvent | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE e.id = ?1 AND e.owner_id = ?2`)
      .bind(id, ownerId)
      .first<Row>();
    return row ? toEvent(row) : null;
  }

  /**
   * One atomic statement: inserts only while the owner has fewer than 10 events (all statuses).
   * Always writes both `status` (the frozen legacy column: its default is 'published') and `publish_state` as 'draft',
   * so neither default can ever publish an organizer's event.
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
                               description, website, venue_address, status, publish_state, owner_id, day_start, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'draft', 'draft', ?13, '06:00', ?14, ?14
           WHERE (SELECT COUNT(*) FROM events WHERE owner_id = ?13) < ?15`,
        )
        .bind(
          id, slug, e.name, e.startDate, e.endDate, e.timeZone, e.city, e.country, e.language,
          e.description, e.website, e.venueAddress, ownerId, now, MAX_EVENTS_PER_ORGANIZER,
        )
        .run();
      return res.meta.changes === 1 ? "inserted" : "limit_reached";
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed: events\.slug/i.test(err.message)) return "slug_taken";
      throw err;
    }
  }

  /**
   * Full replace of the editable fields, in any status. Slug, status, owner and day start are never touched.
   * Slice 13: refused (nothing written) while any stored Session would start outside the new `sessionWindow`; the check is
   * part of the UPDATE itself (NOT EXISTS), so a Session saved between a pre-check and the write cannot slip through.
   * Instants are `YYYY-MM-DDTHH:MM:SSZ` strings, so they compare as text.
   */
  async update(id: string, ownerId: string, e: EventInput, now: number): Promise<"ok" | "not_found" | { sessionsOutside: number }> {
    const own = await this.db.prepare(`SELECT day_start FROM events WHERE id = ?1 AND owner_id = ?2`).bind(id, ownerId).first<{ day_start: string }>();
    if (!own) return "not_found";
    const w = sessionWindow(e.startDate, e.endDate, own.day_start, e.timeZone);
    const from = formatUtcInstant(w.from);
    const until = formatUtcInstant(w.until);
    const outside = `s.event_id = ?1 AND (s.start_utc < ?2 OR s.start_utc >= ?3)`;
    const res = await this.db
      .prepare(
        `UPDATE events SET name = ?4, start_date = ?5, end_date = ?6, time_zone = ?7, city = ?8, country = ?9,
                language = ?10, description = ?11, website = ?12, venue_address = ?13, updated_at = ?14
         WHERE id = ?1 AND owner_id = ?15 AND NOT EXISTS (SELECT 1 FROM event_point_sessions s WHERE ${outside})`,
      )
      .bind(id, from, until, e.name, e.startDate, e.endDate, e.timeZone, e.city, e.country, e.language, e.description, e.website, e.venueAddress, now, ownerId)
      .run();
    if (res.meta.changes === 1) return "ok";
    const n = await this.db.prepare(`SELECT count(*) AS n FROM event_point_sessions s WHERE ${outside}`).bind(id, from, until).first<{ n: number }>();
    if (n && n.n > 0) return { sessionsOutside: n.n };
    // Not the caller's event any more (deleted in between), or a Session moved between the two statements: say not found.
    return "not_found";
  }

  /** Hard delete. Maps, points and sessions go with it (ON DELETE CASCADE). */
  async delete(id: string, ownerId: string): Promise<boolean> {
    const res = await this.db.prepare(`DELETE FROM events WHERE id = ?1 AND owner_id = ?2`).bind(id, ownerId).run();
    // D1 counts rows removed by ON DELETE CASCADE in `changes` (a map, points...), so "at least one", not "exactly one".
    return res.meta.changes > 0;
  }
}
