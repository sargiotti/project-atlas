import { z } from "zod";
import { EVENT_INPUT_FIELDS, FIELD_ERROR_CODES, type EventInputField, type FieldError, type FieldErrorCode } from "./field-errors.ts";
import { EVENT_TIME_ZONES } from "./time-zones.ts";
import { eventMapSchema, eventSchema, mapThemeSchema, pointSchema, sessionSchema, slugSchema } from "./map-bundle.ts";

const FIELD_CODE_SET: ReadonlySet<string> = new Set(FIELD_ERROR_CODES);

/** Slice 07: organizer events (drafts). Timestamps in the API are ISO 8601 UTC strings. */

export const MAX_EVENTS_PER_ORGANIZER = 10;
/** endDate - startDate <= 30 days (= 31 calendar days inclusive). */
export const MAX_EVENT_SPAN_DAYS = 30;
export const EVENT_LANGUAGES = ["en", "es", "da"] as const;
export const eventLanguageSchema = z.enum(EVENT_LANGUAGES, { error: (iss) => (iss.input === undefined ? "required" : "invalid_language") });

/** Assigned ISO 3166-1 alpha-2 codes (249). Fixed list: the web country dropdown uses it too. */
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

// --- Text rules ------------------------------------------------------------------------------
// Forbidden in every text field: C0/C1 controls, DEL, bidi controls (U+200E/F, U+202A-E, U+2066-9),
// zero-width (U+200B-D, U+2060, U+FEFF), U+2028/2029. The description additionally allows `\n`.
/* eslint-disable no-control-regex */
const FORBIDDEN_SINGLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;
const FORBIDDEN_MULTI = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/;
const URL_BAD = /[\s\u0000-\u001f\u007f-\u009f]/;
/* eslint-enable no-control-regex */

/** What the server measures and stores: NFC, `\r\n` as `\n`, trimmed. The form must count the same way. */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\r\n/g, "\n").trim();
}

const requiredOrInvalid = { error: (iss: { input?: unknown }) => (iss.input === undefined ? "required" : "invalid") };

function text(min: number, max: number, multiline: boolean) {
  return z
    .string(requiredOrInvalid)
    .transform(normalizeText)
    .pipe(
      z
        .string()
        .min(min, "too_short")
        .max(max, "too_long")
        .refine((s) => !(multiline ? FORBIDDEN_MULTI : FORBIDDEN_SINGLE).test(s), "control_chars"),
    );
}

/** Real calendar day (`2026-02-30` is rejected), year 2000-2099. */
export const realIsoDate = z
  .string(requiredOrInvalid)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "invalid_date")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    if (y < 2000 || y > 2099) return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "invalid_date");

function utcDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

let zoneSet: ReadonlySet<string> | null = null;
function allowedZones(): ReadonlySet<string> {
  if (!zoneSet) {
    // Environments without supportedValuesOf (Safari < 15.4) fall back to the fixed list.
    const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : EVENT_TIME_ZONES;
    zoneSet = new Set([...supported, "UTC"]);
  }
  return zoneSet;
}

/**
 * Resolves a time zone to the runtime's canonical IANA name (Europe/Kyiv -> Europe/Kiev in V8), or null when
 * it is not a supported zone. Raw offsets such as "+05:00" are rejected.
 */
export function canonicalTimeZone(zone: string): string | null {
  try {
    const canon = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
    return allowedZones().has(canon) ? canon : null;
  } catch {
    return null;
  }
}
export function isAllowedTimeZone(zone: string): boolean {
  return canonicalTimeZone(zone) !== null;
}
/** Output (the stored value) is the canonical name, so browser-modern and legacy spellings store identically. */
export const eventTimeZoneSchema = z.string(requiredOrInvalid).transform((zone, ctx) => {
  const canon = canonicalTimeZone(zone);
  if (canon === null) {
    ctx.addIssue({ code: "custom", message: "invalid_time_zone" });
    return z.NEVER;
  }
  return canon;
});

export const WEBSITE_MAX = 200;

/**
 * Website: https only, no userinfo, a host with a dot, no IP literal or localhost, no whitespace or
 * control characters (checked before `new URL`, which silently drops tabs and newlines). The value
 * becomes `url.href`, which must also fit in 200 characters.
 */
const websiteSchema = z
  .string(requiredOrInvalid)
  .transform((s) => s.trim())
  .pipe(
    z.string().superRefine((raw, ctx) => {
      const bad = (code: FieldErrorCode) => ctx.addIssue({ code: "custom", message: code });
      if (raw.length > WEBSITE_MAX) return bad("too_long");
      if (FORBIDDEN_SINGLE.test(raw)) return bad("control_chars");
      if (URL_BAD.test(raw)) return bad("invalid_url");
      if (!/^https:\/\//i.test(raw)) return bad("website_not_https");
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return bad("invalid_url");
      }
      const host = url.hostname;
      const ipLike = host.startsWith("[") || /^[0-9.]+$/.test(host) || /\.[0-9]+$/.test(host) || /^0x/i.test(host);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !host.includes(".") ||
        host.endsWith(".") ||
        ipLike ||
        host === "localhost" ||
        host.endsWith(".localhost")
      ) {
        return bad("invalid_url");
      }
      if (url.href.length > WEBSITE_MAX) return bad("too_long");
    }),
  )
  .transform((raw) => new URL(raw).href);

