import { z } from "zod";
import { eventSummarySchema, MAX_EVENTS_IN_LIST } from "./event-list.ts";

/**
 * Home billboard (slice 37). `GET /api/v1/billboard`: published events that have not ended, grouped in time windows
 * and ordered inside each window (nearby first, then start date, then slug).
 */

/** Time windows, in display order. Computed server-side from each event's dates in the event's own time zone. */
export const BILLBOARD_WINDOWS = ["now", "weekend", "later"] as const;
export const billboardWindowSchema = z.enum(BILLBOARD_WINDOWS);
export type BillboardWindow = z.infer<typeof billboardWindowSchema>;

export type PlaceLang = "en" | "es" | "ca" | "da";

/**
 * The place selector: a fixed list. The API accepts only these ids in `?place=`; it keeps coordinates and country in
 * its own table (never in the request). Names are for display only and are rendered from this list, never from the URL.
 */
export const PLACES = [
  { id: "valencia", names: { en: "Valencia", es: "Valencia", ca: "València", da: "Valencia" } },
  { id: "barcelona", names: { en: "Barcelona", es: "Barcelona", ca: "Barcelona", da: "Barcelona" } },
  { id: "madrid", names: { en: "Madrid", es: "Madrid", ca: "Madrid", da: "Madrid" } },
  { id: "copenhagen", names: { en: "Copenhagen", es: "Copenhague", ca: "Copenhaguen", da: "København" } },
  { id: "galway", names: { en: "Galway", es: "Galway", ca: "Galway", da: "Galway" } },
  { id: "buenos-aires", names: { en: "Buenos Aires", es: "Buenos Aires", ca: "Buenos Aires", da: "Buenos Aires" } },
  { id: "montevideo", names: { en: "Montevideo", es: "Montevideo", ca: "Montevideo", da: "Montevideo" } },
] as const satisfies ReadonlyArray<{ id: string; names: Record<PlaceLang, string> }>;

export type PlaceId = (typeof PLACES)[number]["id"];
export const PLACE_IDS = PLACES.map((p) => p.id) as readonly PlaceId[];

/** Shape of a `?place=` value before the allowlist check. */
export const PLACE_PARAM_REGEX = /^[a-z0-9-]{1,32}$/;

export const placeIdSchema = z.enum(PLACES.map((p) => p.id) as [PlaceId, ...PlaceId[]]);

/** Event on the billboard: the Home summary plus `isDemo` (seeded example event, shown with an "Example" badge). */
export const billboardEventSchema = eventSummarySchema.extend({
  isDemo: z.boolean(),
});
export type BillboardEvent = z.infer<typeof billboardEventSchema>;

export const billboardSchema = z.object({
  /** Only non-empty windows, in the order now, weekend, later. Each event is in exactly one window. */
  windows: z
    .array(z.object({ id: billboardWindowSchema, events: z.array(billboardEventSchema).min(1).max(MAX_EVENTS_IN_LIST) }))
    .max(BILLBOARD_WINDOWS.length),
});
export type Billboard = z.infer<typeof billboardSchema>;
