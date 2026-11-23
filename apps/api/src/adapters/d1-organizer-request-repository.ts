import {
  INVITE_EMAIL_DAILY_CAP,
  MAX_PENDING_INVITES,
  type OrganizerLocale,
  type OrganizerRequestSummary,
  type PageLang,
  type OrganizerRequestParsed,
  type OrganizerRequestRow,
  type RequestFilter,
} from "@atlas/contract";

export const GLOBAL_DAILY_CAP = 50;
export const EMAIL_DAILY_CAP = 3;
const DAY_MS = 86_400_000;

export type EmailStatus = OrganizerRequestRow["emailStatus"];
export type InsertResult = { kind: "stored"; id: number } | { kind: "global_cap" } | { kind: "email_cap" };
type StoredStatus = "pending" | "invited" | "discarded";

/** Slice 31 outcomes. `invalid_transition` also covers a lost compare-and-swap. */
export type InviteFromRequestOutcome =
  | "invited"
  | "not_found"
  | "invalid_transition"
  | "email_already_registered"
  | "invite_already_pending"
  | "invite_cap_reached";
export type SimpleTransitionOutcome = "ok" | "not_found" | "invalid_transition";

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
  locale: OrganizerLocale;
  source_ref: string | null;
  page_lang: PageLang | null;
  status: StoredStatus;
  invited_at: number | null;
  invite_id: string | null;
  inv_expires_at: number | null;
  inv_used_at: number | null;
  inv_revoked_at: number | null;
  has_account: number;
}

/** Stored request columns plus the linked invite and the "has an account" fact; `joined` is derived from them. */
const SELECT_ROW = `SELECT r.*, i.expires_at AS inv_expires_at, i.used_at AS inv_used_at, i.revoked_at AS inv_revoked_at,
    EXISTS (SELECT 1 FROM organizers o WHERE o.email = r.email) AS has_account
  FROM organizer_requests r LEFT JOIN invites i ON i.id = r.invite_id`;
const JOINED = `(r.status <> 'discarded' AND (i.used_at IS NOT NULL OR EXISTS (SELECT 1 FROM organizers o WHERE o.email = r.email)))`;
const FILTER_SQL: Record<RequestFilter, string> = {
  pending: `r.status = 'pending' AND NOT ${JOINED}`,
  invited: `r.status = 'invited' AND NOT ${JOINED}`,
  joined: JOINED,
  discarded: `r.status = 'discarded'`,
  all: `1 = 1`,
};
/** SQL for "invite still usable at the time bound to `now`" (a numbered placeholder such as `?4`). */
const activeInvite = (now: string, alias = "") => `${alias}used_at IS NULL AND ${alias}revoked_at IS NULL AND ${alias}expires_at > ${now}`;

