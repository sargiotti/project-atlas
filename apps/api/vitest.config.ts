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
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  TEST_SEED: seedStatements,
                  // Slice 06: fake Google config. Real Google is never called (tests stub fetch).
                  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
                  GOOGLE_CLIENT_SECRET: "test-client-secret",
                  ADMIN_EMAIL: "Admin@Example.com",
                  OAUTH_REDIRECT_URI: "http://atlas.test/api/v1/auth/google/callback",
                },
              },
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
