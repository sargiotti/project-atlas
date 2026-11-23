import type { Hono } from "hono";
import type { AppEnv } from "./types";

/**
 * Slice 38: the last migration file the deployed code expects to find applied. EVERY new migration in
 * apps/api/migrations must bump this constant; test-node/health-migration.test.ts fails otherwise.
 */
export const EXPECTED_MIGRATION = "0018_request_source.sql";

// Constant SQL only. Zero rows are read: LIMIT 0 still makes D1 resolve every named table and column,
// so a missing migration (0015 columns, 0017 terms columns) fails the probe.
const SCHEMA_PROBES = [
  "SELECT id, slug, name, start_date, end_date, language FROM events LIMIT 0",
  "SELECT id, name, email, event_name, status, locale, invited_at, invite_id, email_status, created_at FROM organizer_requests LIMIT 0",
  "SELECT id, email, role, terms_version, terms_accepted_at FROM organizers LIMIT 0",
];
const LAST_MIGRATION_SQL = "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1";

/** True only when every probe runs and the latest applied migration is the expected one. Never throws. */
export async function checkHealth(db: D1Database, expected: string = EXPECTED_MIGRATION): Promise<boolean> {
  try {
    const results = await db.batch([...SCHEMA_PROBES.map((sql) => db.prepare(sql)), db.prepare(LAST_MIGRATION_SQL)]);
    const last = results[results.length - 1]!.results[0] as { name?: string } | undefined;
    return last?.name === expected;
  } catch {
    return false;
  }
}

/** Public, no secret, GET/HEAD. Body is only {"status":"ok"} (200) or {"status":"fail"} (503): no internals. */
export function registerHealthRoutes(app: Hono<AppEnv>) {
  app.on(["GET", "HEAD"], "/api/v1/health", async (c) => {
    const ok = await checkHealth(c.env.DB);
    if (!ok) console.error(`[health] check=schema ok=false requestId=${c.get("requestId")}`);
    return new Response(JSON.stringify({ status: ok ? "ok" : "fail" }), {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  });
}
