import { z } from "zod";
import { coverImageSchema, toneSchema } from "./cover.ts";
import { isoDate, slugSchema } from "./map-bundle.ts";

/** Hard cap on the list endpoint (no pagination yet). */
export const MAX_EVENTS_IN_LIST = 50;

/**
 * `?near=` override for /api/v1/events (slice 03): `none` or an ISO 3166-1 alpha-2 code.
 * Applied after uppercasing the value. Anything else is ignored by the API.
 */
export const NEAR_OVERRIDE_REGEX = /^(NONE|[A-Z]{2})$/;

/** Location-free part of an event summary (what the API caches and shares between visitors). */
export const eventSummaryBaseSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(120),
  startDate: isoDate,
  endDate: isoDate,
  /** Plain text as written by the organizer (not translated). Render as text. */
  city: z.string().min(1).max(80),
  /** ISO 3166-1 alpha-2. Show the localized name via Intl.DisplayNames. */
  country: z.string().regex(/^[A-Z]{2}$/),
  /** Slice 14: uploaded cover, or null (clients draw the colour cover of `tone`). */
  cover: coverImageSchema.nullable(),
  /** Slice 14: 0-7, from the event id (`toneOf`). The id itself is not public. */
  tone: toneSchema,
});
export type EventSummaryBase = z.infer<typeof eventSummaryBaseSchema>;

/** Public summary of an event for the home page cards. Unknown keys are stripped. */
export const eventSummarySchema = eventSummaryBaseSchema.extend({
  /** True when the event is near the visitor (coarse, server-side). Never reveals where the visitor is. */
  nearby: z.boolean(),
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventListSchema = z.array(eventSummarySchema).max(MAX_EVENTS_IN_LIST);
export type EventList = z.infer<typeof eventListSchema>;
