import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname, "../migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const apply = (db: DatabaseSync, upTo: (name: string) => boolean) => {
  for (const f of files.filter(upTo)) db.exec(readFileSync(resolve(dir, f), "utf8"));
};

describe("migration 0009_publication on a database that already has data", () => {
  it("keeps demo events published, existing drafts as drafts, and keeps maps, points and sessions", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    apply(db, (f) => f < "0009");

    db.exec(`INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org1', 's', 'o@example.com', 'O', 'organizer', 0)`);
    // A seeded demo event (no owner, status defaults to 'published') with a map and a point
    db.exec(`INSERT INTO events (id, slug, name, start_date, end_date, language, created_at, updated_at) VALUES ('evt_demo', 'demo-fest', 'Demo', '2026-08-01', '2026-08-02', 'en', 0, 5000)`);
    db.exec(`INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES ('map_demo', 'evt_demo', 1, 10, 10, 'light', 'demo.svg', 'svg', 0, 0)`);
    db.exec(`INSERT INTO points (id, map_id, category, name, description, x, y, created_at, updated_at) VALUES ('p1', 'map_demo', 'stage', 'Main', '', 0.5, 0.5, 0, 0)`);
    // An organizer's draft with an uploaded map, and an organizer event that slice 07 tests could publish
    db.exec(`INSERT INTO events (id, slug, name, start_date, end_date, language, status, owner_id, created_at, updated_at) VALUES ('evt_draft', 'my-draft', 'Draft', '2026-08-01', '2026-08-02', 'en', 'draft', 'org1', 0, 7000)`);
    db.exec(`INSERT INTO event_map_images (event_id, theme, format, full_key, full_width, full_height, small_key, small_width, small_height, created_at, updated_at) VALUES ('evt_draft', 'light', 'webp', 'f', 1, 1, 's', 1, 1, 0, 0)`);
    db.exec(`INSERT INTO events (id, slug, name, start_date, end_date, language, status, owner_id, created_at, updated_at) VALUES ('evt_live', 'my-live', 'Live', '2026-08-01', '2026-08-02', 'en', 'published', 'org1', 0, 9000)`);

    apply(db, (f) => f >= "0009");

    const state = (id: string) => db.prepare("SELECT publish_state, requested_at, approved_at, status_reason FROM events WHERE id = ?").get(id);
    expect(state("evt_demo")).toEqual({ publish_state: "published", requested_at: null, approved_at: 5000, status_reason: null });
    expect(state("evt_live")).toMatchObject({ publish_state: "published", approved_at: 9000 });
    expect(state("evt_draft")).toEqual({ publish_state: "draft", requested_at: null, approved_at: null, status_reason: null });

    // Additive: nothing cascaded away
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_maps").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM points").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_map_images").get()).toEqual({ n: 1 });

    // An INSERT that does not know the new column (old code during the deploy window) stays hidden
    db.exec(`INSERT INTO events (id, slug, name, start_date, end_date, language, created_at, updated_at) VALUES ('evt_old', 'old-code', 'Old', '2026-08-01', '2026-08-02', 'en', 0, 0)`);
    expect(state("evt_old")).toMatchObject({ publish_state: "draft" });

    // The CHECKs hold
    expect(() => db.exec(`UPDATE events SET publish_state = 'bogus' WHERE id = 'evt_old'`)).toThrow();
    expect(() => db.exec(`UPDATE events SET status_reason = '${"x".repeat(201)}' WHERE id = 'evt_old'`)).toThrow();
    expect(() => db.exec(`INSERT INTO moderation_audit (event_id, actor_id, actor_role, action, from_state, to_state, created_at) VALUES ('e', 'a', 'owner', 'approve', 'a', 'b', 0)`)).toThrow();

    // The partial indexes exist and the public predicate uses them
    const plan = (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => String((r as { detail: string }).detail)).join(" | ");
    expect(plan("SELECT slug FROM events WHERE publish_state = 'published' ORDER BY start_date, slug")).toContain("idx_events_published_v2");
    expect(plan("SELECT id FROM events WHERE publish_state = 'in_review' ORDER BY requested_at, id")).toContain("idx_events_pending");
    expect(plan("SELECT id FROM events WHERE publish_state = 'published' ORDER BY updated_at DESC, id")).toContain("idx_events_pub_updated");
    db.close();
  });
});

describe("seeded demo events", () => {
  it("are never 'edited since approval', on first seed or on re-seed", async () => {
    const { loadAllSeeds, buildSeedStatements } = await import("../scripts/seed-lib");
    const root = resolve(import.meta.dirname, "../../..");
    const seeds = loadAllSeeds([resolve(root, "design/assets/demo-maps"), resolve(root, "design/assets/demo-maps-ai")]);
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    apply(db, () => true);
    for (let run = 0; run < 2; run++) {
      for (const sql of buildSeedStatements(seeds)) db.exec(sql);
      const rows = db.prepare("SELECT slug, approved_at, updated_at FROM events").all() as { slug: string; approved_at: number | null; updated_at: number }[];
      expect(rows.length).toBe(seeds.length);
      // Same rule as editedSinceApproval in d1-admin-event-repository
      for (const r of rows) expect(r.approved_at !== null && r.updated_at > r.approved_at, `${r.slug} run ${run}`).toBe(false);
      db.exec("UPDATE events SET updated_at = updated_at - 5000, approved_at = approved_at - 5000"); // let the re-seed move time forward
    }
  });
});
