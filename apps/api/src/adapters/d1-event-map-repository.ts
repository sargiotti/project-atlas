import type { EventMapRepository } from "../application/get-map-bundle";
import type { StoredEventMap } from "../domain/map-bundle";
import { sessionWindow, isInSessionWindow, parseUtcInstant } from "@atlas/contract";
import { publishedEvent } from "./sql";

const FIRST_MAP_ID = `(SELECT m.id FROM event_maps m JOIN events e ON e.id = m.event_id
  WHERE e.slug = ?1 AND ${publishedEvent("e")} ORDER BY m.position LIMIT 1)`;

interface MapRow {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  language: string;
  time_zone: string;
  day_start: string;
  city: string;
  country: string;
  description: string | null;
  website: string | null;
  venue_address: string | null;
  map_id: string;
  theme: "light" | "dark";
  width: number;
  height: number;
  image_key: string;
  image_format: "svg" | "webp";
}

interface UploadedMapRow {
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  language: string;
  time_zone: string;
  day_start: string;
  city: string;
  country: string;
  description: string | null;
  website: string | null;
  venue_address: string | null;
  event_id: string;
  theme: "light" | "dark";
  format: "webp" | "jpeg";
  full_key: string;
  full_width: number;
  full_height: number;
  small_key: string;
  small_width: number;
}

interface SessionRow {
  id: string;
  point_id: string;
  title: string;
  description: string | null;
  start_utc: string;
  end_utc: string;
}

interface PointRow {
  id: string;
  category: StoredEventMap["points"][number]["category"];
  name: string | null;
  description: string;
  x: number;
  y: number;
}

