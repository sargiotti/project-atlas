import { checkIdTokenClaims, type IdTokenFailure, type VerifiedIdentity } from "../domain/auth";
import { fromBase64Url, sha256Base64Url } from "./crypto";

/**
 * Google OpenID Connect (authorization code + PKCE), hand-rolled on WebCrypto: no OAuth/JWT library.
 * Fixed endpoints (never taken from input).
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

const TEXT = new TextDecoder();
const FETCH_TIMEOUT_MS = 5000;
/** Never refetch the JWKS more often than this, even for unknown `kid`s (a forged `kid` can't cause a fetch storm). */
const JWKS_MIN_REFETCH_MS = 60_000;
const JWKS_DEFAULT_TTL_MS = 3_600_000;
const JWKS_MAX_TTL_MS = 6 * 3_600_000;

export async function buildAuthorizationUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}): Promise<string> {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", await sha256Base64Url(p.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/** Server-to-server code exchange. Returns the raw ID token string or null on any failure. */
export async function exchangeCode(p: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: p.code,
        code_verifier: p.codeVerifier,
        client_id: p.clientId,
        client_secret: p.clientSecret,
        redirect_uri: p.redirectUri,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id_token?: unknown };
    return typeof body.id_token === "string" ? body.id_token : null;
  } catch {
    return null;
  }
}

// --- JWKS (cached per isolate by kid) ------------------------------------------------------------

interface JwksCache {
  keys: Map<string, CryptoKey>;
  expiresAt: number;
  fetchedAt: number;
}
let jwksCache: JwksCache | null = null;

export function clearJwksCache(): void {
  jwksCache = null;
}

async function refreshJwks(now: number): Promise<void> {
  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error("jwks fetch failed");
  const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string" || (jwk.alg !== undefined && jwk.alg !== "RS256")) continue;
    try {
      keys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          "jwk",
          { kty: "RSA", n: jwk.n as string, e: jwk.e as string, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
      );
    } catch {
      // Skip a malformed key; the others stay usable.
    }
  }
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1];
  const ttl = maxAge ? Math.min(Number(maxAge) * 1000, JWKS_MAX_TTL_MS) : JWKS_DEFAULT_TTL_MS;
  jwksCache = { keys, expiresAt: now + ttl, fetchedAt: now };
}

async function keyFor(kid: string, now: number): Promise<CryptoKey | null> {
  if (jwksCache && jwksCache.expiresAt > now) {
    const hit = jwksCache.keys.get(kid);
    if (hit) return hit;
    if (now - jwksCache.fetchedAt < JWKS_MIN_REFETCH_MS) return null;
  }
  await refreshJwks(now);
  return jwksCache?.keys.get(kid) ?? null;
}

// --- ID token ------------------------------------------------------------------------------

export type IdTokenResult =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: IdTokenFailure | "malformed" | "alg" | "signature" | "key_unavailable" };

function parseJson(b64: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(TEXT.decode(fromBase64Url(b64)));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Verifies the RS256 signature (alg pinned) and then the claims. Any failure means no session. */
export async function verifyIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  nowMs: number = Date.now(),
): Promise<IdTokenResult> {
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  const header = parseJson(h);
  const claims = parseJson(p);
  if (!header || !claims) return { ok: false, reason: "malformed" };
  if (header.alg !== "RS256") return { ok: false, reason: "alg" };
  if (typeof header.kid !== "string") return { ok: false, reason: "malformed" };

  let key: CryptoKey | null;
  try {
    key = await keyFor(header.kid, nowMs);
  } catch {
    return { ok: false, reason: "key_unavailable" };
  }
  if (!key) return { ok: false, reason: "key_unavailable" };

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    fromBase64Url(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) return { ok: false, reason: "signature" };

  return checkIdTokenClaims(claims, { ...expected, nowSeconds: Math.floor(nowMs / 1000) });
}
