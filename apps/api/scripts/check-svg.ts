/**
 * Build/CI check: fails (exit 1) if any map SVG contains forbidden content.
 * Usage: tsx scripts/check-svg.ts [dir ...]   (default: design demo maps + generated web maps)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSvgViolations } from "./svg-safety.ts";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2).map((d) => resolve(d))
  : [join(repoRoot, "design/assets/demo-maps"), join(repoRoot, "apps/web/public/maps")];

let checked = 0;
let failed = 0;
for (const dir of dirs) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
    checked++;
    const violations = findSvgViolations(readFileSync(join(dir, file), "utf8"));
    for (const v of violations) console.error(`FAIL ${join(dir, file)}: ${v}`);
    if (violations.length) failed++;
  }
}
if (failed) {
  console.error(`${failed} SVG file(s) failed the safety check.`);
  process.exit(1);
}
console.log(`SVG safety check passed (${checked} file(s)).`);