/** Slice 08d: the About-sheet columns. Empty optionals (NULL or '') are omitted, like the preview does. */
function aboutOf(r: { city: string; country: string; description: string | null; website: string | null; venue_address: string | null }) {
  return {
    // Legacy rows may have empty city/country (column default ''): omit, never fail the whole bundle.
    ...(r.city ? { city: r.city } : {}),
    ...(r.country ? { country: r.country } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...(r.website ? { website: r.website } : {}),
    ...(r.venue_address ? { venueAddress: r.venue_address } : {}),
  };
}

export class D1EventMapRepository implements EventMapRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Defence in depth (slice 13): the event edit refuses dates that would strand Sessions, but a Session outside the window
   * must never take the public map down, so such rows are dropped BEFORE the bundle schema sees them, and logged.
   */
  private inWindow(up: { slug: string; start_date: string; end_date: string; day_start: string; time_zone: string }, rows: SessionRow[]) {
    const w = sessionWindow(up.start_date, up.end_date, up.day_start, up.time_zone);
    const kept = rows.filter((r) => {
      const start = parseUtcInstant(r.start_utc);
      return start !== null && isInSessionWindow(start, w);
    });
    if (kept.length !== rows.length) console.error(`[bundle] dropped ${rows.length - kept.length} session(s) outside the event window slug=${up.slug}`);
    return kept.map((r) => ({
      id: r.id,
      pointId: r.point_id,
      title: r.title,
      start: r.start_utc,
      end: r.end_utc,
      ...(r.description ? { description: r.description } : {}),
    }));
  }

  async findFirstMapBySlug(slug: string): Promise<StoredEventMap | null> {
    // One batch, two prepared statements, all values bound (never concatenated).
    // Lookup by the indexed unique slug; bounded to one event and at most 500 points.
    const [mapResult, pointsResult, sessionsResult, uploadedResult, uploadedPointsResult, uploadedSessionsResult] = await this.db.batch<MapRow | PointRow | SessionRow | UploadedMapRow>([
      this.db
        .prepare(
          `SELECT e.slug, e.name, e.start_date, e.end_date, e.language, e.time_zone, e.day_start,
                  e.city, e.country, e.description, e.website, e.venue_address,
                  m.id AS map_id, m.theme, m.width, m.height, m.image_key, m.image_format
           FROM event_maps m JOIN events e ON e.id = m.event_id
           WHERE m.id = ${FIRST_MAP_ID} AND ${publishedEvent("e")}`,
        )
        .bind(slug),
      this.db
        .prepare(
          `SELECT id, category, name, description, x, y FROM points
           WHERE map_id = ${FIRST_MAP_ID} LIMIT 500`,
        )
        .bind(slug),
      // Bounded: one event, 1001 rows (the contract cap plus one, so an overflow fails output validation).
      this.db
        .prepare(
          `SELECT s.id, s.point_id, s.title, s.description, s.start_utc, s.end_utc
           FROM point_sessions s WHERE s.event_id = (SELECT id FROM events WHERE slug = ?1 AND ${publishedEvent()})
           ORDER BY s.start_utc, s.end_utc, s.id LIMIT 1001`,
        )
        .bind(slug),
      // Slice 08b: an organizer's uploaded map (event_map_images). Used only when the event has no bundled map above.
      this.db
        .prepare(
          `SELECT e.slug, e.name, e.start_date, e.end_date, e.language, e.time_zone, e.day_start, e.id AS event_id,
                  e.city, e.country, e.description, e.website, e.venue_address,
                  m.theme, m.format, m.full_key, m.full_width, m.full_height, m.small_key, m.small_width
           FROM events e JOIN event_map_images m ON m.event_id = e.id
           WHERE e.slug = ?1 AND ${publishedEvent("e")}`,
        )
        .bind(slug),
      // Slice 08c: the Points of an uploaded map, only through the published filter, at most 500.
      this.db
        .prepare(
          `SELECT p.id, p.category, p.name, p.description, p.x, p.y
           FROM event_points p JOIN events e ON e.id = p.event_id
           WHERE e.slug = ?1 AND ${publishedEvent("e")} LIMIT 500`,
        )
        .bind(slug),
      // Slice 13: the Sessions of an uploaded map, only through the published filter, at most 1001 (an overflow fails output validation).
      this.db
        .prepare(
          `SELECT s.id, s.point_id, s.title, s.description, s.start_utc, s.end_utc
           FROM event_point_sessions s JOIN events e ON e.id = s.event_id
           WHERE e.slug = ?1 AND ${publishedEvent("e")}
           ORDER BY s.start_utc, s.end_utc, s.id LIMIT 1001`,
        )
        .bind(slug),
    ]);

    const row = mapResult?.results[0] as MapRow | undefined;
    if (!row) {
      const up = uploadedResult?.results[0] as UploadedMapRow | undefined;
      if (!up) return null;
      return {
        event: {
          slug: up.slug,
          name: up.name,
          startDate: up.start_date,
          endDate: up.end_date,
          language: up.language,
          timeZone: up.time_zone,
          dayStart: up.day_start,
          ...aboutOf(up),
        },
        map: {
          id: up.event_id,
          theme: up.theme,
          width: up.full_width,
          height: up.full_height,
          imageKey: up.full_key,
          imageFormat: up.format,
          variants: [
            { url: `/media/${up.small_key}`, width: up.small_width },
            { url: `/media/${up.full_key}`, width: up.full_width },
          ].sort((a, b) => a.width - b.width),
        },
        points: ((uploadedPointsResult?.results ?? []) as PointRow[]).map((p) => ({ id: p.id, name: p.name, category: p.category, description: p.description, x: p.x, y: p.y })),
        sessions: this.inWindow(up, (uploadedSessionsResult?.results ?? []) as SessionRow[]),
      };
    }
    const points = (pointsResult?.results ?? []) as PointRow[];
    const sessions = (sessionsResult?.results ?? []) as SessionRow[];

    return {
      event: {
        slug: row.slug,
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        language: row.language,
        timeZone: row.time_zone,
        dayStart: row.day_start,
        ...aboutOf(row),
      },
      map: {
        id: row.map_id,
        theme: row.theme,
        width: row.width,
        height: row.height,
        imageKey: row.image_key,
        imageFormat: row.image_format,
      },
      points: points.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        x: p.x,
        y: p.y,
      })),
      sessions: this.inWindow(row, sessions),
    };
  }
}
