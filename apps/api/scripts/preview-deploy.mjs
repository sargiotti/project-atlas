// Workers Builds "Preview" command for non-production branches:
//   1. apply pending migrations to the preview D1 (never production),
//   2. deploy the preview with `wrangler preview` (binds the previews.* config in wrangler.toml).
// Migrations are applied before the code that needs them (standing deploy rule).
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = resolve(apiDir, "../../node_modules/wrangler/bin/wrangler.js");
const branch = process.env.WORKERS_CI_BRANCH;

if (!branch) {
  console.error("WORKERS_CI_BRANCH is not set: this script only runs inside Workers Builds. Aborting.");
  process.exit(1);
}
if (branch === "main") {
  console.error("Refusing to run the preview deploy on the production branch (main).");
  process.exit(1);
}

const run = (args) => {
  const r = spawnSync(process.execPath, [wranglerBin, ...args], { cwd: apiDir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(["d1", "migrations", "apply", "DB", "--remote", "-c", join(apiDir, "wrangler.migrate-preview.toml")]);
run(["preview"]);
