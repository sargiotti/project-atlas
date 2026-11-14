import type { ErrorCode } from "@atlas/contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "./types";

const MESSAGES: Record<ErrorCode, string> = {
  invalid_slug: "Invalid event slug.",
  event_not_found: "Event not found.",
  not_found: "Not found.",
  rate_limited: "Too many requests. Try again later.",
  internal_error: "Internal error.",
  invalid_state: "Sign-in could not be verified.",
  oauth_failed: "Sign-in failed.",
  email_not_verified: "The Google account has no verified email.",
  no_access: "This account has no access.",
  not_configured: "Sign-in is not available here.",
  invite_not_found: "Invite not found.",
  invite_email_mismatch: "This Google account does not match the invite.",
  invite_expired: "This invite has expired.",
  invite_used: "This invite was already used.",
  invite_revoked: "This invite was revoked.",
  unauthenticated: "Sign in required.",
  forbidden: "You do not have access to this.",
  invalid_origin: "Request origin not allowed.",
  unsupported_media_type: "Content-Type must be application/json.",
  payload_too_large: "Request body too large.",
  validation_error: "Invalid request.",
  email_already_registered: "That email already has an account.",
  invite_already_pending: "That email already has a pending invite.",
  invite_cap_reached: "Too many pending invites. Revoke one first.",
};

export function errorResponse(
  c: AppContext,
  status: ContentfulStatusCode,
  code: ErrorCode,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return c.json({ error: { code, message: MESSAGES[code], requestId: c.get("requestId") } }, status, {
    "Cache-Control": cacheControl,
    ...extraHeaders,
  });
}
