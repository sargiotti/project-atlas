import { z } from "zod";
import {
  DAY_START_REGEX,
  DEFAULT_DAY_START,
  MAX_SESSION_MS,
  UTC_INSTANT_REGEX,
  isInSessionWindow,
  isValidTimeZone,
  parseUtcInstant,
  sessionWindow,
} from "./schedule.ts";
import { fieldErrorSchema } from "./field-errors.ts";
import { coverImageSchema, toneSchema } from "./cover.ts";
import { FORBIDDEN_MULTI_LINE, FORBIDDEN_SINGLE_LINE } from "./text-rules.ts";

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
  // Slice 09. Appended: display order is this order. Circle marker, "things to do".
  "landmark",
] as const;

export const pointCategorySchema = z.enum(POINT_CATEGORIES);
export type PointCategory = z.infer<typeof pointCategorySchema>;

export const MAX_POINTS_PER_MAP = 500;

/** Slice 08c. Name-it categories need a custom name (1-80). Just-drop categories may have `name: null` (no custom name). */
export const NAME_IT_CATEGORIES = ["stage", "food", "drinks", "merch", "landmark"] as const;
export const JUST_DROP_CATEGORIES = ["toilets", "first-aid", "info", "entrance-exit"] as const;
export const isJustDropCategory = (c: string): boolean => (JUST_DROP_CATEGORIES as readonly string[]).includes(c);

export const mapThemeSchema = z.enum(["light", "dark"]);
export type MapTheme = z.infer<typeof mapThemeSchema>;

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Language of the event content (not of the UI). */
export const contentLanguageSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

export const timeZoneSchema = z.string().max(64).refine(isValidTimeZone, "Unknown IANA time zone");

export const eventSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1).max(120),
    startDate: isoDate,
    endDate: isoDate,
    language: contentLanguageSchema,
    /** IANA zone of the Event (slice 09). Instants are shown in this zone. Absent in older payloads: UTC. */
    timeZone: timeZoneSchema.default("UTC"),
    /** `HH:MM` in `timeZone`. A session starting earlier belongs to the previous day's grid. */
    dayStart: z.string().regex(DAY_START_REGEX, "Expected HH:MM").default(DEFAULT_DAY_START),
  })
  .refine((e) => e.endDate >= e.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type EventInfo = z.infer<typeof eventSchema>;

/**
 * Slice 08d: the About-sheet fields of the public bundle and of the owner preview / Admin review. All organizer text,
 * so the output checks apply (a poisoned or legacy row never reaches visitors). Server always sends city and country;
 * they are optional here only so a stale cached bundle (service worker) still parses on the client.
 */
export const eventAboutSchema = z.object({
  city: z
    .string()
    .min(1)
    .max(80)
    .refine((s) => !FORBIDDEN_SINGLE_LINE.test(s), "control or bidi characters not allowed")
    .optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  /** Plain text, `
` allowed. Render as text, never as HTML; URLs are not links. Omitted when none. */
  description: z
    .string()
    .max(500)
    .refine((s) => !FORBIDDEN_MULTI_LINE.test(s), "control or bidi characters not allowed")
    .optional(),
  /** https only, stored as URL.href. Omitted when none. */
  website: z
    .string()
    .max(200)
    .refine((s) => {
      if (!s.startsWith("https://")) return false;
      try {
        return new URL(s).protocol === "https:";
      } catch {
        return false;
      }
    }, "website must be an https URL")
    .optional(),
  /** Single line, plain text. Omitted when none. */
  venueAddress: z
    .string()
    .min(1)
    .max(120)
    .refine((s) => !FORBIDDEN_SINGLE_LINE.test(s), "control or bidi characters not allowed")
    .optional(),
  /**
   * Slice 14: the cover (null: none) and the tone (0-7) for the colour cover. The server always sends both; optional here
   * only so a stale cached bundle still parses.
   */
  cover: coverImageSchema.nullable().optional(),
  tone: toneSchema.optional(),
});
export type EventAbout = z.infer<typeof eventAboutSchema>;

export const imageVariantSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive(),
});

