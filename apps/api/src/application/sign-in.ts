import { TERMS_VERSION, type AuthRedirectError } from "@atlas/contract";
import type { D1AuthRepository } from "../adapters/d1-auth-repository";
import { randomId, randomToken, sha256Hex } from "../adapters/crypto";
import {
  SESSION_TTL_MS,
  decideSignIn,
  displayNameFrom,
  inviteStatus,
  type VerifiedIdentity,
} from "../domain/auth";

export type SignInResult =
  | { ok: true; sessionToken: string; organizerId: string; expiresAt: number }
  | { ok: false; code: AuthRedirectError };

/**
 * After the Google identity is verified: decide who this is and open a session.
 * A rejected attempt writes nothing (and never consumes an invite).
 */
export async function completeSignIn(
  repo: D1AuthRepository,
  identity: VerifiedIdentity,
  inviteToken: string | null,
  adminEmail: string | undefined,
  now: number,
): Promise<SignInResult> {
  const sessionToken = randomToken();
  const sessionHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_MS;

  const existingId = await repo.findOrganizerIdBySub(identity.sub);
  const inviteHash = inviteToken ? await sha256Hex(inviteToken) : null;
  // The invite is only read when it can matter (a new sub).
  const invite = existingId || !inviteHash ? null : await repo.findInviteByHash(inviteHash);

  const decision = decideSignIn({
    hasAccountForSub: existingId !== null,
    email: identity.email,
    adminEmail,
    invite,
    inviteTokenUnknown: !existingId && inviteHash !== null && invite === null,
    now,
  });

  if (decision.kind === "reject") return { ok: false, code: decision.code };

  if (decision.kind === "existing" && existingId) {
    await repo.createSession(existingId, sessionHash, now, expiresAt);
    return { ok: true, sessionToken, organizerId: existingId, expiresAt };
  }

  const account = {
    organizerId: randomId("org"),
    googleSub: identity.sub,
    email: identity.email,
    displayName: displayNameFrom(identity.name, identity.email),
    now,
    sessionHash,
    sessionExpiresAt: expiresAt,
  };

  try {
    if (decision.kind === "create_admin") {
      await repo.createAdminWithSession(account);
      return { ok: true, sessionToken, organizerId: account.organizerId, expiresAt };
    }
    if (decision.kind === "accept_invite" && inviteHash) {
      if (await repo.acceptInvite(inviteHash, { ...account, termsVersion: TERMS_VERSION, termsAcceptedAt: now })) {
        return { ok: true, sessionToken, organizerId: account.organizerId, expiresAt };
      }
      // Lost the race (or the invite changed since we read it): classify from the current state.
      const current = await repo.findInviteByHash(inviteHash);
      const status = current ? inviteStatus(current, now) : "used";
      return { ok: false, code: status === "revoked" ? "invite_revoked" : status === "expired" ? "invite_expired" : "invite_used" };
    }
  } catch {
    // Unique violation: a concurrent first sign-in of the same account created it between our read and write
    // (the batch rolled back, so the invite is not consumed). Sign in to the existing account if it is the same sub.
    const concurrentId = await repo.findOrganizerIdBySub(identity.sub);
    if (concurrentId) {
      await repo.createSession(concurrentId, sessionHash, now, expiresAt);
      return { ok: true, sessionToken, organizerId: concurrentId, expiresAt };
    }
    return { ok: false, code: "no_access" };
  }
  return { ok: false, code: "no_access" };
}
