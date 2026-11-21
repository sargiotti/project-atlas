import { createApp } from "./http/app";
import type { Env } from "./http/app";
import { redateDemos } from "./application/redate-demos";
import { pruneModeration, pruneOrganizerRequests } from "./application/prune";

export type { Env } from "./http/app";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Daily cron (wrangler.toml `[triggers]`): moderation audit and transition quota prune. Logs counts only. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      pruneModeration(env.DB, Date.now()).then(
        (n) => console.log(`[cron] action=prune audit=${n.audit} quota=${n.quota}`),
        (err) => console.error(`[cron] action=prune_failed name=${err instanceof Error ? err.name : "NonError"}`),
      ),
    );
    ctx.waitUntil(
      pruneOrganizerRequests(env.DB, Date.now()).then(
        (n) => console.log(`[cron] action=prune_organizer_requests deleted=${n}`),
        (err) => console.error(`[cron] action=prune_organizer_requests_failed name=${err instanceof Error ? err.name : "NonError"}`),
      ),
    );
    ctx.waitUntil(
      redateDemos(env.DB, Date.now()).then(
        (n) => console.log(`[cron] action=redate_demos moved=${n}`),
        (err) => console.error(`[cron] action=redate_demos_failed name=${err instanceof Error ? err.name : "NonError"}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
