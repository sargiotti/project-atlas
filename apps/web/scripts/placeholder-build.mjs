// PLACEHOLDER: the frontend agent replaces this with the real Vite build.
// It only makes sure apps/web/dist exists so wrangler's assets directory resolves.
import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
mkdirSync("dist", { recursive: true });
if (!existsSync("dist/index.html")) {
  writeFileSync("dist/index.html", "<!doctype html><title>Atlas</title><p>Frontend not built yet.</p>");
}
if (existsSync("public")) cpSync("public", "dist", { recursive: true });
