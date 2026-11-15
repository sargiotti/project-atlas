import type { ErrorCode, FieldError, InvalidUploadReason } from "@atlas/contract";
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
  event_limit_reached: "You reached the limit of 10 events.",
  event_not_draft: "Only draft events can change their map.", // unused since slice 08b
  map_changed: "The map was changed by another request. Reload and try again.",
  map_not_found: "This event has no map.",
  unsupported_image_type: "Unsupported image type.",
  invalid_upload: "The uploaded image was refused.",
  invalid_transition: "This action is not possible in the event's current state.",
  event_changed: "The event changed. Reload and try again.",
  map_required: "Upload a map before publishing.",
  transition_cap_reached: "Too many publish actions today. Try again tomorrow.",
};

export function errorResponse(
  c: AppContext,
  status: ContentfulStatusCode,
  code: ErrorCode,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
  fields?: FieldError[],
  reason?: InvalidUploadReason,
): Response {
  return c.json({ error: { code, ...(reason ? { reason } : {}), message: MESSAGES[code], requestId: c.get("requestId"), ...(fields ? { fields } : {}) } }, status, {
    "Cache-Control": cacheControl,
    ...extraHeaders,
  });
}
