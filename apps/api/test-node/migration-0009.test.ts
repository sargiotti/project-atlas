import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const dir = resolve(import.meta.dirname, "../migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const apply = (db: DatabaseSync, upTo: (name: string) => boolean) => {
  for (const f of files.filter(upTo)) db.exec(readFileSync(resolve(dir, f), "utf8"));
};

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
