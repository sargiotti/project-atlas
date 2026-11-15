import { MAX_POINTS_PER_MAP, MAX_SESSIONS_PER_EVENT, type Point, type PointCategory, type Session } from "@atlas/contract";
import { sortPoints, sortSessions } from "../domain/map-bundle";
import type { SessionsPlan } from "../domain/sessions-plan";
import { ChangesMismatchError, chunkByJsonBytes, toPoint } from "./d1-event-points-repository";

interface SessionRow {
  id: string;
  point_id: string;
  title: string;
  description: string | null;
  start_utc: string;
  end_utc: string;
}

export const toSession = (r: SessionRow): Session => ({
  id: r.id,
  pointId: r.point_id,
  title: r.title,
  start: r.start_utc,
  end: r.end_utc,
  // Optional in the contract: omitted when there is no text.
  ...(r.description ? { description: r.description } : {}),
});

export interface SessionsEditorRead {
  updatedAt: number;
  startDate: string;
  endDate: string;
  timeZone: string;
  dayStart: string;
  /** Every Point of the event (the caller filters the editable ones). */
  points: Point[];
  /** Sorted by start, end, id. At most 1001 rows are read, so an overflow is visible. */
  sessions: Session[];
}

export type SessionsSaveOutcome = { ok: true } | { ok: false; reason: "not_found" | "event_changed" };

/**
 * Shared guard of EVERY write statement: the event is this organizer's and still at the version the plan was computed
 * from, the event has exactly the number of Sessions the plan expects at that point of the batch, and the final size is
 * within the cap. ?1 event, ?4 organizer, ?5 base version, ?6 expected current count, ?7 final count.
 */
const GUARD = `EXISTS (SELECT 1 FROM events g WHERE g.id = ?1 AND g.owner_id = ?4 AND g.updated_at = ?5)
  AND (SELECT count(*) FROM event_point_sessions c WHERE c.event_id = ?1) = ?6 AND ?7 <= ${MAX_SESSIONS_PER_EVENT}`;

const F = (n: string, key: string) => `json_extract(${n}.value, '$.${key}')`;
// The Point must be a stage or landmark Point of THIS event (inner join): category is enforced in the write itself.
const POINT_OK = (n: string) =>
  `p.event_id = ?1 AND p.id = ${F(n, "pointId")} AND p.category IN ('stage', 'landmark')`;

const INSERT_SQL = `INSERT INTO event_point_sessions (id, event_id, point_id, title, description, start_utc, end_utc, created_at, updated_at)
  SELECT ${F("j", "id")}, ?1, ${F("j", "pointId")}, ${F("j", "title")}, ${F("j", "description")}, ${F("j", "start")}, ${F("j", "end")}, ?2, ?2
  FROM json_each(?3) j JOIN event_points p ON ${POINT_OK("j")} WHERE ${GUARD}`;
const UPDATE_SQL = `UPDATE event_point_sessions SET point_id = ${F("j", "pointId")}, title = ${F("j", "title")}, description = ${F("j", "description")},
  start_utc = ${F("j", "start")}, end_utc = ${F("j", "end")}, updated_at = ?2
  FROM json_each(?3) j
  WHERE event_point_sessions.event_id = ?1 AND event_point_sessions.id = ${F("j", "id")}
  AND EXISTS (SELECT 1 FROM event_points p WHERE ${POINT_OK("j")}) AND ${GUARD}`;
const DELETE_SQL = `DELETE FROM event_point_sessions WHERE event_id = ?1 AND id IN (SELECT value FROM json_each(?3)) AND ${GUARD}`;
// Last write: the version bump. It still sees the old version in its guard.
const BUMP_SQL = `UPDATE events SET updated_at = ?2 WHERE id = ?1 AND owner_id = ?4 AND updated_at = ?5
  AND (SELECT count(*) FROM event_point_sessions c WHERE c.event_id = ?1) = ?6 AND ?7 <= ${MAX_SESSIONS_PER_EVENT}`;
// Last statement: raises (malformed JSON) unless the whole save landed, which rolls the batch back. `changes() = 1` is the
// bump (the last write): it proves THIS batch's bump applied. The self-join proves no two Sessions of one Point overlap
// (half-open: touching is fine); `a.id < b.id` reports each pair once, and the index (event_id, point_id, start_utc...) serves it.
const ASSERT_SQL = `SELECT CASE WHEN changes() = 1
  AND (SELECT count(*) FROM event_point_sessions WHERE event_id = ?1) = ?2
  AND (SELECT updated_at FROM events WHERE id = ?1 AND owner_id = ?3) = ?4
  AND NOT EXISTS (SELECT 1 FROM event_point_sessions a JOIN event_point_sessions b
    ON b.event_id = a.event_id AND b.point_id = a.point_id AND a.id < b.id AND a.start_utc < b.end_utc AND b.start_utc < a.end_utc
    WHERE a.event_id = ?1)
  THEN 1 ELSE json('rolled back') END AS ok`;