/** An optional field: missing, null or blank all become null. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v), schema.nullable());

export const eventInputSchema = z
  .strictObject({
    name: text(3, 80, false),
    startDate: realIsoDate,
    endDate: realIsoDate,
    timeZone: eventTimeZoneSchema,
    city: text(1, 60, false),
    country: z.enum(COUNTRY_CODES, { error: (iss) => (iss.input === undefined ? "required" : "invalid_country") }),
    language: eventLanguageSchema,
    description: optional(text(0, 500, true)),
    website: optional(websiteSchema),
  })
  .superRefine((e, ctx) => {
    // Date field errors are reported on their own; no span maths on a date that is not a real day.
    if (!realIsoDate.safeParse(e.startDate).success || !realIsoDate.safeParse(e.endDate).success) return;
    const span = (utcDay(e.endDate) - utcDay(e.startDate)) / 86_400_000;
    if (span < 0) ctx.addIssue({ code: "custom", message: "end_before_start", path: ["endDate"] });
    else if (span > MAX_EVENT_SPAN_DAYS) ctx.addIssue({ code: "custom", message: "span_too_long", path: ["endDate"] });
  });
export type EventInput = z.infer<typeof eventInputSchema>;

/** Maps a zod error from `eventInputSchema` to stable field codes. Never echoes submitted values. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const first = issue.path[0];
    let path: FieldError["path"] = (EVENT_INPUT_FIELDS as readonly unknown[]).includes(first)
      ? (first as EventInputField)
      : "body";
    let code: FieldErrorCode;
    if (issue.code === "unrecognized_keys") {
      path = "body";
      code = "unknown_field";
    } else if (FIELD_CODE_SET.has(issue.message)) code = issue.message as FieldErrorCode;
    else if (issue.code === "too_small") code = "too_short";
    else if (issue.code === "too_big") code = "too_long";
    else code = "invalid";
    const key = `${path}:${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ path, code });
    }
  }
  return out;
}

// --- Responses -------------------------------------------------------------------------------

// --- Slice 08a: map upload ---------------------------------------------------------------------
/** Server limits for the two variants the browser sends (bytes and pixels). */
export const MAP_FULL_MAX_BYTES = 1_500_000;
export const MAP_SMALL_MAX_BYTES = 400_000;
export const MAP_UPLOAD_BODY_LIMIT = 2 * 1024 * 1024;
export const MAP_FULL_MIN_LONG_SIDE = 1600;
export const MAP_FULL_MAX_LONG_SIDE = 2400;
export const MAP_SMALL_MAX_LONG_SIDE = 1200;
/** Aspect ratio window 1:3 to 3:1. */
export const MAP_MAX_ASPECT = 3;

export const mapUploadThemeSchema = z.enum(["light", "dark"]);
export const mapThemeInputSchema = z.strictObject({ theme: mapUploadThemeSchema });
export type MapThemeInput = z.infer<typeof mapThemeInputSchema>;

const panelMapVariantSchema = z.object({
  /** Same-origin path, e.g. `/media/maps/{eventId}/{hex32}-full.webp`. */
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const panelMapSchema = z.object({
  theme: mapThemeSchema,
  format: z.enum(["webp", "jpeg"]),
  full: panelMapVariantSchema,
  small: panelMapVariantSchema,
  updatedAt: z.iso.datetime(),
});
export type PanelMap = z.infer<typeof panelMapSchema>;
export const panelMapResponseSchema = z.object({ map: panelMapSchema });
export type PanelMapResponse = z.infer<typeof panelMapResponseSchema>;

export const panelEventSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  status: z.enum(["draft", "published"]),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  timeZone: z.string(),
  city: z.string(),
  country: z.string(),
  language: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  map: panelMapSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PanelEvent = z.infer<typeof panelEventSchema>;
export const panelEventListResponseSchema = z.object({
  events: z.array(panelEventSchema).max(MAX_EVENTS_PER_ORGANIZER),
});
export type PanelEventListResponse = z.infer<typeof panelEventListResponseSchema>;
export const panelEventResponseSchema = z.object({ event: panelEventSchema });
export type PanelEventResponse = z.infer<typeof panelEventResponseSchema>;

/** Owner preview: the public bundle shape after slice 08, but the map is null. Public-shaped fields only. */
export const eventPreviewResponseSchema = z.object({
  event: eventSchema.and(
    z.object({
      city: z.string(),
      country: z.string(),
      description: z.string().optional(),
      website: z.string().optional(),
    }),
  ),
  map: eventMapSchema.nullable(),
  points: z.array(pointSchema).max(0),
  sessions: z.array(sessionSchema).max(0),
});
export type EventPreviewResponse = z.infer<typeof eventPreviewResponseSchema>;
