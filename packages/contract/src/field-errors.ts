import { z } from "zod";

/** Stable codes for `400 validation_error` field errors. The SPA maps them to en/es/da text. */
export const FIELD_ERROR_CODES = [
  "required",
  "too_short",
  "too_long",
  "invalid",
  "invalid_date",
  "end_before_start",
  "span_too_long",
  "invalid_time_zone",
  "invalid_country",
  "invalid_language",
  "website_not_https",
  "invalid_url",
  "control_chars",
  /** Slice 08d: the venue address contains a URL (`://` or starts with `www.`). */
  "address_has_url",
  /** Slice 13: a Session overlaps another one at the same Point (half-open; touching is fine). On the later item's `start`. */
  "overlap",
  /** Slice 13: a Session starts outside the Event's window (see `sessionWindow`). */
  "outside_dates",
  "unknown_field",
] as const;
export type FieldErrorCode = (typeof FIELD_ERROR_CODES)[number];

export const EVENT_INPUT_FIELDS = [
  "name",
  "startDate",
  "endDate",
  "timeZone",
  "city",
  "country",
  "language",
  "description",
  "website",
  "venueAddress",
] as const;
export type EventInputField = (typeof EVENT_INPUT_FIELDS)[number];

/** Slice 08c: fields of one item of the points save body. */
export const POINT_INPUT_FIELDS = ["id", "category", "name", "description", "x", "y"] as const;

/** Slice 13: fields of one item of the sessions save body. */
export const SESSION_INPUT_FIELDS = ["id", "pointId", "title", "start", "end", "description"] as const;
/** At most 1000 Sessions per event: item indexes 0-999. */
export const SESSION_PATH_MAX_INDEX = 999;

export const fieldErrorSchema = z.object({
  /**
   * An input field, `reason` / `updatedAt` (slice 08b decision bodies), or `body` for errors about the object as a
   * whole (unknown keys, not an object). Slice 08c: `baseUpdatedAt`, `points` (the list as a whole) and indexed
   * item fields such as `points.3.name`.
   */
  path: z.union([
    z.enum([...EVENT_INPUT_FIELDS, "reason", "updatedAt", "body", "baseUpdatedAt", "points", "deleteSessionsOf", "sessions", "email", "eventName", "eventDate", "role", "message", "elapsedMs", "turnstileToken"]),
    z.templateLiteral(["points.", z.number().int().min(0).max(499), ".", z.enum(POINT_INPUT_FIELDS)]),
    z.templateLiteral(["sessions.", z.number().int().min(0).max(SESSION_PATH_MAX_INDEX), ".", z.enum(SESSION_INPUT_FIELDS)]),
  ]),
  code: z.enum(FIELD_ERROR_CODES),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;