const toWire = (s: Session) => ({ id: s.id, pointId: s.pointId, title: s.title, description: s.description ?? null, start: s.start, end: s.end });

export class D1EventSessionsRepository {
  constructor(private readonly db: D1Database) {}

  /** The owner's event (version, dates, zone), its Points (at most 500) and Sessions (at most 1001). Null: not the caller's event. */
  async readForEditor(eventId: string, ownerId: string): Promise<SessionsEditorRead | null> {
    const own = `EXISTS (SELECT 1 FROM events e WHERE e.id = ?1 AND e.owner_id = ?2)`;
    const [ev, pts, sess] = await this.db.batch<
      | { updated_at: number; start_date: string; end_date: string; time_zone: string; day_start: string }
      | { id: string; category: PointCategory; name: string | null; description: string; x: number; y: number }
      | SessionRow
    >([
      this.db
        .prepare(`SELECT e.updated_at, e.start_date, e.end_date, e.time_zone, e.day_start FROM events e WHERE e.id = ?1 AND e.owner_id = ?2`)
        .bind(eventId, ownerId),
      this.db
        .prepare(`SELECT p.id, p.category, p.name, p.description, p.x, p.y FROM event_points p WHERE p.event_id = ?1 AND ${own} LIMIT ${MAX_POINTS_PER_MAP}`)
        .bind(eventId, ownerId),
      this.db
        .prepare(
          `SELECT s.id, s.point_id, s.title, s.description, s.start_utc, s.end_utc FROM event_point_sessions s
           WHERE s.event_id = ?1 AND ${own} ORDER BY s.start_utc, s.end_utc, s.id LIMIT ${MAX_SESSIONS_PER_EVENT + 1}`,
        )
        .bind(eventId, ownerId),
    ]);
    const row = ev?.results[0] as { updated_at: number; start_date: string; end_date: string; time_zone: string; day_start: string } | undefined;
    if (!row) return null;
    return {
      updatedAt: row.updated_at,
      startDate: row.start_date,
      endDate: row.end_date,
      timeZone: row.time_zone,
      dayStart: row.day_start,
      points: sortPoints(((pts?.results ?? []) as Parameters<typeof toPoint>[0][]).map(toPoint)),
      sessions: ((sess?.results ?? []) as SessionRow[]).map(toSession),
    };
  }

  /** Sessions of an event for the owner preview and the Admin review (the caller already authorized the event). */
  async listForEvent(eventId: string): Promise<Session[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, point_id, title, description, start_utc, end_utc FROM event_point_sessions WHERE event_id = ?1
         ORDER BY start_utc, end_utc, id LIMIT ${MAX_SESSIONS_PER_EVENT}`,
      )
      .bind(eventId)
      .all<SessionRow>();
    return sortSessions(results.map(toSession));
  }

  /**
   * Applies a plan in one `db.batch` (one transaction): deletes, updates, inserts, the version bump, then an assertion
   * that raises unless the whole save landed and no Sessions overlap. Every write carries the shared guard; inserts and
   * updates also join the Point and require a stage or landmark. A failure is classified by a re-read (gone / not yours
   * -> not_found, version moved -> event_changed). `meta.changes` of each write is checked against the plan sizes.
   */
  async save(a: { eventId: string; ownerId: string; base: number; now: number; currentCount: number; plan: SessionsPlan }): Promise<SessionsSaveOutcome> {
    const { eventId, ownerId, base, now, plan } = a;
    const final = plan.finalCount;
    const del = chunkByJsonBytes(plan.toDelete);
    const upd = chunkByJsonBytes(plan.toUpdate.map(toWire));
    const ins = chunkByJsonBytes(plan.toCreate.map((c) => toWire(c.session)));

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
    // NOTE: this 500 happens AFTER the batch committed (the in-batch ASSERT_SQL is what rolls a bad save back).
    if (writes.some((w, i) => results[i]?.meta.changes !== w.expect)) {
      throw new ChangesMismatchError("event_point_sessions write changed an unexpected number of rows");
    }
    return { ok: true };
  }
}
