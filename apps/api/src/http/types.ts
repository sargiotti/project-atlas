import type { Context } from "hono";
import type { SessionUser } from "../adapters/d1-auth-repository";

type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export interface Env {
  DB: D1Database;
  /** Static assets (the SPA shell). Used by the /e/* HTML route. */
  ASSETS: Fetcher;
  /** Fixed public origin (wrangler vars) for absolute og:url / og:image URLs. Never taken from the request. */
  PUBLIC_ORIGIN: string;
  /** Optional: remove the [[ratelimits]] block in wrangler.toml to switch limiting off. */
  RATE_LIMITER?: Limiter;
  /** Optional, stricter limiter for auth start/callback, invite inspect/create/revoke (slice 06). Fails open. */
  AUTH_LIMITER?: Limiter;
  /** Slice 06 secrets (wrangler secret put). Absent on previews/local: sign-in then reports `not_configured`. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Google email that becomes the first Admin on its first verified sign-in. */
  ADMIN_EMAIL?: string;
  /** Exact Google redirect URI. Plain var, top-level config only; never built from the request. */
  OAUTH_REDIRECT_URI?: string;
}

export type AppEnv = { Bindings: Env; Variables: { requestId: string; user: SessionUser } };
export type AppContext = Context<AppEnv>;
