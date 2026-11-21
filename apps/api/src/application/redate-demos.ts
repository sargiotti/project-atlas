import { DEMO_SLUGS, demoShiftDays, shiftUtcInstant } from "../domain/demo-dates";
import { addDays } from "@atlas/contract";

/**
 * Slice 39, daily cron: moves the demo events (hard-coded slugs, no owner) and their Sessions so they are never
 * over. Idempotent: a demo already on its target date is left alone. One D1 batch. Returns the number of events moved.
 */
export async function redateDemos(db: D1Database, nowMs: number): Promise<number> {
  const marks = DEMO_SLUGS.map((_, i) => `?${i + 1}`).join(",");
  const { results: events } = await db
    .prepare(`SELECT id, slug, start_date, end_date, time_zone FROM events WHERE owner_id IS NULL AND slug IN (${marks})`)
    .bind(...DEMO_SLUGS)
    .all<{ id: string; slug: string; start_date: string; end_date: string; time_zone: string }>();
  const moves = events
    .map((e) => ({ e, days: demoShiftDays(e.slug, e.start_date, e.time_zone, nowMs) }))
    .filter((m) => m.days !== 0);
  if (moves.length === 0) return 0;

  const ids = moves.map((m) => m.e.id);
  const { results: sessions } = await db
    .prepare(`SELECT id, event_id, start_utc, end_utc FROM point_sessions WHERE event_id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`)
    .bind(...ids)
    .all<{ id: string; event_id: string; start_utc: string; end_utc: string }>();
  const byId = new Map(moves.map((m) => [m.e.id, m]));

  const statements = [
    ...moves.map(({ e, days }) =>
      db
        .prepare(`UPDATE events SET start_date = ?1, end_date = ?2, updated_at = ?3 WHERE id = ?4 AND owner_id IS NULL`)
        .bind(addDays(e.start_date, days), addDays(e.end_date, days), nowMs, e.id),
    ),
    ...sessions.map((s) => {
      const { e, days } = byId.get(s.event_id)!;
      return db
        .prepare(`UPDATE point_sessions SET start_utc = ?1, end_utc = ?2, updated_at = ?3 WHERE id = ?4`)
        .bind(shiftUtcInstant(s.start_utc, days, e.time_zone), shiftUtcInstant(s.end_utc, days, e.time_zone), nowMs, s.id);
    }),
  ];
  await db.batch(statements);
  return moves.length;
}
