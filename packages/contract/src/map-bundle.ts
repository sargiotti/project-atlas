import { z } from "zod";
import {
  DAY_START_REGEX,
  DEFAULT_DAY_START,
  MAX_SESSION_MS,
  UTC_INSTANT_REGEX,
  addDays,
  isValidTimeZone,
  localToUtc,
  parseUtcInstant,
} from "./schedule.ts";
import { fieldErrorSchema } from "./field-errors.ts";

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

export const MAX_SESSIONS_PER_POINT = 150;
export const MAX_SESSIONS_PER_EVENT = 1000;

// No C0 controls or DEL (`\n` is allowed only where stated) and no bidi override/isolate characters.
// eslint-disable-next-line no-control-regex
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/;
// eslint-disable-next-line no-control-regex
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/;

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
    event: eventSchema,
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
    const from = localToUtc(startDate, "00:00", timeZone);
    const until = localToUtc(addDays(endDate, 1), "00:00", timeZone);
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
      if (start !== null && (start < from || start >= until)) issue("start is outside the event dates", "start");
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
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    /** Only on `validation_error` of the panel event endpoints. Codes only, never the submitted values. */
    fields: z.array(fieldErrorSchema).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
