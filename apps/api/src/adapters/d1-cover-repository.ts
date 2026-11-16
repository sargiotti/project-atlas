import { coverImageSchema, type CoverImage, type EventStatus, type PanelCover } from "@atlas/contract";
import { mediaUrl, type MediaLookup } from "./d1-map-image-repository";

export interface StoredCover {
  fullKey: string;
  fullWidth: number;
  fullHeight: number;
  smallKey: string;
  smallWidth: number;
  smallHeight: number;
  ogKey: string;
  focalX: number;
  focalY: number;
  updatedAt: number;
}

/** Columns of `event_covers` aliased with a `cover_` prefix, for LEFT JOINs (`c` is the table alias). */
export const COVER_JOIN_COLUMNS = `c.full_key AS cover_full_key, c.full_width AS cover_full_width, c.full_height AS cover_full_height,
  c.small_key AS cover_small_key, c.small_width AS cover_small_width, c.small_height AS cover_small_height,
  c.og_key AS cover_og_key, c.focal_x AS cover_focal_x, c.focal_y AS cover_focal_y, c.updated_at AS cover_updated_at`;

export interface CoverJoinRow {
  cover_full_key: string | null;
  cover_full_width: number | null;
  cover_full_height: number | null;
  cover_small_key: string | null;
  cover_small_width: number | null;
  cover_small_height: number | null;
  cover_og_key: string | null;
  cover_focal_x: number | null;
  cover_focal_y: number | null;
  cover_updated_at: number | null;
}

export function storedCoverFromJoin(r: CoverJoinRow): StoredCover | null {
  if (r.cover_full_key === null) return null;
  return {
    fullKey: r.cover_full_key,
    fullWidth: r.cover_full_width!,
    fullHeight: r.cover_full_height!,
    smallKey: r.cover_small_key!,
    smallWidth: r.cover_small_width!,
    smallHeight: r.cover_small_height!,
    ogKey: r.cover_og_key!,
    focalX: r.cover_focal_x!,
    focalY: r.cover_focal_y!,
    updatedAt: r.cover_updated_at!,
  };
}

/** The random token of a key `covers/{eventId}/{hex32}-{kind}`. */
export const coverToken = (key: string): string => key.split("/")[2]?.slice(0, 32) ?? "";

/**
 * Public shape. Null when a stored key would not satisfy the public URL rules (a poisoned row must never take the Home
 * list or a bundle down: the event simply shows its colour cover).
 */
export function toPublicCover(c: StoredCover): CoverImage | null {
  const parsed = coverImageSchema.safeParse({
    url: mediaUrl(c.fullKey),
    url800: mediaUrl(c.smallKey),
    width: c.fullWidth,
    height: c.fullHeight,
    focal: { x: c.focalX, y: c.focalY },
  });
  return parsed.success ? parsed.data : null;
}

export function toPanelCover(c: StoredCover): PanelCover | null {
  const pub = toPublicCover(c);
  return pub ? { ...pub, version: coverToken(c.fullKey), updatedAt: new Date(c.updatedAt).toISOString() } : null;
}

export interface CoverMediaLookup extends Omit<MediaLookup, "keys"> {
  /** The three keys currently referenced by the event. */
  keys: string[];
}

export interface NewCover {
  fullKey: string;
  fullWidth: number;
  fullHeight: number;
  smallKey: string;
  smallWidth: number;
  smallHeight: number;
  ogKey: string;
  focalX: number;
  focalY: number;
}

/** Ownership is part of every statement, as in the other panel repositories: not yours = no row = no change. */
export class D1CoverRepository {
  constructor(private readonly db: D1Database) {}

  async get(eventId: string): Promise<StoredCover | null> {
    const row = await this.db
      .prepare(`SELECT ${COVER_JOIN_COLUMNS} FROM event_covers c WHERE c.event_id = ?1`)
      .bind(eventId)
      .first<CoverJoinRow>();
    return row ? storedCoverFromJoin(row) : null;
  }

