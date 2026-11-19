/** Slice 08b: how long moderation audit rows are kept (user decision 2026-11-14): 12 months. */
export const AUDIT_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;

/**
 * Daily housekeeping, run by the cron trigger: deletes audit rows older than 365 days and the per-day transition
 * quota rows of earlier days. These are the only deletes the audit log ever sees. Returns the row counts.
 */
export async function pruneModeration(db: D1Database, now: number): Promise<{ audit: number; quota: number }> {
  const today = new Date(now).toISOString().slice(0, 10);
  const [audit, quota] = await db.batch([
    db.prepare(`DELETE FROM moderation_audit WHERE created_at < ?1`).bind(now - AUDIT_RETENTION_DAYS * DAY_MS),
    db.prepare(`DELETE FROM transition_quota WHERE day < ?1`).bind(today),
  ]);
  return { audit: audit?.meta.changes ?? 0, quota: quota?.meta.changes ?? 0 };
}

/** Slice 30: organizer requests are kept 12 months (privacy policy), then deleted. */
export const ORGANIZER_REQUEST_RETENTION_DAYS = 365;

export async function pruneOrganizerRequests(db: D1Database, now: number): Promise<number> {
  const [res] = await db.batch([
    db.prepare(`DELETE FROM organizer_requests WHERE created_at < ?1`).bind(now - ORGANIZER_REQUEST_RETENTION_DAYS * DAY_MS),
    // Slice 31: the invite-email cap only needs the current UTC day.
    db.prepare(`DELETE FROM invite_email_log WHERE created_at < ?1`).bind(now - 2 * DAY_MS),
  ]);
  return res?.meta.changes ?? 0;
}
