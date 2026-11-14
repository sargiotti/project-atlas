import type { MapTheme, PanelMap } from "@atlas/contract";

/** Daily map upload cap per organizer (UTC day). The real limit: the Workers rate limiter is approximate and fails open. */
export const DAILY_UPLOAD_LIMIT = 30;

export interface StoredMapImage {
  theme: MapTheme;
  format: "webp" | "jpeg";
  fullKey: string;
  fullWidth: number;
  fullHeight: number;
  smallKey: string;
  smallWidth: number;
  smallHeight: number;
  updatedAt: number;
}

/** Columns of `event_map_images` aliased with a `map_` prefix, for LEFT JOINs. */
export const MAP_JOIN_COLUMNS = `m.theme AS map_theme, m.format AS map_format, m.full_key AS map_full_key,
  m.full_width AS map_full_width, m.full_height AS map_full_height, m.small_key AS map_small_key,
  m.small_width AS map_small_width, m.small_height AS map_small_height, m.updated_at AS map_updated_at`;

export interface MapJoinRow {
  map_theme: MapTheme | null;
  map_format: "webp" | "jpeg" | null;
  map_full_key: string | null;
  map_full_width: number | null;
  map_full_height: number | null;
  map_small_key: string | null;
  map_small_width: number | null;
  map_small_height: number | null;
  map_updated_at: number | null;
}

export function storedMapFromJoin(r: MapJoinRow): StoredMapImage | null {
  if (r.map_theme === null) return null;
  return {
    theme: r.map_theme,
    format: r.map_format!,
    fullKey: r.map_full_key!,
    fullWidth: r.map_full_width!,
    fullHeight: r.map_full_height!,
    smallKey: r.map_small_key!,
    smallWidth: r.map_small_width!,
    smallHeight: r.map_small_height!,
    updatedAt: r.map_updated_at!,
  };
}

/** Public path of a stored object key (`maps/{eventId}/{file}` -> `/media/maps/{eventId}/{file}`). */
export const mediaUrl = (key: string): string => `/media/${key}`;

export function toPanelMap(m: StoredMapImage): PanelMap {
  return {
    theme: m.theme,
    format: m.format,
    full: { url: mediaUrl(m.fullKey), width: m.fullWidth, height: m.fullHeight },
    small: { url: mediaUrl(m.smallKey), width: m.smallWidth, height: m.smallHeight },
    updatedAt: new Date(m.updatedAt).toISOString(),
  };
}

export interface MediaLookup {
  status: "draft" | "published";
  /** True when the (optional) session cookie belongs to the event's owner. */
  viewerIsOwner: boolean;
  /** The one key pair currently referenced by the event. */
  keys: [string, string];
}

/** Ownership is part of every statement, as in the panel repository: not yours = no row = no change. */
export class D1MapImageRepository {
  constructor(private readonly db: D1Database) {}

  /** Status of an event the organizer owns, or null (missing, someone else's, or a demo event). */
  async ownedStatus(eventId: string, ownerId: string): Promise<"draft" | "published" | null> {
    const row = await this.db
      .prepare(`SELECT status FROM events WHERE id = ?1 AND owner_id = ?2`)
      .bind(eventId, ownerId)
      .first<{ status: "draft" | "published" }>();
    return row?.status ?? null;
  }

  async get(eventId: string): Promise<StoredMapImage | null> {
    const row = await this.db
      .prepare(`SELECT ${MAP_JOIN_COLUMNS} FROM event_map_images m WHERE m.event_id = ?1`)
      .bind(eventId)
      .first<MapJoinRow>();
    return row ? storedMapFromJoin(row) : null;
  }

  /**
   * Atomically takes one upload from today's quota. One statement: the row is created or incremented only while
   * count < limit; `changes = 0` means the cap is reached. Rows older than 2 days are pruned opportunistically.
   */
  async claimUpload(organizerId: string, now: number): Promise<boolean> {
    const day = utcDay(now);
    const res = await this.db
      .prepare(
        `INSERT INTO upload_quota (organizer_id, day, count) VALUES (?1, ?2, 1)
         ON CONFLICT(organizer_id, day) DO UPDATE SET count = count + 1 WHERE count < ?3`,
      )
      .bind(organizerId, day, DAILY_UPLOAD_LIMIT)
      .run();
    if (res.meta.changes === 0) return false;
    await this.db
      .prepare(`DELETE FROM upload_quota WHERE organizer_id = ?1 AND day < ?2`)
      .bind(organizerId, utcDay(now - 2 * 86_400_000))
      .run();
    return true;
  }

  /**
   * Points the event at the new objects, in one statement guarded by owner + draft and compare-and-swap on the
   * previous full key (`null` = first upload). Returns false when the guard fails (the event stopped being an owned
   * draft) or when another request changed the map since `previousFullKey` was read (a row appeared, or its key moved).
   */
  async switchTo(
    eventId: string,
    ownerId: string,
    m: Omit<StoredMapImage, "updatedAt">,
    now: number,
    previousFullKey: string | null,
  ): Promise<boolean> {
    const res = await this.db
      .prepare(
        `INSERT INTO event_map_images (event_id, theme, format, full_key, full_width, full_height,
                                       small_key, small_width, small_height, created_at, updated_at)
         SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
         WHERE EXISTS (SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2 AND status = 'draft')
         ON CONFLICT(event_id) DO UPDATE SET theme = excluded.theme, format = excluded.format,
           full_key = excluded.full_key, full_width = excluded.full_width, full_height = excluded.full_height,
           small_key = excluded.small_key, small_width = excluded.small_width, small_height = excluded.small_height,
           updated_at = excluded.updated_at
         WHERE event_map_images.full_key IS ?12`,
      )
      .bind(eventId, ownerId, m.theme, m.format, m.fullKey, m.fullWidth, m.fullHeight, m.smallKey, m.smallWidth, m.smallHeight, now, previousFullKey)
      .run();
    return res.meta.changes === 1;
  }

  /** Theme override. False when there is no map or the event is not an owned draft. */
  async setTheme(eventId: string, ownerId: string, theme: MapTheme, now: number): Promise<boolean> {
    const res = await this.db
      .prepare(
        `UPDATE event_map_images SET theme = ?3, updated_at = ?4
         WHERE event_id = ?1 AND EXISTS (SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2 AND status = 'draft')`,
      )
      .bind(eventId, ownerId, theme, now)
      .run();
    return res.meta.changes === 1;
  }

  /**
   * Single D1 read for serving: the event status, whether the optional session belongs to its owner, and the
   * key pair it references. Null when the event has no map. `sessionHash` null means anonymous.
   */
  async lookupForMedia(eventId: string, sessionHash: string | null, now: number): Promise<MediaLookup | null> {
    const row = await this.db
      .prepare(
        `SELECT e.status AS status, m.full_key AS full_key, m.small_key AS small_key,
                (e.owner_id IS NOT NULL AND e.owner_id = (SELECT organizer_id FROM sessions WHERE token_hash = ?2 AND expires_at > ?3)) AS is_owner
         FROM events e JOIN event_map_images m ON m.event_id = e.id WHERE e.id = ?1`,
      )
      .bind(eventId, sessionHash, now)
      .first<{ status: "draft" | "published"; full_key: string; small_key: string; is_owner: number | null }>();
    if (!row) return null;
    return { status: row.status, viewerIsOwner: row.is_owner === 1, keys: [row.full_key, row.small_key] };
  }
}

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
