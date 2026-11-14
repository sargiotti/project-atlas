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
] as const;
export type EventInputField = (typeof EVENT_INPUT_FIELDS)[number];

export const fieldErrorSchema = z.object({
  /** An input field, or `body` for errors about the object as a whole (unknown keys, not an object). */
  path: z.enum([...EVENT_INPUT_FIELDS, "body"]),
  code: z.enum(FIELD_ERROR_CODES),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;
