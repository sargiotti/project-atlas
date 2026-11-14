import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import {
  INVITE_TOKEN_REGEX,
  createInviteRequestSchema,
  inspectInviteRequestSchema,
  type CreateInviteResponse,
  type ErrorCode,
  type InviteListResponse,
  type MeResponse,
} from "@atlas/contract";
import { buildAuthorizationUrl, exchangeCode, verifyIdToken } from "../adapters/google-oidc";
import { D1AuthRepository } from "../adapters/d1-auth-repository";
import { fromBase64Url, randomToken, safeEqual, sha256Hex, toBase64Url } from "../adapters/crypto";
import { createInvite, inspectInvite } from "../application/invites";
import { completeSignIn } from "../application/sign-in";
import { SESSION_TTL_MS } from "../domain/auth";
import { errorResponse } from "./errors";
import type { AppContext, AppEnv } from "./types";

const OAUTH_COOKIE = "__Host-atlas_oauth";
const SESSION_COOKIE = "__Host-atlas_session";
const OAUTH_COOKIE_MAX_AGE_S = 600;
const BODY_LIMIT_BYTES = 8 * 1024;

const cookieBase = { httpOnly: true, secure: true, sameSite: "Lax", path: "/" } as const;

interface Flow {
  s: string; // state
  n: string; // nonce
  v: string; // PKCE code_verifier
  i?: string; // invite token
}

const TOKEN_43 = /^[A-Za-z0-9_-]{43}$/;

function parseFlow(raw: string | undefined): Flow | null {
  if (!raw || raw.length > 400) return null;
  try {
    const f = JSON.parse(new TextDecoder().decode(fromBase64Url(raw))) as Record<string, unknown>;
    if (![f.s, f.n, f.v].every((x) => typeof x === "string" && TOKEN_43.test(x))) return null;
    const invite = typeof f.i === "string" && INVITE_TOKEN_REGEX.test(f.i) ? f.i : undefined;
    return { s: f.s as string, n: f.n as string, v: f.v as string, ...(invite ? { i: invite } : {}) };
  } catch {
    return null;
  }
}

/** One privacy-safe line per auth event: request id, event, outcome code, internal id at most. No email, sub, name, IP, tokens. */
function logAuth(c: AppContext, event: string, outcome: string, organizerId?: string): void {
  console.log(
    `[auth] requestId=${c.get("requestId")} event=${event} outcome=${outcome}${organizerId ? ` organizer=${organizerId}` : ""}`,
  );
}

function clearFlowCookie(c: AppContext): void {
  setCookie(c, OAUTH_COOKIE, "", { ...cookieBase, maxAge: 0 });
}

/** Only fixed internal paths. The invite token (when present) is validated against a strict regex. */
function failRedirect(c: AppContext, code: ErrorCode, inviteToken?: string): Response {
  const base = inviteToken && INVITE_TOKEN_REGEX.test(inviteToken) ? `/panel/invite/${inviteToken}` : "/panel/login";
  return c.redirect(`${base}?error=${code}`, 302);
}

const authLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.AUTH_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" })).success;
    } catch {
      allowed = true; // fail open
    }
    if (!allowed) return errorResponse(c, 429, "rate_limited", "no-store", { "Retry-After": "60" });
  }
  await next();
};

/** State-changing requests: same-origin only, JSON only (POST), small bodies. */
const guardMutations: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== "POST" && method !== "DELETE") return next();
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  if (!origin || origin !== new URL(c.req.url).origin || (site !== undefined && site !== "same-origin")) {
    return errorResponse(c, 403, "invalid_origin", "no-store");
  }
  if (method === "POST" && !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) {
    return errorResponse(c, 415, "unsupported_media_type", "no-store");
  }
  return next();
};

const limitBody = bodyLimit({
  maxSize: BODY_LIMIT_BYTES,
  onError: (c) => errorResponse(c as AppContext, 413, "payload_too_large", "no-store"),
});

/** Loads the session and the role from D1 on every request. */
const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !TOKEN_43.test(token)) return errorResponse(c, 401, "unauthenticated", "no-store");
  const user = await new D1AuthRepository(c.env.DB).loadSession(await sha256Hex(token), Date.now());
  if (!user) return errorResponse(c, 401, "unauthenticated", "no-store");
  c.set("user", user);
  await next();
};

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") return errorResponse(c, 403, "forbidden", "no-store");
  await next();
};