function toRow(r: Row, now: number): OrganizerRequestRow {
  const joined = r.status !== "discarded" && (r.inv_used_at !== null || r.has_account === 1);
  const inviteState =
    r.invite_id === null || r.inv_expires_at === null
      ? null
      : r.inv_used_at !== null
        ? "used"
        : r.inv_revoked_at !== null
          ? "revoked"
          : r.inv_expires_at <= now
            ? "expired"
            : "active";
  return {
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
    status: joined ? "joined" : r.status,
    locale: r.locale,
    invitedAt: r.invited_at,
    inviteExpiresAt: r.inv_expires_at,
    inviteState,
    sourceRef: r.source_ref,
    pageLang: r.page_lang,
  };
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
        `INSERT INTO organizer_requests (name, email, event_name, event_date, city, role, message, email_status, created_at, locale, source_ref, page_lang)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?12, ?13, ?14
         WHERE (SELECT COUNT(*) FROM organizer_requests WHERE created_at >= ?9) < ?10
           AND (SELECT COUNT(*) FROM organizer_requests WHERE email = ?2 AND created_at >= ?9) < ?11`,
      )
      .bind(input.name, input.email, input.eventName, input.eventDate ?? null, input.city ?? null, input.role ?? null, input.message ?? null, now, dayStart, GLOBAL_DAILY_CAP, EMAIL_DAILY_CAP, input.locale, input.sourceRef, input.pageLang)
      .run();
    if (res.meta.changes > 0) return { kind: "stored", id: res.meta.last_row_id };
    const total = await this.db.prepare(`SELECT COUNT(*) AS n FROM organizer_requests WHERE created_at >= ?1`).bind(dayStart).first<{ n: number }>();
    return (total?.n ?? 0) >= GLOBAL_DAILY_CAP ? { kind: "global_cap" } : { kind: "email_cap" };
  }

  /** Slice 44: counts per rolling window ending at `now`. Every request counts, whatever its status. */
  async summary(now: number): Promise<OrganizerRequestSummary> {
    const one = async (since: number): Promise<OrganizerRequestSummary["last7d"]> => {
      const [langs, refs] = await this.db.batch([
        this.db.prepare(`SELECT page_lang AS k, COUNT(*) AS n FROM organizer_requests WHERE created_at >= ?1 GROUP BY page_lang`).bind(since),
        this.db
          .prepare(`SELECT source_ref AS k, COUNT(*) AS n FROM organizer_requests WHERE created_at >= ?1 AND source_ref IS NOT NULL GROUP BY source_ref ORDER BY n DESC, k ASC LIMIT 10`)
          .bind(since),
      ]);
      const byLang = { es: 0, ca: 0, en: 0, da: 0, none: 0 };
      let total = 0;
      for (const r of (langs?.results ?? []) as { k: PageLang | null; n: number }[]) {
        byLang[r.k ?? "none"] += r.n;
        total += r.n;
      }
      const top = ((refs?.results ?? []) as { k: string; n: number }[]).map((r) => ({ ref: r.k, count: r.n }));
      const none = (await this.db.prepare(`SELECT COUNT(*) AS n FROM organizer_requests WHERE created_at >= ?1 AND source_ref IS NULL`).bind(since).first<{ n: number }>())?.n ?? 0;
      const other = total - none - top.reduce((a, t) => a + t.count, 0);
      return { total, byLang, byRef: { top, other, none } };
    };
    return { last7d: await one(now - 7 * DAY_MS), last30d: await one(now - 30 * DAY_MS) };
  }

  async setEmailStatus(id: number, status: EmailStatus): Promise<void> {
    await this.db.prepare(`UPDATE organizer_requests SET email_status = ?1 WHERE id = ?2`).bind(status, id).run();
  }

  /** Newest first. `cursor` is the (createdAt, id) of the last row of the previous page. `now` only derives the invite state. */
  async list(
    limit: number,
    filter: RequestFilter,
    now: number,
    cursor?: { createdAt: number; id: number },
  ): Promise<{ requests: OrganizerRequestRow[]; nextCursor: string | null }> {
    const rows = (
      cursor
        ? await this.db
            .prepare(`${SELECT_ROW} WHERE ${FILTER_SQL[filter]} AND (r.created_at < ?1 OR (r.created_at = ?1 AND r.id < ?2)) ORDER BY r.created_at DESC, r.id DESC LIMIT ?3`)
            .bind(cursor.createdAt, cursor.id, limit + 1)
            .all<Row>()
        : await this.db.prepare(`${SELECT_ROW} WHERE ${FILTER_SQL[filter]} ORDER BY r.created_at DESC, r.id DESC LIMIT ?1`).bind(limit + 1).all<Row>()
    ).results;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      requests: page.map((r) => toRow(r, now)),
      nextCursor: rows.length > limit && last ? `${last.created_at}:${last.id}` : null,
    };
  }

  async get(id: number, now: number): Promise<OrganizerRequestRow | null> {
    const r = await this.db.prepare(`${SELECT_ROW} WHERE r.id = ?1`).bind(id).first<Row>();
    return r ? toRow(r, now) : null;
  }

  /** The stored facts an invite needs. Email and locale never change, so reading them before the batch is safe. */
  async inviteTarget(id: number): Promise<{ email: string; locale: OrganizerLocale; status: StoredStatus; inviteId: string | null } | null> {
    const r = await this.db
      .prepare(`SELECT email, locale, status, invite_id FROM organizer_requests WHERE id = ?1`)
      .bind(id)
      .first<{ email: string; locale: OrganizerLocale; status: StoredStatus; invite_id: string | null }>();
    return r ? { email: r.email, locale: r.locale, status: r.status, inviteId: r.invite_id } : null;
  }

  /** Pending -> Discarded. */
  discard(id: number): Promise<SimpleTransitionOutcome> {
    return this.transition(id, "pending", "discarded");
  }

  /** Discarded -> Pending. */
  restore(id: number): Promise<SimpleTransitionOutcome> {
    return this.transition(id, "discarded", "pending");
  }

  private async transition(id: number, from: StoredStatus, to: StoredStatus): Promise<SimpleTransitionOutcome> {
    const res = await this.db.prepare(`UPDATE organizer_requests SET status = ?3 WHERE id = ?1 AND status = ?2`).bind(id, from, to).run();
    if (res.meta.changes === 1) return "ok";
    return (await this.db.prepare(`SELECT 1 AS x FROM organizer_requests WHERE id = ?1`).bind(id).first()) ? "invalid_transition" : "not_found";
  }

  /**
   * Pending -> Invited (`mode: "invite"`) or Invited -> Invited (`"again"`) in one D1 batch with compare-and-swap on the
   * stored status, and on the current invite id for "again". The invite row takes its email from the request row inside SQL.
   * "again" first revokes every active invite for that email. A double-click loser writes nothing (409, no email).
   */
  async inviteFromRequest(i: {
    requestId: number;
    mode: "invite" | "again";
    expectedInviteId: string | null;
    inviteId: string;
    tokenHash: string;
    adminId: string;
    now: number;
    expiresAt: number;
  }): Promise<InviteFromRequestOutcome> {
    const again = i.mode === "again";
    const expectStatus: StoredStatus = again ? "invited" : "pending";
    const stmts: D1PreparedStatement[] = [];
    if (again) {
      // Revoke only when the new invite will fit under the pending cap afterwards, so a revoke never stands alone.
      stmts.push(
        this.db
          .prepare(
            `UPDATE invites SET revoked_at = ?1
             WHERE email = (SELECT r.email FROM organizer_requests r WHERE r.id = ?2 AND r.status = 'invited' AND r.invite_id IS ?3)
               AND ${activeInvite("?1")}
               AND NOT EXISTS (SELECT 1 FROM organizers o WHERE o.email = invites.email)
               AND (SELECT COUNT(*) FROM invites x WHERE ${activeInvite("?1", "x.")} AND x.email <> invites.email) < ?4`,
          )
          .bind(i.now, i.requestId, i.expectedInviteId, MAX_PENDING_INVITES),
      );
    }
    stmts.push(
      this.db
        .prepare(
          `INSERT INTO invites (id, token_hash, email, created_by, created_at, expires_at)
           SELECT ?1, ?2, r.email, ?3, ?4, ?5 FROM organizer_requests r
           WHERE r.id = ?6 AND r.status = ?8 AND r.invite_id IS ?9
             AND (SELECT COUNT(*) FROM invites WHERE ${activeInvite("?4")}) < ?7
             AND NOT EXISTS (SELECT 1 FROM organizers o WHERE o.email = r.email)
             AND NOT EXISTS (SELECT 1 FROM invites WHERE email = r.email AND ${activeInvite("?4")})`,
        )
        .bind(i.inviteId, i.tokenHash, i.adminId, i.now, i.expiresAt, i.requestId, MAX_PENDING_INVITES, expectStatus, again ? i.expectedInviteId : null),
      this.db
        .prepare(
          `UPDATE organizer_requests SET status = 'invited', invited_at = ?1, invite_id = ?2
           WHERE id = ?3 AND status = ?4 AND invite_id IS ?5
             AND EXISTS (SELECT 1 FROM invites WHERE id = ?2)`,
        )
        .bind(i.now, i.inviteId, i.requestId, expectStatus, again ? i.expectedInviteId : null),
    );
    const results = await this.db.batch(stmts);
    const inserted = results[results.length - 2]?.meta.changes === 1;
    const updated = results[results.length - 1]?.meta.changes === 1;
    if (inserted && updated) return "invited";

    // A guard refused, so nothing was written. Say why, most specific first.
    const row = await this.inviteTarget(i.requestId);
    if (!row) return "not_found";
    if (row.status !== expectStatus || (again && row.inviteId !== i.expectedInviteId)) return "invalid_transition";
    if (await this.db.prepare(`SELECT 1 AS x FROM organizers WHERE email = ?1`).bind(row.email).first()) return "email_already_registered";
    if (!again && (await this.db.prepare(`SELECT 1 AS x FROM invites WHERE email = ?1 AND ${activeInvite("?2")}`).bind(row.email, i.now).first())) {
      return "invite_already_pending";
    }
    return "invite_cap_reached";
  }

  /**
   * Reserves one of the 20 invite emails of the UTC day (same conditional INSERT ... SELECT pattern as slice 30), so
   * concurrent invites cannot overshoot. False = at the cap: skip the email.
   */
  async reserveInviteEmail(inviteId: string, now: number): Promise<boolean> {
    const res = await this.db
      .prepare(`INSERT INTO invite_email_log (invite_id, created_at) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM invite_email_log WHERE created_at >= ?3) < ?4`)
      .bind(inviteId, now, utcDayStart(now), INVITE_EMAIL_DAILY_CAP)
      .run();
    return res.meta.changes === 1;
  }
}
