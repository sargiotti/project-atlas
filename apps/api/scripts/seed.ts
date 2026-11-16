/**
 * Seed script.
 *   npm run seed -- --local          validate, copy SVGs, write seed.sql, migrate + seed local D1
 *   npm run seed -- --assets-only    validate, copy SVGs, write seed.sql (no database; used before build)
 *   npm run seed -- --remote         same as --local but against the remote D1 (needs the user's
 *                                    own Cloudflare credentials; the user runs it or approves it)
 * Options:
 *   --svg-only        seed every event with its SVG map (design/assets/demo-maps) as before
 *   --dir <folder>    seed from this folder instead (repeatable; a later folder replaces earlier
 *                     events with the same slug). Overrides the default below.
 * Slice 14: seeded event covers (and their link-preview JPEGs) are put into R2 (bucket atlas-maps, keys covers/evt_{slug}/...)
 * and referenced from `event_covers`, exactly like an organizer's upload. --local / --remote put the objects first, then run
 * the SQL; --remote targets the EU jurisdiction bucket. Production order: migration 0013, Worker deploy, seed --remote.
 * Default: SVG maps from design/assets/demo-maps, with the AI maps (WebP) in
 * design/assets/demo-maps-ai replacing the same-slug events (fiesta, festival).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedStatements, loadAllSeeds, planSeedCover, type SeedCoverObjects } from "./seed-lib.ts";
import { loadBadge, loadBrandCard, renderEventOg } from "./og-image.ts";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "..");
const repoRoot = resolve(apiDir, "../..");

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => args.includes(name);
const explicitDirs = args.flatMap((a, i) => (a === "--dir" && args[i + 1] ? [resolve(args[i + 1] as string)] : []));
const svgDir = join(repoRoot, "design/assets/demo-maps");
const aiDir = join(repoRoot, "design/assets/demo-maps-ai");
const seedDirs = explicitDirs.length ? explicitDirs : flag("--svg-only") ? [svgDir] : [svgDir, aiDir];

const target = flag("--remote") ? "--remote" : flag("--local") ? "--local" : null;
if (!target && !flag("--assets-only")) {
  console.error("Usage: seed --local | --remote | --assets-only [--svg-only] [--dir <folder>]...");
  process.exit(2);
}
if (flag("--remote") && flag("--local")) {
  console.error("Choose either --local or --remote.");
  process.exit(2);
}

// 1-2. Load and strictly validate every seed file (fails fast).
const coversSrc = join(repoRoot, "design/assets/event-covers");
const seeds = loadAllSeeds(seedDirs, coversSrc);

// 3. Write validated images to apps/web/public/maps/{slug}.{hash8}.{svg|webp} (gitignored, regenerated).
const mapsDir = join(repoRoot, "apps/web/public/maps");
mkdirSync(mapsDir, { recursive: true });
for (const f of readdirSync(mapsDir).filter((f) => /\.(svg|webp)$/.test(f))) rmSync(join(mapsDir, f));
for (const s of seeds) {
  writeFileSync(join(mapsDir, s.imageKey), s.bytes);
}

// 3b. Link-preview card. Only the Home brand card is a static asset now (apps/web/public/og/, gitignored, regenerated).
// Seeded event covers and their 1200x630 link-preview images live in R2 + `event_covers` like uploaded ones (slice 14):
// they are written to apps/api/.seed/r2/ here and put into the bucket in step 5, before the SQL that points at them.
const ogDir = join(repoRoot, "apps/web/public/og");
mkdirSync(ogDir, { recursive: true });
for (const f of readdirSync(ogDir).filter((f) => f.endsWith(".jpg"))) rmSync(join(ogDir, f));
const ogAssets = join(repoRoot, "design/assets/og");
const brandCard = loadBrandCard(join(ogAssets, "brand-card.jpg"));
writeFileSync(join(ogDir, brandCard.key), brandCard.bytes);
// Old static event images are gone (removed from the repo output): clear stale generated files so they cannot ship.
rmSync(join(repoRoot, "apps/web/public/covers"), { recursive: true, force: true });

const badge = loadBadge(join(ogAssets, "badge.png"));
const seedOut = join(apiDir, ".seed");
const r2Out = join(seedOut, "r2");
rmSync(r2Out, { recursive: true, force: true });
mkdirSync(r2Out, { recursive: true });
const covers = new Map<string, SeedCoverObjects>();
const r2Files: { key: string; file: string; contentType: string }[] = [];
for (const s of seeds) {
  if (!s.cover) continue;
  const slug = s.seed.event.slug;
  const og = await renderEventOg(slug, s.cover.bytes, badge);
  const plan = planSeedCover(slug, s.cover, og.bytes);
  covers.set(slug, plan);
  for (const [key, bytes, contentType] of [
    [plan.fullKey, s.cover.bytes, "image/webp"],
    [plan.smallKey, s.cover.bytes, "image/webp"],
    [plan.ogKey, og.bytes, "image/jpeg"],
  ] as const) {
    const file = join(r2Out, key.replaceAll("/", "__"));
    writeFileSync(file, bytes);
    r2Files.push({ key, file, contentType });
  }
}
console.log(`Wrote brand card ${brandCard.key} to ${ogDir}; ${covers.size} seeded cover(s) staged in ${r2Out}`);

// 4. Idempotent seed.sql.
const sqlPath = join(seedOut, "seed.sql");
writeFileSync(sqlPath, buildSeedStatements(seeds, covers).join(";\n") + ";\n");
console.log(`Seeded ${seeds.length} event(s): ${seeds.map((s) => s.seed.event.slug).join(", ")}`);
console.log(`Wrote ${sqlPath} and ${seeds.length} map(s) to ${mapsDir}`);

// 5. wrangler d1 execute.
if (target) {
  const wranglerBin = join(repoRoot, "node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wranglerBin)) throw new Error("wrangler is not installed. Run npm install.");
  const run = (wranglerArgs: string[]) => {
    const r = spawnSync(process.execPath, [wranglerBin, ...wranglerArgs], { cwd: apiDir, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run(["d1", "migrations", "apply", "DB", target]);
  // R2 objects first, so a row never points at a missing object. Remote: the EU jurisdiction bucket (wrangler.toml).
  for (const f of r2Files) {
    run(["r2", "object", "put", `atlas-maps/${f.key}`, "--file", f.file, "--content-type", f.contentType, target, ...(target === "--remote" ? ["--jurisdiction", "eu"] : [])]);
  }
  run(["d1", "execute", "DB", target, "--file", sqlPath]);
}
