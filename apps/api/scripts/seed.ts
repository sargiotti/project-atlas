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
 * Default: SVG maps from design/assets/demo-maps, with the AI maps (WebP) in
 * design/assets/demo-maps-ai replacing the same-slug events (fiesta, festival).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedStatements, loadAllSeeds } from "./seed-lib.ts";
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

// 3b. Covers to apps/web/public/covers/{slug}.{hash8}.webp (gitignored, regenerated).
const coversOut = join(repoRoot, "apps/web/public/covers");
mkdirSync(coversOut, { recursive: true });
for (const f of readdirSync(coversOut).filter((f) => f.endsWith(".webp"))) rmSync(join(coversOut, f));
for (const s of seeds) {
  if (s.cover) writeFileSync(join(coversOut, s.cover.key), s.cover.bytes);
}

// 3c. Link-preview images to apps/web/public/og/ (gitignored, regenerated): the brand card (copied,
// content-hashed) and one 1200x630 JPEG per event that has a cover. Events without a cover use the brand card.
const ogDir = join(repoRoot, "apps/web/public/og");
mkdirSync(ogDir, { recursive: true });
for (const f of readdirSync(ogDir).filter((f) => f.endsWith(".jpg"))) rmSync(join(ogDir, f));
const ogAssets = join(repoRoot, "design/assets/og");
const brandCard = loadBrandCard(join(ogAssets, "brand-card.jpg"));
writeFileSync(join(ogDir, brandCard.key), brandCard.bytes);
const badge = loadBadge(join(ogAssets, "badge.png"));
const ogKeys = new Map<string, string>();
for (const s of seeds) {
  if (!s.cover) continue;
  const og = await renderEventOg(s.seed.event.slug, s.cover.bytes, badge);
  writeFileSync(join(ogDir, og.key), og.bytes);
  ogKeys.set(s.seed.event.slug, og.key);
}
console.log(`Wrote brand card ${brandCard.key} and ${ogKeys.size} event OG image(s) to ${ogDir}`);

// 4. Idempotent seed.sql.
const seedOut = join(apiDir, ".seed");
mkdirSync(seedOut, { recursive: true });
const sqlPath = join(seedOut, "seed.sql");
writeFileSync(sqlPath, buildSeedStatements(seeds, ogKeys).join(";\n") + ";\n");
console.log(`Seeded ${seeds.length} event(s): ${seeds.map((s) => s.seed.event.slug).join(", ")}`);
console.log(`Wrote ${sqlPath} ${seeds.length} map(s) to ${mapsDir} and ${seeds.filter((s) => s.cover).length} cover(s) to ${coversOut}`);

// 5. wrangler d1 execute.
if (target) {
  const wranglerBin = join(repoRoot, "node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wranglerBin)) throw new Error("wrangler is not installed. Run npm install.");
  const run = (wranglerArgs: string[]) => {
    const r = spawnSync(process.execPath, [wranglerBin, ...wranglerArgs], { cwd: apiDir, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run(["d1", "migrations", "apply", "DB", target]);
  run(["d1", "execute", "DB", target, "--file", sqlPath]);
}