  /**
   * Points the event at the new objects, guarded by ownership and a compare-and-swap on the previous `full_key` and
   * `og_key` (both NULL: first upload), in any status. The same batch bumps `events.updated_at` strictly forward (the
   * Admin approval is version-guarded on it). False when the guard fails: not the owner, the event is gone, or a
   * concurrent request changed the cover since `previous` was read.
   */
  async switchTo(eventId: string, ownerId: string, c: NewCover, now: number, previous: { fullKey: string; ogKey: string } | null): Promise<boolean> {
    const [res] = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO event_covers (event_id, full_key, full_width, full_height, small_key, small_width, small_height, og_key,
                                     focal_x, focal_y, created_at, updated_at)
           SELECT ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
           WHERE EXISTS (SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2)
           ON CONFLICT(event_id) DO UPDATE SET full_key = excluded.full_key, full_width = excluded.full_width,
             full_height = excluded.full_height, small_key = excluded.small_key, small_width = excluded.small_width,
             small_height = excluded.small_height, og_key = excluded.og_key, focal_x = excluded.focal_x,
             focal_y = excluded.focal_y, updated_at = excluded.updated_at
           WHERE event_covers.full_key IS ?13 AND event_covers.og_key IS ?14`,
        )
        .bind(eventId, ownerId, c.fullKey, c.fullWidth, c.fullHeight, c.smallKey, c.smallWidth, c.smallHeight, c.ogKey, c.focalX, c.focalY, now, previous?.fullKey ?? null, previous?.ogKey ?? null),
      this.bumpEvent(eventId, now),
    ]);
    return res?.meta.changes === 1;
  }

  /**
   * Focal-only change: new link-preview object and focal point, guarded by ownership, the full file's key (the
   * `baseVersion` the client edited) and the previous og key. Same `updated_at` bump.
   */
  async refocus(eventId: string, ownerId: string, args: { fullKey: string; previousOgKey: string; ogKey: string; focalX: number; focalY: number }, now: number): Promise<boolean> {
    const [res] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE event_covers SET og_key = ?3, focal_x = ?4, focal_y = ?5, updated_at = ?6
           WHERE event_id = ?1 AND EXISTS (SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2)
             AND full_key = ?7 AND og_key = ?8`,
        )
        .bind(eventId, ownerId, args.ogKey, args.focalX, args.focalY, now, args.fullKey, args.previousOgKey),
      this.bumpEvent(eventId, now),
    ]);
    return res?.meta.changes === 1;
  }

  /** Clears the row (owner-guarded) and bumps `events.updated_at` in one batch. False when there was no cover to remove. */
  async remove(eventId: string, ownerId: string, now: number): Promise<boolean> {
    const [res] = await this.db.batch([
      this.db
        .prepare(`DELETE FROM event_covers WHERE event_id = ?1 AND EXISTS (SELECT 1 FROM events WHERE id = ?1 AND owner_id = ?2)`)
        .bind(eventId, ownerId),
      this.bumpEvent(eventId, now),
    ]);
    return res?.meta.changes === 1;
  }

  /** Strictly forward (`max(now, old + 1)`), only when the statement before it changed a row. */
  private bumpEvent(eventId: string, now: number) {
    return this.db.prepare(`UPDATE events SET updated_at = MAX(?2, updated_at + 1) WHERE id = ?1 AND changes() = 1`).bind(eventId, now);
  }

  /**
   * Single D1 read for serving: the publish state, whether the optional session belongs to the event's owner or to an
   * Admin, and the three keys it references. Null when the event has no cover. `sessionHash` null means anonymous.
   */
  async lookupForMedia(eventId: string, sessionHash: string | null, now: number): Promise<CoverMediaLookup | null> {
    const row = await this.db
      .prepare(
        `SELECT e.publish_state AS status, c.full_key AS full_key, c.small_key AS small_key, c.og_key AS og_key,
                (e.owner_id IS NOT NULL AND e.owner_id = v.organizer_id) AS is_owner,
                (v.role = 'admin') AS is_admin
         FROM events e JOIN event_covers c ON c.event_id = e.id
         LEFT JOIN (SELECT s.organizer_id AS organizer_id, o.role AS role FROM sessions s JOIN organizers o ON o.id = s.organizer_id
                    WHERE s.token_hash = ?2 AND s.expires_at > ?3) v ON 1 = 1
         WHERE e.id = ?1`,
      )
      .bind(eventId, sessionHash, now)
      .first<{ status: EventStatus; full_key: string; small_key: string; og_key: string; is_owner: number | null; is_admin: number | null }>();
    if (!row) return null;
    return { status: row.status, viewerIsOwner: row.is_owner === 1, viewerIsAdmin: row.is_admin === 1, keys: [row.full_key, row.small_key, row.og_key] };
  }
}
