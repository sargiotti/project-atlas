import { z } from "zod";

export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .min(3)
  .max(60)
  .regex(SLUG_REGEX, "Invalid slug");

/** Display order. Points are sorted by this order, then name, then id. */
export const POINT_CATEGORIES = [
  "stage",
  "food",
  "drinks",
  "toilets",
  "first-aid",
  "info",
  "entrance-exit",
  "merch",
] as const;

export const pointCategorySchema = z.enum(POINT_CATEGORIES);
export type PointCategory = z.infer<typeof pointCategorySchema>;

export const MAX_POINTS_PER_MAP = 500;

export const mapThemeSchema = z.enum(["light", "dark"]);
export type MapTheme = z.infer<typeof mapThemeSchema>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Language of the event content (not of the UI). */
export const contentLanguageSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

export const eventSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
    language: contentLanguageSchema,
  })
  .refine((e) => e.endDate >= e.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type EventInfo = z.infer<typeof eventSchema>;

export const imageVariantSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive(),
});

export const mapImageSchema = z.object({
  format: z.enum(["svg", "webp"]),
  variants: z.array(imageVariantSchema).min(1),
});

export const eventMapSchema = z.object({
  id: z.string().min(1),
  theme: mapThemeSchema,
  width: z.number().positive(),
  height: z.number().positive(),
  image: mapImageSchema,
});

export const pointIdSchema = z.string().regex(/^[a-z0-9_-]{1,64}$/);

export const pointSchema = z.object({
  id: pointIdSchema,
  name: z.string().min(1).max(80),
  category: pointCategorySchema,
  /** Plain text. Render as text, never as HTML. */
  description: z.string().max(500),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type Point = z.infer<typeof pointSchema>;

export const mapBundleSchema = z.object({
  event: eventSchema,
  map: eventMapSchema,
  points: z.array(pointSchema).max(MAX_POINTS_PER_MAP),
});
export type MapBundle = z.infer<typeof mapBundleSchema>;

export const ERROR_CODES = [
  "invalid_slug",
  "event_not_found",
  "not_found",
  "rate_limited",
  "internal_error",
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
