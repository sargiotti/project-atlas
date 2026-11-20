import { z } from "zod";

/** Slice 06: organizer accounts. Timestamps in the API are ISO 8601 UTC strings. */

export const MAX_PENDING_INVITES = 50;
export const INVITE_TTL_DAYS = 7;
export const SESSION_TTL_DAYS = 7;

/** Slice 32: version of the Terms of use text (date-based). Shown on /terms and stored on the account at invite acceptance. */
export const TERMS_VERSION = "2026-11-20";

/** Invite token: 32 random bytes, base64url without padding (43 chars). */
export const INVITE_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_REGEX, "Invalid invite token");

/** Trimmed, lowercased, max 254 chars (RFC 5321). No Gmail dot/plus normalization. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const roleSchema = z.enum(["admin", "organizer"]);
export type Role = z.infer<typeof roleSchema>;

/** Values of `?error=` on `/panel/login` and `/panel/invite/{token}` after the Google callback. */
export const AUTH_REDIRECT_ERRORS = [
  "invalid_state",
  "oauth_failed",
  "email_not_verified",
  "no_access",
  "not_configured",
  "invite_not_found",
  "invite_email_mismatch",
  "invite_expired",
  "invite_used",
  "invite_revoked",
  "terms_not_accepted",
] as const;
export const authRedirectErrorSchema = z.enum(AUTH_REDIRECT_ERRORS);
export type AuthRedirectError = z.infer<typeof authRedirectErrorSchema>;

// GET /api/v1/auth/me
export const organizerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).max(100),
  email: z.string(),
  role: roleSchema,
});
export type Organizer = z.infer<typeof organizerSchema>;
export const meResponseSchema = z.object({
  organizer: organizerSchema,
  /** Slice 08b. Admins only: events In review (the badge on the avatar and the Pending menu item). */
  pendingCount: z.number().int().nonnegative().optional(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// POST /api/v1/invites/inspect (public; the token is the credential)
export const inspectInviteRequestSchema = z.object({ token: inviteTokenSchema });
export const inspectInviteResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid"), email: z.string(), inviterName: z.string() }),
  z.object({ status: z.enum(["used", "expired", "revoked"]) }),
]);
export type InspectInviteResponse = z.infer<typeof inspectInviteResponseSchema>;

// Admin: /api/v1/admin/invites
export const createInviteRequestSchema = z.object({ email: emailSchema });
export const inviteSummarySchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type InviteSummary = z.infer<typeof inviteSummarySchema>;
export const createInviteResponseSchema = z.object({
  invite: inviteSummarySchema,
  /** `/panel/invite/{token}`. Shown once; build the link with `window.location.origin`. */
  invitePath: z.string().regex(/^\/panel\/invite\/[A-Za-z0-9_-]{43}$/),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;
export const inviteListResponseSchema = z.object({
  invites: z.array(inviteSummarySchema).max(MAX_PENDING_INVITES),
});
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;
