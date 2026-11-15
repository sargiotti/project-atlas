import { env } from "cloudflare:workers";
import app from "../src/index";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PENDING_INVITES } from "@atlas/contract";
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, clearJwksCache } from "../src/adapters/google-oidc";
import { toBase64Url } from "../src/adapters/crypto";

const ORIGIN = "http://atlas.test";
const CLIENT_ID = env.GOOGLE_CLIENT_ID as string;
const enc = new TextEncoder();

// --- A fake Google: our own RSA key signs the ID tokens; fetch() to Google's endpoints is stubbed -------------

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JsonWebKey;
const KID = "test-kid-1";

beforeAll(async () => {
  const gen = () =>
    crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    ) as Promise<CryptoKeyPair>;
  const pair = await gen();
  signingKey = pair.privateKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  otherKey = (await gen()).privateKey;
});

const b64json = (o: unknown) => toBase64Url(enc.encode(JSON.stringify(o)));

async function signJwt(claims: Record<string, unknown>, opts: { key?: CryptoKey; alg?: string; kid?: string } = {}) {
  const head = b64json({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID, typ: "JWT" });
  const body = b64json(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? signingKey, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${toBase64Url(sig)}`;
}

interface Who {
  sub: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}
const ADMIN: Who = { sub: "sub-admin", email: "admin@example.com", name: "Ada Admin" };
const ANA: Who = { sub: "sub-ana", email: "ana@example.com", name: "Ana Organizer" };

const nowS = () => Math.floor(Date.now() / 1000);
const baseClaims = (who: Who, nonce: string): Record<string, unknown> => ({
  iss: "https://accounts.google.com",
  aud: CLIENT_ID,
  azp: CLIENT_ID,
  exp: nowS() + 3600,
  iat: nowS(),
  nonce,
  sub: who.sub,
  email: who.email,
  email_verified: who.emailVerified ?? true,
  name: who.name,
});

type FetchStub = ReturnType<typeof vi.spyOn>;
let fetchSpy: FetchStub;
/** What the fake Google token endpoint returns for the next code exchange(s). */
let idTokenFor: (nonce: string) => Promise<string>;

beforeEach(async () => {
  clearJwksCache();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === GOOGLE_JWKS_URL) {
      return Response.json({ keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] }, { headers: { "cache-control": "public, max-age=3600" } });
    }
    if (url === GOOGLE_TOKEN_URL) {
      // The nonce travels in our own authorization URL; the test stashes it in `currentNonce`.
      return Response.json({ id_token: await idTokenFor(currentNonce), access_token: "x", token_type: "Bearer" });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM invites"),
    env.DB.prepare("DELETE FROM organizers"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

let currentNonce = "";
let ipCounter = 0;
const freshIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;

// --- HTTP helpers ------------------------------------------------------------------------------------------

type TestEnv = Record<string, unknown>;
const call = (path: string, init: RequestInit & { env?: TestEnv } = {}) => {
  const { env: envOverride, headers, ...rest } = init;
  return app.fetch(
    new Request(`${ORIGIN}${path}`, { ...rest, headers: { "cf-connecting-ip": freshIp(), ...(headers as Record<string, string>) } }),
    envOverride ? ({ ...env, ...envOverride } as unknown as typeof env) : env,
  );
};

const cookieOf = (res: Response, name: string): string | null => {
  for (const line of res.headers.getSetCookie()) {
    if (line.startsWith(`${name}=`)) return line;
  }
  return null;
};
const cookieValue = (line: string | null) => (line ? line.split(";")[0]!.split("=").slice(1).join("=") : "");

const jsonPost = (path: string, body: unknown, cookie?: string, extra: Record<string, string> = {}) =>
  call(path, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(body),
  });
const authed = (path: string, session: string, init: RequestInit = {}) =>
  call(path, { ...init, headers: { cookie: `__Host-atlas_session=${session}`, origin: ORIGIN, "content-type": "application/json", ...(init.headers as object) } });

interface FlowResult {
  res: Response;
  location: string;
  session: string | null;
}

/** Runs start + callback as a browser would. `idToken` overrides what Google's token endpoint returns. */
async function signIn(
  who: Who,
  opts: { invite?: string; idToken?: (nonce: string) => Promise<string>; stateOverride?: string; cookieOverride?: string } = {},
): Promise<FlowResult> {
  const start = await call(`/api/v1/auth/google/start${opts.invite ? `?invite=${opts.invite}` : ""}`);
  expect(start.status).toBe(302);
  const authUrl = new URL(start.headers.get("location")!);
  const nonce = authUrl.searchParams.get("nonce")!;
  const state = authUrl.searchParams.get("state")!;
  const flowCookie = cookieValue(cookieOf(start, "__Host-atlas_oauth"));
  idTokenFor = opts.idToken ?? ((n) => signJwt(baseClaims(who, n)));
  // Concurrent flows each need their own nonce: bind it per call through a closure on the stub.
  currentNonce = nonce;
  const res = await call(`/api/v1/auth/google/callback?code=abc&state=${opts.stateOverride ?? state}`, {
    headers: { cookie: opts.cookieOverride ?? `__Host-atlas_oauth=${flowCookie}` },
  });
  const sessionLine = cookieOf(res, "__Host-atlas_session");
  const session = sessionLine && !/Max-Age=0/i.test(sessionLine) ? cookieValue(sessionLine) : null;
  return { res, location: res.headers.get("location") ?? "", session };
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

async function adminSession(): Promise<string> {
  const r = await signIn(ADMIN);
  expect(r.session).toBeTruthy();
  return r.session!;
}

async function createInviteFor(adminSess: string, email: string): Promise<{ token: string; id: string }> {
  const res = await authed("/api/v1/admin/invites", adminSess, { method: "POST", body: JSON.stringify({ email }) });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { invite: { id: string }; invitePath: string };
  return { token: body.invitePath.split("/").pop()!, id: body.invite.id };
}

// --- Tests -------------------------------------------------------------------------------------------------

describe("sign-in start", () => {
  it("redirects to Google with state, nonce, PKCE S256 and the configured redirect_uri, and sets the flow cookie", async () => {
    const res = await call("/api/v1/auth/google/start");
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(env.OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(url.searchParams.get("nonce")).toHaveLength(43);
    const cookie = cookieOf(res, "__Host-atlas_oauth")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).not.toMatch(/Domain/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await count("sessions")).toBe(0);
  });

  it("reports not_configured when the Google config is absent (previews, local)", async () => {
    const res = await call("/api/v1/auth/google/start", { env: { OAUTH_REDIRECT_URI: undefined } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/panel/login?error=not_configured");
    expect(cookieOf(res, "__Host-atlas_oauth")).toBeNull();
  });

  it("rate limits before doing any work, and fails open when the limiter throws", async () => {
    const denied = await call("/api/v1/auth/google/start", { env: { AUTH_LIMITER: { limit: async () => ({ success: false }) } } });
    expect(denied.status).toBe(429);
    const broken = await call("/api/v1/auth/google/start", {
      env: { AUTH_LIMITER: { limit: async () => { throw new Error("down"); } } },
    });
    expect(broken.status).toBe(302);
  });

  it("the admin invite limiter runs once per request, on the bare path and on a sub-path", async () => {
    const admin = await adminSession();
    let calls = 0;
    const AUTH_LIMITER = { limit: async () => { calls++; return { success: true }; } };
    await authed("/api/v1/admin/invites", admin, { env: { AUTH_LIMITER } } as RequestInit);
    expect(calls).toBe(1);
    await authed("/api/v1/admin/invites/nope", admin, { method: "DELETE", env: { AUTH_LIMITER } } as RequestInit);
    expect(calls).toBe(2);
  });
});

describe("callback: state and ID token checks", () => {
  it("rejects a state mismatch with no call to Google and no D1 writes", async () => {
    const r = await signIn(ADMIN, { stateOverride: "x".repeat(43) });
    expect(r.location).toBe("/panel/login?error=invalid_state");
    expect(r.session).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await count("organizers")).toBe(0);
    expect(cookieOf(r.res, "__Host-atlas_oauth")).toMatch(/Max-Age=0/);
  });

  it("rejects a callback with no flow cookie", async () => {
    const r = await signIn(ADMIN, { cookieOverride: "other=1" });
    expect(r.location).toBe("/panel/login?error=invalid_state");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never reflects Google's error parameters", async () => {
    const start = await call("/api/v1/auth/google/start");
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const res = await call(`/api/v1/auth/google/callback?error=access_denied&error_description=%3Cscript%3E&state=${state}`, {
      headers: { cookie: `__Host-atlas_oauth=${cookieValue(cookieOf(start, "__Host-atlas_oauth"))}` },
    });
    expect(res.headers.get("location")).toBe("/panel/login?error=oauth_failed");
  });

  const bad: Array<[string, (n: string) => Promise<string>, string]> = [
    ["wrong audience", (n) => signJwt({ ...baseClaims(ADMIN, n), aud: "someone-else" }), "oauth_failed"],
    ["wrong issuer", (n) => signJwt({ ...baseClaims(ADMIN, n), iss: "https://evil.example" }), "oauth_failed"],
    ["expired", (n) => signJwt({ ...baseClaims(ADMIN, n), exp: nowS() - 600 }), "oauth_failed"],
    ["nonce mismatch (replay)", (n) => signJwt(baseClaims(ADMIN, `${n.slice(1)}x`)), "oauth_failed"],
    ["email not verified", (n) => signJwt(baseClaims({ ...ADMIN, emailVerified: false }, n)), "email_not_verified"],
    ["signed by another key", (n) => signJwt(baseClaims(ADMIN, n), { key: otherKey }), "oauth_failed"],
    ["alg none", async (n) => `${b64json({ alg: "none", kid: KID })}.${b64json(baseClaims(ADMIN, n))}.`, "oauth_failed"],
    ["alg HS256", (n) => signJwt(baseClaims(ADMIN, n), { alg: "HS256" }), "oauth_failed"],
    ["unknown kid", (n) => signJwt(baseClaims(ADMIN, n), { kid: "forged" }), "oauth_failed"],
    ["garbage", async () => "not.a.jwt!", "oauth_failed"],
  ];
  it.each(bad)("%s: no session, no account", async (_name, idToken, error) => {
    const r = await signIn(ADMIN, { idToken });
    expect(r.location).toBe(`/panel/login?error=${error}`);
    expect(r.session).toBeNull();
    expect(await count("organizers")).toBe(0);
    expect(await count("sessions")).toBe(0);
  });

  it("an unknown Google account (no account, no invite, not the Admin) gets no_access and nothing is written", async () => {
    const r = await signIn({ sub: "stranger", email: "stranger@example.com" });
    expect(r.location).toBe("/panel/login?error=no_access");
    expect(r.session).toBeNull();
    expect(await count("organizers")).toBe(0);
  });
});

describe("Admin bootstrap and sessions", () => {
  it("the verified ADMIN_EMAIL creates the Admin, bound to the sub, and /me reflects the role from D1", async () => {
    const r = await signIn(ADMIN);
    expect(r.location).toBe("/panel");
    const cookie = cookieOf(r.res, "__Host-atlas_session")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=604800/);
    const me = await authed("/api/v1/auth/me", r.session!);
    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(await me.json()).toMatchObject({ organizer: { displayName: "Ada Admin", email: "admin@example.com", role: "admin" } });

    // Only the hash of the session token is stored.
    const row = await env.DB.prepare("SELECT token_hash FROM sessions").first<{ token_hash: string }>();
    expect(row!.token_hash).not.toBe(r.session);
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("later sign-ins match on sub: same account, new session, even if the email changed", async () => {
    const first = await signIn(ADMIN);
    const again = await signIn({ ...ADMIN, email: "renamed@example.com" });
    expect(again.location).toBe("/panel");
    expect(again.session).not.toBe(first.session);
    expect(await count("organizers")).toBe(1);
  });

  it("an unauthenticated /me is 401", async () => {
    expect((await call("/api/v1/auth/me")).status).toBe(401);
  });

  it("an expired session is treated as missing and its row is deleted", async () => {
    const s = await adminSession();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?1").bind(Date.now() - 1).run();
    expect((await authed("/api/v1/auth/me", s)).status).toBe(401);
    expect(await count("sessions")).toBe(0);
  });

  it("logout deletes the session server-side, clears the cookie, and the old cookie stops working; GET never logs out", async () => {
    const s = await adminSession();
    expect((await call("/api/v1/auth/logout", { headers: { cookie: `__Host-atlas_session=${s}` } })).status).toBe(404);
    expect((await authed("/api/v1/auth/me", s)).status).toBe(200);

    const out = await jsonPost("/api/v1/auth/logout", {}, `__Host-atlas_session=${s}`);
    expect(out.status).toBe(204);
    expect(cookieOf(out, "__Host-atlas_session")).toMatch(/Max-Age=0/);
    expect(await count("sessions")).toBe(0);
    expect((await authed("/api/v1/auth/me", s)).status).toBe(401);
  });
});

describe("invites: create, inspect, accept", () => {
  it("Admin creates an invite; the list shows it pending without the token; D1 stores only a hash", async () => {
    const admin = await adminSession();
    const { token, id } = await createInviteFor(admin, "  Ana@Example.com ");
    const list = await authed("/api/v1/admin/invites", admin);
    const body = (await list.json()) as { invites: Array<Record<string, string>> };
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ id, email: "ana@example.com" });
    expect(JSON.stringify(body)).not.toContain(token);
    const row = await env.DB.prepare("SELECT token_hash, expires_at, created_at FROM invites").first<{ token_hash: string; expires_at: number; created_at: number }>();
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.token_hash).not.toBe(token);
    expect(row!.expires_at - row!.created_at).toBe(7 * 86_400_000);
  });

  it("inspect reveals email and inviter only for a valid invite", async () => {
    const admin = await adminSession();
    const { token, id } = await createInviteFor(admin, ANA.email);
    const ok = await jsonPost("/api/v1/invites/inspect", { token });
    expect(await ok.json()).toEqual({ status: "valid", email: ANA.email, inviterName: "Ada Admin" });
    await authed(`/api/v1/admin/invites/${id}`, admin, { method: "DELETE" });
    expect(await (await jsonPost("/api/v1/invites/inspect", { token })).json()).toEqual({ status: "revoked" });
    expect((await jsonPost("/api/v1/invites/inspect", { token: "A".repeat(43) })).status).toBe(404);
    expect((await jsonPost("/api/v1/invites/inspect", { token: "short" })).status).toBe(400);
  });

  it("the invited person signs in with the matching Google account: account created, signed in, invite consumed", async () => {
    const admin = await adminSession();
    const { token } = await createInviteFor(admin, ANA.email);
    const r = await signIn(ANA, { invite: token });
    expect(r.location).toBe("/panel");
    const me = await authed("/api/v1/auth/me", r.session!);
    expect(await me.json()).toMatchObject({ organizer: { displayName: "Ana Organizer", email: ANA.email, role: "organizer" } });
    expect(((await (await authed("/api/v1/admin/invites", admin)).json()) as { invites: unknown[] }).invites).toHaveLength(0);

    // Sign out, sign in again without the invite: reaches /panel.
    await jsonPost("/api/v1/auth/logout", {}, `__Host-atlas_session=${r.session}`);
    const again = await signIn(ANA);
    expect(again.location).toBe("/panel");
    expect(await count("organizers")).toBe(2);
  });

  it("a wrong Google account (forwarded link or other email) gets invite_email_mismatch: no account, invite NOT consumed", async () => {
    const admin = await adminSession();
    const { token } = await createInviteFor(admin, ANA.email);
    const wrong = await signIn({ sub: "sub-eve", email: "eve@example.com", name: "Eve" }, { invite: token });
    expect(wrong.location).toBe(`/panel/invite/${token}?error=invite_email_mismatch`);
    expect(wrong.location).not.toContain("eve");
    expect(wrong.session).toBeNull();
    expect(await count("organizers")).toBe(1);
    const invite = await env.DB.prepare("SELECT used_at FROM invites").first<{ used_at: number | null }>();
    expect(invite!.used_at).toBeNull();

    // The right person can still use it afterwards.
    expect((await signIn(ANA, { invite: token })).location).toBe("/panel");
  });

  it("an unverified email on an invite gets email_not_verified and creates nothing", async () => {
    const admin = await adminSession();
    const { token } = await createInviteFor(admin, ANA.email);
    const r = await signIn({ ...ANA, emailVerified: false }, { invite: token });
    expect(r.location).toBe(`/panel/invite/${token}?error=email_not_verified`);
    expect(await count("organizers")).toBe(1);
  });

  it("single use under a double accept: two parallel sign-ins on one invite create exactly one account", async () => {
    const admin = await adminSession();
    const { token } = await createInviteFor(admin, ANA.email);
    // Same invite, same verified email, two different Google subs, all four requests in flight together.
    const flows = await Promise.all(
      ["sub-a", "sub-b"].map(async (sub) => {
        const start = await call(`/api/v1/auth/google/start?invite=${token}`);
        const u = new URL(start.headers.get("location")!);
        return { sub, nonce: u.searchParams.get("nonce")!, state: u.searchParams.get("state")!, cookie: cookieValue(cookieOf(start, "__Host-atlas_oauth")) };
      }),
    );
    // Both flows use the same stub; give each token endpoint call the right nonce by code.
    const nonceByCode = new Map(flows.map((f) => [`code-${f.sub}`, f]));
    fetchSpy.mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === GOOGLE_JWKS_URL) return Response.json({ keys: [{ ...publicJwk, kid: KID, alg: "RS256" }] });
      const code = new URLSearchParams(String(init?.body)).get("code")!;
      const f = nonceByCode.get(code)!;
      return Response.json({ id_token: await signJwt(baseClaims({ sub: f.sub, email: ANA.email, name: "Ana" }, f.nonce)) });
    }) as typeof fetch);
    const results = await Promise.all(
      flows.map((f) => call(`/api/v1/auth/google/callback?code=code-${f.sub}&state=${f.state}`, { headers: { cookie: `__Host-atlas_oauth=${f.cookie}` } })),
    );
    const outcomes = results.map((r) => r.headers.get("location")).sort();
    expect(outcomes).toEqual([`/panel`, `/panel/invite/${token}?error=invite_used`].sort());
    expect(await count("organizers")).toBe(2); // admin + exactly one organizer
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>())!.n).toBe(2);
  });

  it("used, revoked and expired invites each return their own code and create nothing", async () => {
    const admin = await adminSession();
    const used = await createInviteFor(admin, ANA.email);
    await signIn(ANA, { invite: used.token });
    const usedAgain = await signIn({ sub: "sub-late", email: "late@example.com" }, { invite: used.token });
    expect(usedAgain.location).toBe(`/panel/invite/${used.token}?error=invite_used`);

    const revoked = await createInviteFor(admin, "rev@example.com");
    expect((await authed(`/api/v1/admin/invites/${revoked.id}`, admin, { method: "DELETE" })).status).toBe(204);
    const revokedTry = await signIn({ sub: "sub-rev", email: "rev@example.com" }, { invite: revoked.token });
    expect(revokedTry.location).toBe(`/panel/invite/${revoked.token}?error=invite_revoked`);

    const expired = await createInviteFor(admin, "old@example.com");
    await env.DB.prepare("UPDATE invites SET expires_at = ?1 WHERE id = ?2").bind(Date.now() - 1, expired.id).run();
    const expiredTry = await signIn({ sub: "sub-old", email: "old@example.com" }, { invite: expired.token });
    expect(expiredTry.location).toBe(`/panel/invite/${expired.token}?error=invite_expired`);

    expect(await count("organizers")).toBe(2); // admin + Ana only
  });

  it("an unknown invite token gives invite_not_found", async () => {
    const r = await signIn(ANA, { invite: "Z".repeat(43) });
    expect(r.location).toBe(`/panel/invite/${"Z".repeat(43)}?error=invite_not_found`);
    expect(await count("organizers")).toBe(0);
  });

  it("creation rules: email with an account, duplicate pending, and the 50-pending cap return 409", async () => {
    const admin = await adminSession();
    const post = (email: string) => authed("/api/v1/admin/invites", admin, { method: "POST", body: JSON.stringify({ email }) });
    const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

    await createInviteFor(admin, ANA.email);
    const dup = await post(ANA.email.toUpperCase());
    expect(dup.status).toBe(409);
    expect(await code(dup)).toBe("invite_already_pending");

    const adminSelf = await post("ADMIN@example.com");
    expect(await code(adminSelf)).toBe("email_already_registered");
    expect(adminSelf.status).toBe(409);

    // Fill up to the cap with direct inserts, then one more via the API.
    await env.DB.prepare("DELETE FROM invites").run();
    const adminId = (await env.DB.prepare("SELECT id FROM organizers WHERE role = 'admin'").first<{ id: string }>())!.id;
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: MAX_PENDING_INVITES }, (_, i) =>
        env.DB.prepare("INSERT INTO invites (id, token_hash, email, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(
          `inv_fill${i}`, `hash${i}`, `p${i}@example.com`, adminId, now, now + 86_400_000,
        ),
      ),
    );
    const capped = await post("one-more@example.com");
    expect(capped.status).toBe(409);
    expect(await code(capped)).toBe("invite_cap_reached");
    expect(await count("invites")).toBe(MAX_PENDING_INVITES);
  });

  it("an existing account's email can't be invited again", async () => {
    const admin = await adminSession();
    const { token } = await createInviteFor(admin, ANA.email);
    await signIn(ANA, { invite: token });
    const res = await authed("/api/v1/admin/invites", admin, { method: "POST", body: JSON.stringify({ email: ANA.email }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("email_already_registered");
  });

  it("revoking: 204, repeatable, 404 for unknown, 409 once used", async () => {
    const admin = await adminSession();
    const a = await createInviteFor(admin, "a@example.com");
    const del = (id: string) => authed(`/api/v1/admin/invites/${id}`, admin, { method: "DELETE" });
    expect((await del(a.id)).status).toBe(204);
    expect((await del(a.id)).status).toBe(204);
    expect((await del("inv_doesnotexist0000")).status).toBe(404);
    const b = await createInviteFor(admin, ANA.email);
    await signIn(ANA, { invite: b.token });
    expect((await del(b.id)).status).toBe(409);
  });
});

describe("retention: invite purge and session prune", () => {
  const DAY = 86_400_000;
  const insertInvite = (id: string, f: { expires: number; used?: number; revoked?: number }, by: string) =>
    env.DB.prepare(
      "INSERT INTO invites (id, token_hash, email, created_by, created_at, expires_at, used_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
      .bind(id, `hash-${id}`, `${id}@example.com`, by, 0, f.expires, f.used ?? null, f.revoked ?? null)
      .run();
  const inviteIds = async () =>
    ((await env.DB.prepare("SELECT id FROM invites ORDER BY id").all<{ id: string }>()).results ?? []).map((r) => r.id);
  const adminId = async () => (await env.DB.prepare("SELECT id FROM organizers").first<{ id: string }>())!.id;

  async function seedInvites(by: string) {
    const now = Date.now();
    await insertInvite("old-used", { expires: now + DAY, used: now - 31 * DAY }, by);
    await insertInvite("old-revoked", { expires: now + DAY, revoked: now - 31 * DAY }, by);
    await insertInvite("old-expired", { expires: now - 31 * DAY }, by);
    await insertInvite("recent-used", { expires: now + DAY, used: now - 29 * DAY }, by);
    await insertInvite("recent-revoked", { expires: now + DAY, revoked: now - 29 * DAY }, by);
    await insertInvite("recent-expired", { expires: now - 29 * DAY }, by);
    // The end instant is used_at, not the (older) expiry: kept while used_at is recent.
    await insertInvite("used-recently-expired-long-ago", { expires: now - 60 * DAY, used: now - 2 * DAY }, by);
    await insertInvite("pending", { expires: now + 3 * DAY }, by);
  }
  const KEPT = ["pending", "recent-expired", "recent-revoked", "recent-used", "used-recently-expired-long-ago"];

  it("creating an invite deletes invites that ended more than 30 days ago and keeps the rest", async () => {
    const admin = await adminSession();
    await seedInvites(await adminId());
    await createInviteFor(admin, "new@example.com");
    const ids = await inviteIds();
    expect(ids.filter((i) => !i.startsWith("inv_"))).toEqual(KEPT);
    expect(ids).toHaveLength(KEPT.length + 1);
  });

  it("listing invites runs the same purge, and the pending invite is still listed", async () => {
    const admin = await adminSession();
    await seedInvites(await adminId());
    const body = (await (await authed("/api/v1/admin/invites", admin)).json()) as { invites: Array<{ id: string }> };
    expect(await inviteIds()).toEqual(KEPT);
    expect(body.invites.map((i) => i.id)).toEqual(["pending"]);
  });

  it("an invite that ended exactly 30 days ago is kept, one millisecond more is deleted", async () => {
    const admin = await adminSession();
    const by = await adminId();
    const fixed = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(fixed);
    await insertInvite("edge-keep", { expires: fixed + DAY, used: fixed - 30 * DAY }, by);
    await insertInvite("edge-drop", { expires: fixed + DAY, used: fixed - 30 * DAY - 1 }, by);
    await authed("/api/v1/admin/invites", admin);
    expect(await inviteIds()).toEqual(["edge-keep"]);
  });

  it("a new sign-in removes expired sessions of other users and keeps active ones", async () => {
    await adminSession();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org_other', 'sub-o', 'o@example.com', 'Other', 'organizer', 0)",
    ).run();
    const ins = (h: string, exp: number) =>
      env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, 'org_other', 0, ?2)")
        .bind(h, exp)
        .run();
    await ins("expired-other", now - 1);
    await ins("active-other", now + DAY);
    await signIn(ADMIN); // existing account: a new session
    const hashes = ((await env.DB.prepare("SELECT token_hash FROM sessions WHERE organizer_id = 'org_other'").all<{ token_hash: string }>()).results ?? []).map((r) => r.token_hash);
    expect(hashes).toEqual(["active-other"]);
    expect(await count("sessions")).toBe(3); // first admin session, active-other, the new admin session
  });

  it("the prune also runs when an invited person's first sign-in creates the session", async () => {
    const admin = await adminSession();
    await env.DB.prepare(
      "INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org_other', 'sub-o', 'o@example.com', 'Other', 'organizer', 0)",
    ).run();
    await env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES ('stale', 'org_other', 0, 1)").run();
    const { token } = await createInviteFor(admin, ANA.email);
    expect((await signIn(ANA, { invite: token })).location).toBe("/panel");
    expect(await env.DB.prepare("SELECT 1 AS x FROM sessions WHERE token_hash = 'stale'").first()).toBeNull();
  });
});

describe("access control and request guards", () => {
  it("an organizer gets 403 on every admin endpoint, and no session gets 401", async () => {
    const admin = await adminSession();
    const { token, id } = await createInviteFor(admin, ANA.email);
    const org = (await signIn(ANA, { invite: token })).session!;
    const probes: Array<[string, string, unknown?]> = [
      ["GET", "/api/v1/admin/invites"],
      ["POST", "/api/v1/admin/invites", { email: "x@example.com" }],
      ["DELETE", `/api/v1/admin/invites/${id}`],
      ["GET", "/api/v1/admin/anything-else"],
    ];
    for (const [method, path, body] of probes) {
      const init = { method, ...(body ? { body: JSON.stringify(body) } : {}) };
      expect((await authed(path, org, init)).status, `${method} ${path} as organizer`).toBe(403);
      expect((await call(path, { ...init, headers: { origin: ORIGIN, "content-type": "application/json" } })).status, `${method} ${path} anonymous`).toBe(401);
    }
    expect(await count("invites")).toBe(1);
  });

  it("an organizer demoted/deleted in D1 loses access immediately (role is read per request)", async () => {
    const admin = await adminSession();
    await env.DB.prepare("UPDATE organizers SET role = 'organizer'").run();
    expect((await authed("/api/v1/admin/invites", admin)).status).toBe(403);
  });

  it("state-changing requests need a same-origin Origin, JSON content type and a small body", async () => {
    const admin = await adminSession();
    const send = (headers: Record<string, string>, body = JSON.stringify({ email: "n@example.com" })) =>
      call("/api/v1/admin/invites", { method: "POST", headers: { cookie: `__Host-atlas_session=${admin}`, ...headers }, body });
    expect((await send({ "content-type": "application/json" })).status).toBe(403); // no Origin
    expect((await send({ origin: "https://evil.example", "content-type": "application/json" })).status).toBe(403);
    expect((await send({ origin: ORIGIN, "sec-fetch-site": "same-site", "content-type": "application/json" })).status).toBe(403);
    expect((await send({ origin: ORIGIN, "content-type": "text/plain" })).status).toBe(415);
    const big = await send({ origin: ORIGIN, "content-type": "application/json" }, JSON.stringify({ email: "a".repeat(9000) }));
    expect(big.status).toBe(413);
    expect((await send({ origin: ORIGIN, "content-type": "application/json" }, "{not json")).status).toBe(400);
    expect((await send({ origin: ORIGIN, "content-type": "application/json" }, JSON.stringify({ email: "not-an-email" }))).status).toBe(400);
    expect(await count("invites")).toBe(0);
    // Logout is guarded too.
    expect((await call("/api/v1/auth/logout", { method: "POST", headers: { cookie: `__Host-atlas_session=${admin}` } })).status).toBe(403);
    expect(await count("sessions")).toBe(1);
  });

  it("auth, invite and admin responses are never cached", async () => {
    const admin = await adminSession();
    for (const res of [
      await call("/api/v1/auth/me"),
      await authed("/api/v1/admin/invites", admin),
      await jsonPost("/api/v1/invites/inspect", { token: "bad" }),
      await call("/api/v1/auth/google/callback"),
    ]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});
