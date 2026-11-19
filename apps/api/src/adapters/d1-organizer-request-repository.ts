import type { OrganizerRequestParsed, OrganizerRequestRow } from "@atlas/contract";

export const GLOBAL_DAILY_CAP = 50;
export const EMAIL_DAILY_CAP = 3;
const DAY_MS = 86_400_000;

export type EmailStatus = OrganizerRequestRow["emailStatus"];
export type InsertResult = { kind: "stored"; id: number } | { kind: "global_cap" } | { kind: "email_cap" };

const utcDayStart = (now: number) => Math.floor(now / DAY_MS) * DAY_MS;

interface Row {
  id: number;
  name: string;
  email: string;
  event_name: string;
  event_date: string | null;
  city: string | null;
  role: string | null;
  message: string | null;
  email_status: EmailStatus;
  created_at: number;
}

export class D1OrganizerRequestRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * One conditional INSERT ... SELECT, so concurrent requests cannot overshoot either daily cap (UTC day).
   * When nothing was inserted, a count tells which cap fired (the global one wins).
   */
  async insertWithCaps(input: OrganizerRequestParsed, now: number): Promise<InsertResult> {
    const dayStart = utcDayStart(now);
    const res = await this.db
      .prepare(
        `INSERT INTO organizer_requests (name, email, event_name, event_date, city, role, message, email_status, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8
         WHERE (SELECT COUNT(*) FROM organizer_requests WHERE created_at >= ?9) < ?10
           AND (SELECT COUNT(*) FROM organizer_requests WHERE email = ?2 AND created_at >= ?9) < ?11`,
      )
      .bind(input.name, input.email, input.eventName, input.eventDate ?? null, input.city ?? null, input.role ?? null, input.message ?? null, now, dayStart, GLOBAL_DAILY_CAP, EMAIL_DAILY_CAP)
      .run();
    if (res.meta.changes > 0) return { kind: "stored", id: res.meta.last_row_id };
    const total = await this.db.prepare(`SELECT COUNT(*) AS n FROM organizer_requests WHERE created_at >= ?1`).bind(dayStart).first<{ n: number }>();
    return (total?.n ?? 0) >= GLOBAL_DAILY_CAP ? { kind: "global_cap" } : { kind: "email_cap" };
  }

  async setEmailStatus(id: number, status: EmailStatus): Promise<void> {
    await this.db.prepare(`UPDATE organizer_requests SET email_status = ?1 WHERE id = ?2`).bind(status, id).run();
  }

  /** Newest first. `cursor` is the (createdAt, id) of the last row of the previous page. */
  async list(limit: number, cursor?: { createdAt: number; id: number }): Promise<{ requests: OrganizerRequestRow[]; nextCursor: string | null }> {
    const rows = (
      cursor
        ? await this.db
            .prepare(`SELECT * FROM organizer_requests WHERE (created_at < ?1 OR (created_at = ?1 AND id < ?2)) ORDER BY created_at DESC, id DESC LIMIT ?3`)
            .bind(cursor.createdAt, cursor.id, limit + 1)
            .all<Row>()
        : await this.db.prepare(`SELECT * FROM organizer_requests ORDER BY created_at DESC, id DESC LIMIT ?1`).bind(limit + 1).all<Row>()
    ).results;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      requests: page.map((r) => ({
        id: String(r.id),
        name: r.name,
        email: r.email,
        eventName: r.event_name,
        eventDate: r.event_date,
        city: r.city,
        role: r.role,
        message: r.message,
        emailStatus: r.email_status,
        createdAt: r.created_at,
      })),
      nextCursor: rows.length > limit && last ? `${last.created_at}:${last.id}` : null,
    };
  }
}
