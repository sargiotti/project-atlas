import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { buildSeedStatements, loadAllSeeds } from "./scripts/seed-lib.ts";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"));
  const seedStatements = buildSeedStatements(loadAllSeeds(resolve(import.meta.dirname, "test/fixtures")));
  return {
    test: {
      projects: [
        {
          // Worker code and use cases, inside workerd with a real (miniflare) D1.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.toml" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations, TEST_SEED: seedStatements } },
            }),
          ],
          test: { name: "worker", setupFiles: ["./test/setup.ts"], include: ["test/**/*.test.ts", "src/**/*.test.ts"] },
        },
        {
          // Build-time scripts that need native Node modules (sharp): plain Node, not workerd.
          test: { name: "build", environment: "node", include: ["test-node/**/*.test.ts"] },
        },
      ],
    },
  };
});
