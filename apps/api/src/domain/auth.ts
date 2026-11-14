import { INVITE_TTL_DAYS, SESSION_TTL_DAYS, type AuthRedirectError, type Role } from "@atlas/contract";

export const DAY_MS = 86_400_000;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * DAY_MS;
export const SESSION_TTL_MS = SESSION_TTL_DAYS * DAY_MS;
/** Privacy notice: invites (and the invitee email in them) are deleted this long after they end. */
export const INVITE_RETENTION_MS = 30 * DAY_MS;
export const CLOCK_SKEW_SECONDS = 60;

/** Trim + lowercase, exact otherwise: no Gmail dot or plus normalization. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Google `name` claim to a safe display name: no control chars, collapsed spaces, max 100; falls back to the email local part. */
export function displayNameFrom(name: unknown, email: string): string {
  const cleaned =
    typeof name === "string" ? name.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 100).trim() : "";
  if (cleaned) return cleaned;
  return (email.split("@")[0] ?? "").slice(0, 100) || "Organizer";
}

// --- Invites -----------------------------------------------------------------------------

export interface InviteState {
  email: string;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}
export type InviteStatus = "valid" | "used" | "revoked" | "expired";

/** Precedence: used > revoked > expired. */
export function inviteStatus(invite: InviteState, now: number): InviteStatus {
  if (invite.usedAt !== null) return "used";
  if (invite.revokedAt !== null) return "revoked";
  if (invite.expiresAt <= now) return "expired";
  return "valid";
}

// --- Sign-in decision ------------------------------------------------------------------------

export type SignInDecision =
  | { kind: "existing" }
  | { kind: "create_admin" }
  | { kind: "accept_invite" }
  | { kind: "reject"; code: AuthRedirectError };

export interface SignInFacts {
  /** An account with this Google `sub` exists. */
  hasAccountForSub: boolean;
  /** Verified Google email (any case). */
  email: string;
  /** `ADMIN_EMAIL` secret (may be undefined or empty when not configured). */
  adminEmail: string | undefined;
  /** The invite carried by the flow, if any (null when none or unknown token). */
  invite: InviteState | null;
  /** True when the flow carried an invite token that matched no invite. */
  inviteTokenUnknown: boolean;
  now: number;
}

/**
 * Order matters: known `sub` first (later sign-ins never look at email), then the configured Admin,
 * then an invite, then nothing. A wrong email never consumes the invite (the caller only consumes on `accept_invite`).
 */
export function decideSignIn(f: SignInFacts): SignInDecision {
  if (f.hasAccountForSub) return { kind: "existing" };
  const email = normalizeEmail(f.email);
  const admin = f.adminEmail ? normalizeEmail(f.adminEmail) : "";
  if (admin && email === admin) return { kind: "create_admin" };
  if (f.inviteTokenUnknown) return { kind: "reject", code: "invite_not_found" };
  if (!f.invite) return { kind: "reject", code: "no_access" };
  const status = inviteStatus(f.invite, f.now);
  if (status === "used") return { kind: "reject", code: "invite_used" };
  if (status === "revoked") return { kind: "reject", code: "invite_revoked" };
  if (status === "expired") return { kind: "reject", code: "invite_expired" };
  if (normalizeEmail(f.invite.email) !== email) return { kind: "reject", code: "invite_email_mismatch" };
  return { kind: "accept_invite" };
}

export function roleFor(decision: SignInDecision): Role {
  return decision.kind === "create_admin" ? "admin" : "organizer";
}

// --- ID token claims -------------------------------------------------------------------------

export type IdTokenFailure =
  | "issuer"
  | "audience"
  | "azp"
  | "expired"
  | "issued_in_future"
  | "nonce"
  | "sub"
  | "email_missing"
  | "email_not_verified";

export interface VerifiedIdentity {
  sub: string;
  email: string;
  name: unknown;
}

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Claim checks after the signature is verified. Returns the identity or the first failing reason. */
export function checkIdTokenClaims(
  claims: Record<string, unknown>,
  expected: { clientId: string; nonce: string; nowSeconds: number },
): { ok: true; identity: VerifiedIdentity } | { ok: false; reason: IdTokenFailure } {
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: "issuer" };
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === expected.clientId : Array.isArray(aud) && aud.includes(expected.clientId);
  if (!audOk) return { ok: false, reason: "audience" };
  if (claims.azp !== undefined && claims.azp !== expected.clientId) return { ok: false, reason: "azp" };
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS <= expected.nowSeconds)
    return { ok: false, reason: "expired" };
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_SECONDS > expected.nowSeconds)
    return { ok: false, reason: "issued_in_future" };
  if (typeof claims.nonce !== "string" || claims.nonce !== expected.nonce) return { ok: false, reason: "nonce" };
  if (typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 255)
    return { ok: false, reason: "sub" };
  if (typeof claims.email !== "string" || claims.email.length === 0 || claims.email.length > 254)
    return { ok: false, reason: "email_missing" };
  if (claims.email_verified !== true) return { ok: false, reason: "email_not_verified" };
  return { ok: true, identity: { sub: claims.sub, email: normalizeEmail(claims.email), name: claims.name } };
}
