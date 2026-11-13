import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";

// Real D1 (miniflare SQLite): apply migrations, then seed the fixture event.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await env.DB.batch(env.TEST_SEED.map((sql) => env.DB.prepare(sql)));
