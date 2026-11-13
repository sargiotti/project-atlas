import { z } from "zod";
import { isoDate, slugSchema } from "./map-bundle.ts";

/** Hard cap on the list endpoint (no pagination yet). */
export const MAX_EVENTS_IN_LIST = 50;

/** Same-origin, content-hashed cover file: `/covers/{slug}.{hash8}.webp`. */
export const COVER_URL_REGEX = /^\/covers\/[a-z0-9]+(-[a-z0-9]+)*\.[0-9a-f]{8}\.webp$/;

export const coverImageSchema = z.object({
  url: z.string().regex(COVER_URL_REGEX, "Invalid cover URL"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CoverImage = z.infer<typeof coverImageSchema>;

/** Public summary of an event for the home page cards. Unknown keys are stripped. */
export const eventSummarySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  startDate: isoDate,
  endDate: isoDate,
  /** Plain text as written by the organizer (not translated). Render as text. */
  city: z.string().min(1).max(80),
  /** ISO 3166-1 alpha-2. Show the localized name via Intl.DisplayNames. */
  country: z.string().regex(/^[A-Z]{2}$/),
  cover: coverImageSchema.nullable(),
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventListSchema = z.array(eventSummarySchema).max(MAX_EVENTS_IN_LIST);
export type EventList = z.infer<typeof eventListSchema>;