export const mapImageSchema = z.object({
  format: z.enum(["svg", "webp", "jpeg"]),
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

export const POINT_NAME_MAX = 80;
export const POINT_DESCRIPTION_MAX = 500;

/**
 * `name` is null for a Just-drop Point without a custom name (slice 08c): clients show the category label in the
 * viewer's language. As an output check the text blocklists apply too, so a poisoned row can never reach visitors.
 */
export const pointSchema = z
  .object({
    id: pointIdSchema,
    name: z.string().min(1).max(POINT_NAME_MAX).nullable(),
    category: pointCategorySchema,
    /** Plain text. Render as text, never as HTML. */
    description: z.string().max(POINT_DESCRIPTION_MAX),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .superRefine((p, ctx) => {
    if (p.name === null) {
      if (!isJustDropCategory(p.category)) ctx.addIssue({ code: "custom", message: "name required for this category", path: ["name"] });
    } else if (FORBIDDEN_SINGLE_LINE.test(p.name)) {
      ctx.addIssue({ code: "custom", message: "control or bidi characters not allowed", path: ["name"] });
    }
    if (FORBIDDEN_MULTI_LINE.test(p.description)) {
      ctx.addIssue({ code: "custom", message: "control or bidi characters not allowed", path: ["description"] });
    }
  });
export type Point = z.infer<typeof pointSchema>;

export const MAX_SESSIONS_PER_POINT = 150;
export const MAX_SESSIONS_PER_EVENT = 1000;

// No C0 controls or DEL (a newline is allowed only where stated), no bidi or invisible characters: see text-rules.ts.
const SINGLE_LINE_FORBIDDEN = FORBIDDEN_SINGLE_LINE;
const MULTI_LINE_FORBIDDEN = FORBIDDEN_MULTI_LINE;

const utcInstantSchema = z
  .string()
  .regex(UTC_INSTANT_REGEX, "Expected YYYY-MM-DDTHH:MM:SSZ")
  .refine((v) => parseUtcInstant(v) !== null, "Not a real instant");

/** A programme item at a Point (a set, a mass, a race wave). All text is untrusted: render as text only. */
export const sessionSchema = z
  .object({
    /** Opaque and globally unique. Same format as point ids. Used in `.ics` UIDs and file names. */
    id: pointIdSchema,
    pointId: pointIdSchema,
    /** Single line, trimmed, 1-120 chars. */
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((s) => !SINGLE_LINE_FORBIDDEN.test(s), "control or bidi characters not allowed"),
    /** UTC, second precision, `Z`. */
    start: utcInstantSchema,
    end: utcInstantSchema,
    /** Plain text, optional (omitted when empty), at most 300 chars, `\n` allowed. */
    description: z
      .string()
      .max(300)
      .refine((s) => !MULTI_LINE_FORBIDDEN.test(s), "control or bidi characters not allowed")
      .optional(),
  })
  .superRefine((s, ctx) => {
    const a = parseUtcInstant(s.start);
    const b = parseUtcInstant(s.end);
    if (a === null || b === null) return;
    if (b <= a) ctx.addIssue({ code: "custom", message: "end must be after start", path: ["end"] });
    else if (b - a > MAX_SESSION_MS) ctx.addIssue({ code: "custom", message: "at most 24 h", path: ["end"] });
  });
export type Session = z.infer<typeof sessionSchema>;

export const mapBundleSchema = z
  .object({
    event: eventSchema.and(eventAboutSchema),
    map: eventMapSchema,
    points: z.array(pointSchema).max(MAX_POINTS_PER_MAP),
    /** Slice 09. Sorted by start, end, id. Absent in older payloads (a stale cached bundle): no sessions. */
    sessions: z.array(sessionSchema).max(MAX_SESSIONS_PER_EVENT).default([]),
  })
  .superRefine((bundle, ctx) => {
    const pointIds = new Set(bundle.points.map((p) => p.id));
    const perPoint = new Map<string, number>();
    const seen = new Set<string>();
    // `start` must fall on startDate..endDate in the Event's zone (`end` may run past it).
    const { timeZone, startDate, endDate } = bundle.event;
    // Field errors (bad zone or dates) are reported by their own schemas; do not run date maths on them.
    if (!isValidTimeZone(timeZone) || !isoDate.safeParse(startDate).success || !isoDate.safeParse(endDate).success) return;
    const window = sessionWindow(startDate, endDate, bundle.event.dayStart, timeZone);
    bundle.sessions.forEach((s, i) => {
      const issue = (message: string, key: string) =>
        ctx.addIssue({ code: "custom", message, path: ["sessions", i, key] });
      if (!pointIds.has(s.pointId)) issue("pointId is not a point of this map", "pointId");
      if (seen.has(s.id)) issue("duplicate session id", "id");
      seen.add(s.id);
      const n = (perPoint.get(s.pointId) ?? 0) + 1;
      perPoint.set(s.pointId, n);
      if (n === MAX_SESSIONS_PER_POINT + 1) issue(`more than ${MAX_SESSIONS_PER_POINT} sessions at one point`, "pointId");
      const start = parseUtcInstant(s.start);
      if (start !== null && !isInSessionWindow(start, window)) issue("start is outside the event dates", "start");
    });
  });
export type MapBundle = z.infer<typeof mapBundleSchema>;

export const ERROR_CODES = [
  "invalid_slug",
  "event_not_found",
  "not_found",
  "rate_limited",
  "internal_error",
  // Slice 06 (organizer accounts). The first group is also used as `?error=` on the login/invite redirects.
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
  // JSON API errors of the invite/admin/auth endpoints.
  "unauthenticated",
  "forbidden",
  "invalid_origin",
  "unsupported_media_type",
  "payload_too_large",
  "validation_error",
  "email_already_registered",
  "invite_already_pending",
  "invite_cap_reached",
  // Slice 07 (organizer events).
  "event_limit_reached",
  // Slice 08a (map upload). `event_not_draft` is no longer returned since 08b (edits are allowed in every status).
  "event_not_draft",
  "map_changed",
  "map_not_found",
  // Slice 14 (event cover). `cover_changed`: a concurrent replace won or `baseVersion` is stale (retryable after reload).
  "cover_not_found",
  "cover_changed",
  "unsupported_image_type",
  "invalid_upload",
  // Slice 08b (publish with Admin approval).
  "invalid_transition",
  "event_changed",
  "map_required",
  "transition_cap_reached",
  // Slice 08c (points editor): publish-request with 0 Points.
  "points_required",
  // Slice 13 (schedule editor). `point_has_sessions`: Points PUT would delete (without `deleteSessionsOf`) or recategorize a
  // Point that has Sessions. `sessions_outside_dates`: an event edit would leave Sessions outside the new window.
  "point_has_sessions",
  "sessions_outside_dates",
  // Slice 30 (organizer form). submission_rejected: too fast or Turnstile refused (one generic answer). daily_cap_reached: global cap of stored requests.
  "submission_rejected",
  "service_unavailable",
  "daily_cap_reached",
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Slice 08a: why an upload was refused (`error.reason` of `invalid_upload`). Stable codes, never user text. */
export const INVALID_UPLOAD_REASONS = [
  "missing_part",
  "unknown_part",
  "bad_theme",
  "corrupt_image",
  "mixed_formats",
  "full_size_out_of_range",
  "small_size_out_of_range",
  "aspect_out_of_range",
  "aspect_mismatch",
  "metadata_present",
  // Slice 14 (event cover).
  "og_size_invalid",
  "og_not_baseline",
  "animated_image",
  "bad_focal",
] as const;
export const invalidUploadReasonSchema = z.enum(INVALID_UPLOAD_REASONS);
export type InvalidUploadReason = z.infer<typeof invalidUploadReasonSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Only on `invalid_upload`. */
    reason: invalidUploadReasonSchema.optional(),
    message: z.string(),
    requestId: z.string(),
    /** Only on `validation_error` of the panel event endpoints. Codes only, never the submitted values. */
    fields: z.array(fieldErrorSchema).optional(),
    /** Only on 409 `point_has_sessions`: the Points that block the save and how many Sessions each has. */
    affected: z.array(z.object({ pointId: z.string(), sessions: z.number().int().min(1) })).max(MAX_POINTS_PER_MAP).optional(),
    /** Only on 409 `sessions_outside_dates`: how many stored Sessions would fall outside the new dates. */
    count: z.number().int().min(1).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
