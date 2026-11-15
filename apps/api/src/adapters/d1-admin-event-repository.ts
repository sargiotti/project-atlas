import type { AdminEventRow } from "@atlas/contract";
import { COLUMNS, FROM, toEvent, type OwnedEvent } from "./d1-panel-event-repository";

interface ListRow {
  id: string;
  slug: string;
  name: string;
  start_date: string;
  end_date: string;
  city: string;
  country: string;
  status: AdminEventRow["status"];
  requested_at: number | null;
  approved_at: number | null;
  updated_at: number;
  org_name: string | null;
  org_email: string | null;
}

const LIST_COLUMNS = `e.id AS id, e.slug AS slug, e.name AS name, e.start_date AS start_date, e.end_date AS end_date,
  e.city AS city, e.country AS country, e.publish_state AS status, e.requested_at AS requested_at,
  e.approved_at AS approved_at, e.updated_at AS updated_at, o.display_name AS org_name, o.email AS org_email`;
const LIST_FROM = `events e LEFT JOIN organizers o ON o.id = e.owner_id`;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const edited = (approvedAt: number | null, updatedAt: number) => approvedAt !== null && updatedAt > approvedAt;
const organizerOf = (name: string | null, email: string | null) => (name !== null && email !== null ? { displayName: name, email } : null);

function toRow(r: ListRow): AdminEventRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    city: r.city,
    country: r.country,
    status: r.status,
    requestedAt: iso(r.requested_at),
    approvedAt: iso(r.approved_at),
    updatedAt: new Date(r.updated_at).toISOString(),
    editedSinceApproval: edited(r.approved_at, r.updated_at),
    organizer: organizerOf(r.org_name, r.org_email),
  };
}

export interface AdminPage {
  events: AdminEventRow[];
  total: number;
  nextCursor: string | null;
}

export interface ReviewedEvent {
  event: OwnedEvent;
  requestedAt: string | null;
  approvedAt: string | null;
  editedSinceApproval: boolean;
  organizer: { displayName: string; email: string } | null;
}

const parseCursor = (cursor: string | undefined): [number, string] | null => {
  if (!cursor) return null;
  const i = cursor.indexOf(":");
  return [Number(cursor.slice(0, i)), cursor.slice(i + 1)];
};

/**
 * Admin reads. Organizer name and email are selected here and only here (never on a public or owner route).
 * Literal state predicates keep the partial indexes usable; every query is bounded by LIMIT.
 */
export class D1AdminEventRepository {
  constructor(private readonly db: D1Database) {}

  /** Oldest request first. Keyset pagination on (requested_at, id). */
  async pending(limit: number, cursor: string | undefined): Promise<AdminPage> {
    const after = parseCursor(cursor);
    const [rows, count] = await this.db.batch<ListRow | { n: number }>([
      this.db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM ${LIST_FROM}
           WHERE e.publish_state = 'in_review' AND (?1 IS NULL OR e.requested_at > ?1 OR (e.requested_at = ?1 AND e.id > ?2))
           ORDER BY e.requested_at, e.id LIMIT ?3`,
        )
        .bind(after?.[0] ?? null, after?.[1] ?? null, limit + 1),
      this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE publish_state = 'in_review'`),
    ]);
    return page(rows!.results as ListRow[], (count!.results[0] as { n: number }).n, limit, (r) => r.requested_at ?? 0);
  }

  /** Last edit first. Keyset pagination on (updated_at DESC, id). */
  async published(limit: number, cursor: string | undefined): Promise<AdminPage> {
    const after = parseCursor(cursor);
    const [rows, count] = await this.db.batch<ListRow | { n: number }>([
      this.db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM ${LIST_FROM}
           WHERE e.publish_state = 'published' AND (?1 IS NULL OR e.updated_at < ?1 OR (e.updated_at = ?1 AND e.id > ?2))
           ORDER BY e.updated_at DESC, e.id LIMIT ?3`,
        )
        .bind(after?.[0] ?? null, after?.[1] ?? null, limit + 1),
      this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE publish_state = 'published'`),
    ]);
    return page(rows!.results as ListRow[], (count!.results[0] as { n: number }).n, limit, (r) => r.updated_at);
  }

  /** An event In review or Published, whoever owns it, with its map and the organizer's contact. */
  async review(id: string): Promise<ReviewedEvent | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS}, o.display_name AS org_name, o.email AS org_email
         FROM ${FROM} LEFT JOIN organizers o ON o.id = e.owner_id
         WHERE e.id = ?1 AND e.publish_state IN ('in_review', 'published')`,
      )
      .bind(id)
      .first<Parameters<typeof toEvent>[0] & { org_name: string | null; org_email: string | null; approved_at: number | null; updated_at: number }>();
    if (!row) return null;
    const event = toEvent(row);
    return {
      event,
      requestedAt: event.requestedAt,
      approvedAt: event.approvedAt,
      editedSinceApproval: edited(row.approved_at, row.updated_at),
      organizer: organizerOf(row.org_name, row.org_email),
    };
  }
}

function page(rows: ListRow[], total: number, limit: number, key: (r: ListRow) => number): AdminPage {
  const more = rows.length > limit;
  const shown = more ? rows.slice(0, limit) : rows;
  const last = shown[shown.length - 1];
  return { events: shown.map(toRow), total, nextCursor: more && last ? `${key(last)}:${last.id}` : null };
}
