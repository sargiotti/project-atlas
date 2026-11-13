import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
      TEST_SEED: string[];
    }
  }
  type AppEnv = import("../src/http/app").Env;
}
