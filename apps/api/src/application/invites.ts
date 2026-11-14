import type { InspectInviteResponse } from "@atlas/contract";
import type { CreateInviteOutcome, D1AuthRepository } from "../adapters/d1-auth-repository";
import { randomId, randomToken, sha256Hex } from "../adapters/crypto";
import { INVITE_TTL_MS, inviteStatus, normalizeEmail } from "../domain/auth";

export type CreateInviteResult =
  | { ok: true; id: string; email: string; token: string; createdAt: number; expiresAt: number }
  | { ok: false; code: Exclude<CreateInviteOutcome, "created"> };

export async function createInvite(
  repo: D1AuthRepository,
  adminId: string,
  email: string,
  adminEmail: string | undefined,
  now: number,
): Promise<CreateInviteResult> {
  await repo.purgeEndedInvites(now);
  const normalized = normalizeEmail(email);
  // The configured Admin email is an account in waiting: inviting it would be the same as "already registered".
  if (adminEmail && normalizeEmail(adminEmail) === normalized) return { ok: false, code: "email_already_registered" };
  const token = randomToken();
  const id = randomId("inv");
  const expiresAt = now + INVITE_TTL_MS;
  const outcome = await repo.createInvite({
    id,
    tokenHash: await sha256Hex(token),
    email: normalized,
    createdBy: adminId,
    now,
    expiresAt,
  });
  if (outcome !== "created") return { ok: false, code: outcome };
  return { ok: true, id, email: normalized, token, createdAt: now, expiresAt };
}

/** Public invite page data. Only a valid invite reveals its email and the inviter's name. */
export async function inspectInvite(
  repo: D1AuthRepository,
  token: string,
  now: number,
): Promise<InspectInviteResponse | null> {
  const invite = await repo.findInviteByHash(await sha256Hex(token));
  if (!invite) return null;
  const status = inviteStatus(invite, now);
  if (status === "valid") return { status, email: invite.email, inviterName: invite.inviterName };
  return { status };
}