async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function registerAuthRoutes(app: Hono<AppEnv>): void {
  // Everything personal or session-related is never cached, errors and redirects included.
  app.use("/api/v1/auth/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.use("/api/v1/invites/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.use("/api/v1/admin/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.use("/api/v1/auth/google/*", authLimiter);
  app.use("/api/v1/invites/*", guardMutations, authLimiter, limitBody);
  app.use("/api/v1/auth/logout", guardMutations, limitBody);

  // Deny by default: every admin route needs a session AND the admin role (401 / 403).
  app.use("/api/v1/admin/*", guardMutations, authLimiter, limitBody, requireAuth, requireAdmin);
  app.use("/api/v1/auth/me", requireAuth);

  // --- Google sign-in ------------------------------------------------------------------------

  app.get("/api/v1/auth/google/start", async (c) => {
    const { GOOGLE_CLIENT_ID: clientId, OAUTH_REDIRECT_URI: redirectUri } = c.env;
    const q = c.req.query("invite");
    const invite = q && INVITE_TOKEN_REGEX.test(q) ? q : undefined;
    if (!clientId || !redirectUri || !c.env.GOOGLE_CLIENT_SECRET) {
      logAuth(c, "sign_in_start", "not_configured");
      return failRedirect(c, "not_configured", invite);
    }
    const flow: Flow = { s: randomToken(), n: randomToken(), v: randomToken(), ...(invite ? { i: invite } : {}) };
    setCookie(c, OAUTH_COOKIE, toBase64Url(new TextEncoder().encode(JSON.stringify(flow))), {
      ...cookieBase,
      maxAge: OAUTH_COOKIE_MAX_AGE_S,
    });
    logAuth(c, "sign_in_start", "ok");
    return c.redirect(
      await buildAuthorizationUrl({ clientId, redirectUri, state: flow.s, nonce: flow.n, codeVerifier: flow.v }),
      302,
    );
  });

  app.get("/api/v1/auth/google/callback", async (c) => {
    const flow = parseFlow(getCookie(c, OAUTH_COOKIE));
    clearFlowCookie(c); // whatever the outcome
    const fail = (code: ErrorCode, reason: string): Response => {
      logAuth(c, "sign_in", `${code}:${reason}`);
      return failRedirect(c, code, flow?.i);
    };

    // Cheapest checks first: no D1 and no call to Google unless the state matches the cookie.
    const state = c.req.query("state");
    if (!flow || !state || !(await safeEqual(state, flow.s))) return fail("invalid_state", "state");
    if (c.req.query("error")) return fail("oauth_failed", "google_error"); // never reflected
    const code = c.req.query("code");
    if (!code || code.length > 2048) return fail("oauth_failed", "no_code");

    const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, OAUTH_REDIRECT_URI: redirectUri } = c.env;
    if (!clientId || !clientSecret || !redirectUri) return fail("not_configured", "config");

    const idToken = await exchangeCode({ code, codeVerifier: flow.v, clientId, clientSecret, redirectUri });
    if (!idToken) return fail("oauth_failed", "token_exchange");

    const verified = await verifyIdToken(idToken, { clientId, nonce: flow.n });
    if (!verified.ok) {
      return fail(verified.reason === "email_not_verified" ? "email_not_verified" : "oauth_failed", verified.reason);
    }

    const result = await completeSignIn(
      new D1AuthRepository(c.env.DB),
      verified.identity,
      flow.i ?? null,
      c.env.ADMIN_EMAIL,
      Date.now(),
    );
    if (!result.ok) return fail(result.code, "rejected");

    setCookie(c, SESSION_COOKIE, result.sessionToken, { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 });
    logAuth(c, "sign_in", "ok", result.organizerId);
    return c.redirect("/panel", 302);
  });

  // --- Session ------------------------------------------------------------------------------

  app.get("/api/v1/auth/me", (c) => {
    const u = c.get("user");
    const body: MeResponse = { organizer: { id: u.id, displayName: u.displayName, email: u.email, role: u.role } };
    return c.json(body);
  });

  // POST only (GET never logs out). Idempotent: no session is still 204.
  app.post("/api/v1/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token && TOKEN_43.test(token)) {
      await new D1AuthRepository(c.env.DB).deleteSession(await sha256Hex(token));
    }
    setCookie(c, SESSION_COOKIE, "", { ...cookieBase, maxAge: 0 });
    logAuth(c, "logout", "ok");
    return c.body(null, 204);
  });

  // --- Invites ------------------------------------------------------------------------------

  app.post("/api/v1/invites/inspect", async (c) => {
    const parsed = inspectInviteRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", "no-store");
    const result = await inspectInvite(new D1AuthRepository(c.env.DB), parsed.data.token, Date.now());
    if (!result) return errorResponse(c, 404, "invite_not_found", "no-store");
    return c.json(result);
  });

  app.post("/api/v1/admin/invites", async (c) => {
    const parsed = createInviteRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", "no-store");
    const result = await createInvite(
      new D1AuthRepository(c.env.DB),
      c.get("user").id,
      parsed.data.email,
      c.env.ADMIN_EMAIL,
      Date.now(),
    );
    if (!result.ok) {
      logAuth(c, "invite_create", result.code, c.get("user").id);
      return errorResponse(c, 409, result.code, "no-store");
    }
    logAuth(c, "invite_create", "ok", c.get("user").id);
    const body: CreateInviteResponse = {
      invite: {
        id: result.id,
        email: result.email,
        createdAt: new Date(result.createdAt).toISOString(),
        expiresAt: new Date(result.expiresAt).toISOString(),
      },
      invitePath: `/panel/invite/${result.token}`,
    };
    return c.json(body, 201);
  });

  app.get("/api/v1/admin/invites", async (c) => {
    const pending = await new D1AuthRepository(c.env.DB).listPendingInvites(Date.now());
    const body: InviteListResponse = {
      invites: pending.map((i) => ({
        id: i.id,
        email: i.email,
        createdAt: new Date(i.createdAt).toISOString(),
        expiresAt: new Date(i.expiresAt).toISOString(),
      })),
    };
    return c.json(body);
  });

  app.delete("/api/v1/admin/invites/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^inv_[A-Za-z0-9_-]{16}$/.test(id)) return errorResponse(c, 404, "invite_not_found", "no-store");
    const outcome = await new D1AuthRepository(c.env.DB).revokeInvite(id, Date.now());
    if (outcome === "not_found") return errorResponse(c, 404, "invite_not_found", "no-store");
    if (outcome === "used") return errorResponse(c, 409, "invite_used", "no-store");
    logAuth(c, "invite_revoke", outcome, c.get("user").id);
    return c.body(null, 204);
  });
}
