import { DAILY_TRANSITION_CAP } from "@atlas/contract";
import type { EventStatus } from "@atlas/contract";
import type { PublicationPort, StoredForTransition, TransitionCommand } from "../application/publication";
import type { PublishAction, RefusalFacts } from "../domain/publication";
import { utcDay } from "./d1-map-image-repository";

interface ReadRow {
  publish_state: EventStatus;
  updated_at: number;
  has_map: number;
  has_points: number;
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
}

/** What each action writes besides `publish_state`. Constants only; every value is bound. */
const SETS: Record<PublishAction, { sql: string; binds: (c: TransitionCommand) => unknown[] }> = {
  request: { sql: "requested_at = ?, approved_at = NULL, status_reason = NULL", binds: (c) => [c.now] },
  withdraw: { sql: "requested_at = NULL, approved_at = NULL, status_reason = NULL", binds: () => [] },
  unpublish: { sql: "requested_at = NULL, approved_at = NULL, status_reason = NULL", binds: () => [] },
  approve: { sql: "approved_at = ?, status_reason = NULL", binds: (c) => [c.now] },
  reject: { sql: "status_reason = ?", binds: (c) => [c.reason] },
  admin_unpublish: { sql: "approved_at = NULL, status_reason = ?", binds: (c) => [c.reason] },
};

const HAS_MAP = "EXISTS (SELECT 1 FROM event_map_images m WHERE m.event_id = e.id)";
const HAS_POINTS = "EXISTS (SELECT 1 FROM event_points p WHERE p.event_id = e.id)";

/**
 * Publish-flow storage. Each transition is a `db.batch` of ONE conditional UPDATE plus the audit row (and the
 * daily-quota tick for organizers), both guarded by `changes() = 1`: they exist only when the UPDATE won, and they
 * commit or roll back with it.
 */
export class D1PublicationRepository implements PublicationPort {
  constructor(private readonly db: D1Database) {}

  async readForTransition(eventId: string, ownerScope: string | null): Promise<StoredForTransition | null> {
    const row = await this.db
      .prepare(
        `SELECT e.publish_state, e.updated_at, ${HAS_MAP} AS has_map, ${HAS_POINTS} AS has_points, e.name, e.start_date, e.end_date, e.time_zone,
                e.city, e.country, e.language, e.description, e.website, e.venue_address
         FROM events e WHERE e.id = ?1 AND (?2 IS NULL OR e.owner_id = ?2)`,
      )
      .bind(eventId, ownerScope)
      .first<ReadRow>();
    if (!row) return null;
    return {
      state: row.publish_state,
      updatedAt: row.updated_at,
      hasMap: row.has_map === 1,
      hasPoints: row.has_points === 1,
      fields: {
        name: row.name,
        startDate: row.start_date,
        endDate: row.end_date,
        timeZone: row.time_zone,
        city: row.city,
        country: row.country,
        language: row.language,
        description: row.description,
        website: row.website,
        venueAddress: row.venue_address,
      },
    };
  }

  async apply(c: TransitionCommand, from: EventStatus, guardUpdatedAt: number | null): Promise<boolean> {
    const { rule } = c;
    const organizer = rule.actor === "organizer";
    const day = utcDay(c.now);

    const where = ["e.id = ?", "e.publish_state = ?"];
    const whereBinds: unknown[] = [c.eventId, from];
    // Ownership is part of the statement: someone else's event is "no row", like a missing one.
    if (c.ownerScope !== null) {
      where.push("e.owner_id = ?");
      whereBinds.push(c.ownerScope);
    }
    if (guardUpdatedAt !== null) {
      where.push("e.updated_at = ?");
      whereBinds.push(guardUpdatedAt);
    }
    if (rule.needsMap) where.push(HAS_MAP);
    if (rule.needsPoints) where.push(HAS_POINTS);
    if (organizer) {
      where.push("COALESCE((SELECT q.count FROM transition_quota q WHERE q.organizer_id = ? AND q.day = ?), 0) < ?");
      whereBinds.push(c.actorId, day, DAILY_TRANSITION_CAP);
    }

    const set = SETS[rule.action];
    const statements = [
      // The alias lets the map subquery refer to the row being updated.
      this.db
        .prepare(`UPDATE events AS e SET publish_state = ?, ${set.sql} WHERE ${where.join(" AND ")}`)
        .bind(rule.to, ...set.binds(c), ...whereBinds),
      this.db
        .prepare(
          `INSERT INTO moderation_audit (event_id, actor_id, actor_role, action, from_state, to_state, reason, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
        )
        .bind(c.eventId, c.actorId, rule.actor, rule.action, from, rule.to, c.reason, c.now),
    ];
    if (organizer) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO transition_quota (organizer_id, day, count) SELECT ?, ?, 1 WHERE changes() = 1
             ON CONFLICT(organizer_id, day) DO UPDATE SET count = count + 1`,
          )
          .bind(c.actorId, day),
      );
    }
    const results = await this.db.batch(statements);
    return results[0]?.meta.changes === 1;
  }

  async refusalFacts(eventId: string, ownerScope: string | null, organizerId: string, now: number): Promise<RefusalFacts | null> {
    const row = await this.db
      .prepare(
        `SELECT e.publish_state, e.updated_at, ${HAS_MAP} AS has_map, ${HAS_POINTS} AS has_points,
                COALESCE((SELECT q.count FROM transition_quota q WHERE q.organizer_id = ?3 AND q.day = ?4), 0) AS used
         FROM events e WHERE e.id = ?1 AND (?2 IS NULL OR e.owner_id = ?2)`,
      )
      .bind(eventId, ownerScope, organizerId, utcDay(now))
      .first<{ publish_state: EventStatus; updated_at: number; has_map: number; has_points: number; used: number }>();
    if (!row) return null;
    return { state: row.publish_state, updatedAt: row.updated_at, hasMap: row.has_map === 1, hasPoints: row.has_points === 1, usedToday: row.used };
  }

  /** Events waiting for the Admin. Literal predicate so the partial index idx_events_pending applies. */
  async pendingCount(): Promise<number> {
    const row = await this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE publish_state = 'in_review'`).first<{ n: number }>();
    return row?.n ?? 0;
  }
}
