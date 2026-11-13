import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { buildSeedStatements, loadAllSeeds } from "./scripts/seed-lib.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"));
  const seedStatements = buildSeedStatements(loadAllSeeds(resolve(import.meta.dirname, "test/fixtures")));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_SEED: seedStatements } },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts", "src/**/*.test.ts"] },
  };
});
