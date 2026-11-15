import { MAX_POINTS_PER_MAP, type Point, type PointCategory } from "@atlas/contract";
import type { PointsDiff } from "../domain/points-diff";
import { sortPoints } from "../domain/map-bundle";

interface PointRow {
  id: string;
  category: PointCategory;
  name: string | null;
  description: string;
  x: number;
  y: number;
}

export const toPoint = (r: PointRow): Point => ({ id: r.id, name: r.name, category: r.category, description: r.description, x: r.x, y: r.y });

/** Kept well under D1's 100 KB statement limit even if a large bound parameter were counted against it. */
export const MAX_JSON_PARAM_BYTES = 60_000;

const encoder = new TextEncoder();

/**
 * Splits items into groups whose JSON array stays under `maxBytes` (UTF-8). A typical save is one group. Every group
 * is its own statement in the same guarded batch (D1 free plan: 50 queries per invocation; the body limit of 512 KB
 * bounds the number of groups to about 9 per operation kind).
 */
export function chunkByJsonBytes<T>(items: readonly T[], maxBytes = MAX_JSON_PARAM_BYTES): T[][] {
  if (items.length === 0) return [];
  if (encoder.encode(JSON.stringify(items)).length <= maxBytes) return [[...items]];
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 2;
  for (const item of items) {
    const n = encoder.encode(JSON.stringify(item)).length + 1;
    if (cur.length > 0 && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(item);
    size += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export interface EditorRead {
  updatedAt: number;
  hasMap: boolean;
  points: Point[];
}

export type SaveOutcome = { ok: true } | { ok: false; reason: "not_found" | "event_changed" };

/**
 * Shared guard of EVERY write statement: the event is this organizer's and still at the version the diff was computed
 * from, the event has exactly the number of Points the diff expects at that point of the batch, and the final size is
 * within the cap. ?1 event, ?4 organizer, ?5 base version, ?6 expected current count, ?7 final count.
 */
const GUARD = `EXISTS (SELECT 1 FROM events g WHERE g.id = ?1 AND g.owner_id = ?4 AND g.updated_at = ?5)
  AND (SELECT count(*) FROM event_points c WHERE c.event_id = ?1) = ?6 AND ?7 <= ${MAX_POINTS_PER_MAP}`;

const FIELDS = (n: string) =>
  `json_extract(${n}.value, '$.id'), json_extract(${n}.value, '$.category'), json_extract(${n}.value, '$.name'), json_extract(${n}.value, '$.description'), json_extract(${n}.value, '$.x'), json_extract(${n}.value, '$.y')`;

const INSERT_SQL = `INSERT INTO event_points (event_id, id, category, name, description, x, y, created_at, updated_at)
  SELECT ?1, ${FIELDS("j")}, ?2, ?2 FROM json_each(?3) j WHERE ${GUARD}`;
const UPDATE_SQL = `UPDATE event_points SET category = json_extract(j.value, '$.category'), name = json_extract(j.value, '$.name'),
  description = json_extract(j.value, '$.description'), x = json_extract(j.value, '$.x'), y = json_extract(j.value, '$.y'), updated_at = ?2
  FROM json_each(?3) j WHERE event_points.event_id = ?1 AND event_points.id = json_extract(j.value, '$.id') AND ${GUARD}`;
const DELETE_SQL = `DELETE FROM event_points WHERE event_id = ?1 AND id IN (SELECT value FROM json_each(?3)) AND ${GUARD}`;
// Last write: the version bump. It still sees the old version in its guard.
const BUMP_SQL = `UPDATE events SET updated_at = ?2 WHERE id = ?1 AND owner_id = ?4 AND updated_at = ?5
  AND (SELECT count(*) FROM event_points c WHERE c.event_id = ?1) = ?6 AND ?7 <= ${MAX_POINTS_PER_MAP}`;
// Last statement: raises (malformed JSON) unless the whole save landed, which rolls the batch back.
const ASSERT_SQL = `SELECT CASE WHEN (SELECT count(*) FROM event_points WHERE event_id = ?1) = ?2
  AND (SELECT updated_at FROM events WHERE id = ?1 AND owner_id = ?3) = ?4 THEN 1 ELSE json('rolled back') END AS ok`;

/** A write changed a different number of rows than the diff said. Thrown (after logging) so the caller answers 500. */
export class ChangesMismatchError extends Error {}

export class D1EventPointsRepository {
  constructor(private readonly db: D1Database) {}

  /** The owner's event version, whether it has a map, and its Points (at most 500). Null: not the caller's event. */
  async readForEditor(eventId: string, ownerId: string): Promise<EditorRead | null> {
    const [ev, pts] = await this.db.batch<{ updated_at: number; has_map: number } | PointRow>([
      this.db
        .prepare(
          `SELECT e.updated_at, EXISTS (SELECT 1 FROM event_map_images m WHERE m.event_id = e.id) AS has_map
           FROM events e WHERE e.id = ?1 AND e.owner_id = ?2`,
        )
        .bind(eventId, ownerId),
      this.db
        .prepare(
          `SELECT p.id, p.category, p.name, p.description, p.x, p.y FROM event_points p
           WHERE p.event_id = ?1 AND EXISTS (SELECT 1 FROM events e WHERE e.id = ?1 AND e.owner_id = ?2) LIMIT ${MAX_POINTS_PER_MAP}`,
        )
        .bind(eventId, ownerId),
    ]);
    const row = ev?.results[0] as { updated_at: number; has_map: number } | undefined;
    if (!row) return null;
    return { updatedAt: row.updated_at, hasMap: row.has_map === 1, points: sortPoints(((pts?.results ?? []) as PointRow[]).map(toPoint)) };
  }

  /** Points of an event for the owner preview and the Admin review (the caller already authorized the event). */
  async listForEvent(eventId: string): Promise<Point[]> {
    const { results } = await this.db
      .prepare(`SELECT id, category, name, description, x, y FROM event_points WHERE event_id = ?1 LIMIT ${MAX_POINTS_PER_MAP}`)
      .bind(eventId)
      .all<PointRow>();
    return sortPoints(results.map(toPoint));
  }

  /**
   * Applies a diff in one `db.batch` (one transaction): deletes, updates, inserts, the version bump, then an assertion
   * that raises unless the whole save landed. Every write carries the shared guard. Rolled back on any failure; a
   * failure is classified by a re-read (gone / not yours -> not_found, version moved -> event_changed). `meta.changes`
   * of each write is checked against the diff sizes and a mismatch is thrown.
   */
  async save(a: { eventId: string; ownerId: string; base: number; now: number; currentCount: number; diff: PointsDiff }): Promise<SaveOutcome> {
    const { eventId, ownerId, base, now, diff } = a;
    const final = diff.finalCount;
    const del = chunkByJsonBytes(diff.toDelete);
    const upd = chunkByJsonBytes(diff.toUpdate);
    const ins = chunkByJsonBytes(diff.toCreate.map((c) => c.point));

    const writes: Array<{ stmt: D1PreparedStatement; expect: number }> = [];
    let count = a.currentCount;
    const add = (sql: string, json: unknown, expect: number, countAfter: number) => {
      writes.push({
        stmt: this.db.prepare(sql).bind(eventId, now, json === null ? null : JSON.stringify(json), ownerId, base, count, final),
        expect,
      });
      count = countAfter;
    };
    for (const g of del) add(DELETE_SQL, g, g.length, count - g.length);
    for (const g of upd) add(UPDATE_SQL, g, g.length, count);
    for (const g of ins) add(INSERT_SQL, g, g.length, count + g.length);
    add(BUMP_SQL, null, 1, count);

    let results: D1Result[];
    try {
      results = await this.db.batch([...writes.map((w) => w.stmt), this.db.prepare(ASSERT_SQL).bind(eventId, final, ownerId, now)]);
    } catch (err) {
      const row = await this.db.prepare(`SELECT updated_at FROM events WHERE id = ?1 AND owner_id = ?2`).bind(eventId, ownerId).first<{ updated_at: number }>();
      if (!row) return { ok: false, reason: "not_found" };
      if (row.updated_at !== base) return { ok: false, reason: "event_changed" };
      throw err;
    }
    if (writes.some((w, i) => results[i]?.meta.changes !== w.expect)) {
      throw new ChangesMismatchError("event_points write changed an unexpected number of rows");
    }
    return { ok: true };
  }
}
