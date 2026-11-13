/**
 * Seed script.
 *   npm run seed -- --local          validate, copy SVGs, write seed.sql, migrate + seed local D1
 *   npm run seed -- --assets-only    validate, copy SVGs, write seed.sql (no database; used before build)
 *   npm run seed -- --remote         same as --local but against the remote D1 (needs the user's
 *                                    own Cloudflare credentials; the user runs it or approves it)
 * Options: --dir <folder with *.points.json> (default: design/assets/demo-maps)
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeedStatements, loadAllSeeds } from "./seed-lib.ts";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, "..");
const repoRoot = resolve(apiDir, "../..");

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name: string) => args.includes(name);
const dirIdx = args.indexOf("--dir");
const seedDir = resolve(dirIdx >= 0 && args[dirIdx + 1] ? (args[dirIdx + 1] as string) : join(repoRoot, "design/assets/demo-maps"));

const target = flag("--remote") ? "--remote" : flag("--local") ? "--local" : null;
if (!target && !flag("--assets-only")) {
  console.error("Usage: seed --local | --remote | --assets-only [--dir <folder>]");
  process.exit(2);
}
if (flag("--remote") && flag("--local")) {
  console.error("Choose either --local or --remote.");
  process.exit(2);
}

// 1-2. Load and strictly validate every seed file (fails fast).
const seeds = loadAllSeeds(seedDir);

// 3. Copy SVGs to apps/web/public/maps/{slug}.{hash8}.svg (gitignored, regenerated).
const mapsDir = join(repoRoot, "apps/web/public/maps");
mkdirSync(mapsDir, { recursive: true });
for (const f of readdirSync(mapsDir).filter((f) => f.endsWith(".svg"))) rmSync(join(mapsDir, f));
for (const s of seeds) {
  copyFileSync(resolve(dirname(s.source), s.seed.map.file), join(mapsDir, s.imageKey));
}

// 4. Idempotent seed.sql.
const seedOut = join(apiDir, ".seed");
mkdirSync(seedOut, { recursive: true });
const sqlPath = join(seedOut, "seed.sql");
writeFileSync(sqlPath, buildSeedStatements(seeds).join(";\n") + ";\n");
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
  run(["d1", "execute", "DB", target, "--file", sqlPath]);
}
