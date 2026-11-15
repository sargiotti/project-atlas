import type { FieldError } from "@atlas/contract";
import type { RefusalReason } from "../domain/publication";
import { errorResponse } from "./errors";
import type { AppContext } from "./types";

const NO_STORE = "private, no-store";

/** Seconds until the next UTC midnight (when the daily transition cap resets). */
function secondsToUtcMidnight(now: number): number {
  const d = new Date(now);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
}

/** Maps a refused transition to its HTTP answer. Never echoes user text. */
export function refusalResponse(c: AppContext, reason: RefusalReason | "validation_error", fields?: FieldError[]): Response {
  switch (reason) {
    case "not_found":
      return errorResponse(c, 404, "event_not_found", NO_STORE);
    case "invalid_transition":
      return errorResponse(c, 409, "invalid_transition", NO_STORE);
    case "event_changed":
      return errorResponse(c, 409, "event_changed", NO_STORE);
    case "map_required":
      return errorResponse(c, 409, "map_required", NO_STORE);
    case "cap_reached":
      return errorResponse(c, 429, "transition_cap_reached", NO_STORE, { "Retry-After": String(secondsToUtcMidnight(Date.now())) });
    case "validation_error":
      return errorResponse(c, 400, "validation_error", NO_STORE, {}, fields);
  }
}

/** One privacy-safe line per publish-flow action: ids and codes only, never the reason text or event content. */
export function logPublication(c: AppContext, action: string, outcome: string, eventId: string): void {
  console.log(
    `[publication] requestId=${c.get("requestId")} action=${action} outcome=${outcome} actor=${c.get("user").id} event=${eventId}`,
  );
}
