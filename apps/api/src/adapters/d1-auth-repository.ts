import { MAX_PENDING_INVITES, type Role } from "@atlas/contract";
import { INVITE_RETENTION_MS, type InviteState } from "../domain/auth";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface StoredInvite extends InviteState {
  id: string;
  inviterName: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

export type CreateInviteOutcome = "created" | "email_already_registered" | "invite_already_pending" | "invite_cap_reached";

interface NewAccount {
  organizerId: string;
  googleSub: string;
  email: string;
  displayName: string;
  now: number;
  sessionHash: string;
  sessionExpiresAt: number;
}

/** D1 access for accounts, invites and sessions. Only token hashes are ever passed in. */
export class D1AuthRepository {
  constructor(private readonly db: D1Database) {}

  // --- accounts -------------------------------------------------------------------------------

  async findOrganizerIdBySub(sub: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT id FROM organizers WHERE google_sub = ?1").bind(sub).first<{ id: string }>();
    return row?.id ?? null;
  }

  /** First Admin: organizer + session in one batch. Throws on a unique violation (concurrent first sign-in). */
  async createAdminWithSession(a: NewAccount): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, 'admin', ?5)",
        )
        .bind(a.organizerId, a.googleSub, a.email, a.displayName, a.now),
      this.insertSession(a.sessionHash, a.organizerId, a.now, a.sessionExpiresAt),
      this.pruneExpiredSessions(a.now),
    ]);
  }

  /**
   * Single-use acceptance, atomic: the conditional UPDATE wins at most once; the organizer and session inserts
   * only happen when this very call won it (accepted_organizer_id is our fresh id). Returns false when the
   * invite was not valid any more (used, revoked or expired in the meantime): nothing is written then.
   * Throws (and the whole batch rolls back, invite not consumed) on a unique violation of sub or email.
   */
  async acceptInvite(tokenHash: string, a: NewAccount): Promise<boolean> {
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE invites SET used_at = ?1, accepted_organizer_id = ?2
           WHERE token_hash = ?3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1`,
        )
        .bind(a.now, a.organizerId, tokenHash),
      this.db
        .prepare(
          `INSERT INTO organizers (id, google_sub, email, display_name, role, created_at)
           SELECT ?1, ?2, ?3, ?4, 'organizer', ?5
           WHERE EXISTS (SELECT 1 FROM invites WHERE token_hash = ?6 AND accepted_organizer_id = ?1)`,
        )
        .bind(a.organizerId, a.googleSub, a.email, a.displayName, a.now, tokenHash),
      this.db
        .prepare(
          `INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at)
           SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM organizers WHERE id = ?2)`,
        )
        .bind(a.sessionHash, a.organizerId, a.now, a.sessionExpiresAt),
      this.pruneExpiredSessions(a.now),
    ]);
    return results[1]?.meta.changes === 1;
  }

  // --- sessions -------------------------------------------------------------------------------

  private insertSession(hash: string, organizerId: string, now: number, expiresAt: number): D1PreparedStatement {
    return this.db
      .prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(hash, organizerId, now, expiresAt);
  }

  /** Global prune of expired sessions (all users), run on every session creation (no cron needed). */
  private pruneExpiredSessions(now: number): D1PreparedStatement {
    return this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now);
  }

  /** New session for an existing account; also prunes every expired session. */
  async createSession(organizerId: string, hash: string, now: number, expiresAt: number): Promise<void> {
    await this.db.batch([this.insertSession(hash, organizerId, now, expiresAt), this.pruneExpiredSessions(now)]);
  }

  /** Role is read from D1 on every request, never from the cookie. Expired sessions are deleted when seen. */
  async loadSession(hash: string, now: number): Promise<SessionUser | null> {
    const row = await this.db
      .prepare(
        `SELECT s.expires_at AS expires_at, o.id AS id, o.email AS email, o.display_name AS display_name, o.role AS role
         FROM sessions s JOIN organizers o ON o.id = s.organizer_id WHERE s.token_hash = ?1`,
      )
      .bind(hash)
      .first<{ expires_at: number; id: string; email: string; display_name: string; role: Role }>();
    if (!row) return null;
    if (row.expires_at <= now) {
      await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
      return null;
    }
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  }

  async deleteSession(hash: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(hash).run();
  }

  // --- invites --------------------------------------------------------------------------------

  async findInviteByHash(hash: string): Promise<StoredInvite | null> {
    const row = await this.db
      .prepare(
        `SELECT i.id AS id, i.email AS email, i.expires_at AS expires_at, i.used_at AS used_at, i.revoked_at AS revoked_at,
                o.display_name AS inviter_name
         FROM invites i JOIN organizers o ON o.id = i.created_by WHERE i.token_hash = ?1`,
      )
      .bind(hash)
      .first<{
        id: string;
        email: string;
        expires_at: number;
        used_at: number | null;
        revoked_at: number | null;
        inviter_name: string;
      }>();
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
      inviterName: row.inviter_name,
    };
  }

  /** One atomic INSERT ... SELECT guarded by the cap, the duplicate-pending rule and the has-account rule. */
  async createInvite(i: {
    id: string;
    tokenHash: string;
    email: string;
    createdBy: string;
    now: number;
    expiresAt: number;
  }): Promise<CreateInviteOutcome> {
    const res = await this.db
      .prepare(
        `INSERT INTO invites (id, token_hash, email, created_by, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE (SELECT COUNT(*) FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?5) < ?7
           AND NOT EXISTS (SELECT 1 FROM organizers WHERE email = ?3)
           AND NOT EXISTS (SELECT 1 FROM invites WHERE email = ?3 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?5)`,
      )
      .bind(i.id, i.tokenHash, i.email, i.createdBy, i.now, i.expiresAt, MAX_PENDING_INVITES)
      .run();
    if (res.meta.changes === 1) return "created";
    const hasAccount = await this.db.prepare("SELECT 1 AS x FROM organizers WHERE email = ?1").bind(i.email).first();
    if (hasAccount) return "email_already_registered";
    const pending = await this.db
      .prepare("SELECT 1 AS x FROM invites WHERE email = ?1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?2")
      .bind(i.email, i.now)
      .first();
    return pending ? "invite_already_pending" : "invite_cap_reached";
  }

  /**
   * Retention: delete invites that ended more than INVITE_RETENTION_MS ago. End = used_at, else revoked_at,
   * else expires_at. A pending, unexpired invite always ends in the future, so it is never deleted.
   */
  async purgeEndedInvites(now: number): Promise<void> {
    await this.db
      .prepare("DELETE FROM invites WHERE COALESCE(used_at, revoked_at, expires_at) < ?1")
      .bind(now - INVITE_RETENTION_MS)
      .run();
  }

  async listPendingInvites(now: number): Promise<PendingInvite[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, email, created_at, expires_at FROM invites
         WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?1
         ORDER BY created_at DESC, id LIMIT ?2`,
      )
      .bind(now, MAX_PENDING_INVITES)
      .all<{ id: string; email: string; created_at: number; expires_at: number }>();
    return results.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at, expiresAt: r.expires_at }));
  }

  /** Revoke a still-unused invite. Returns the invite's state afterwards (null = unknown id). */
  async revokeInvite(id: string, now: number): Promise<"revoked" | "already_revoked" | "used" | "not_found"> {
    const res = await this.db
      .prepare("UPDATE invites SET revoked_at = ?2 WHERE id = ?1 AND used_at IS NULL AND revoked_at IS NULL")
      .bind(id, now)
      .run();
    if (res.meta.changes === 1) return "revoked";
    const row = await this.db
      .prepare("SELECT used_at, revoked_at FROM invites WHERE id = ?1")
      .bind(id)
      .first<{ used_at: number | null; revoked_at: number | null }>();
    if (!row) return "not_found";
    return row.used_at !== null ? "used" : "already_revoked";
  }
}
