import { z } from "zod";
import { FIELD_ERROR_CODES, type FieldError, type FieldErrorCode } from "./field-errors.ts";
import { FORBIDDEN_MULTI_LINE, FORBIDDEN_SINGLE_LINE } from "./text-rules.ts";

/** Slice 30: the public organizer request form and the Admin list of requests. */

/** Shared with the web for inline validation. Lengths count UTF-16 units like the server's zod `max`. */
export const ORGANIZER_REQUEST_LIMITS = {
  name: 100,
  email: 254,
  eventName: 150,
  eventDate: 50,
  city: 100,
  role: 100,
  message: 2000,
  website: 500,
  turnstileToken: 2048,
  /** Minimum fill time the server enforces (client-reported, weak on its own). */
  minElapsedMs: 3000,
  maxElapsedMs: 86_400_000,
} as const;

/** Cloudflare Turnstile `action` the widget must be rendered with and the server requires. */
export const ORGANIZER_TURNSTILE_ACTION = "organizer_request";

/**
 * Public Turnstile site key (not a secret). Production and previews use the same widget. The web reads it from
 * `VITE_TURNSTILE_SITE_KEY` when set (local dev uses Cloudflare's test key) and falls back to this one.
 */
export const TURNSTILE_SITE_KEY = "0x4AAAAAAGIeIUztdvuTgo9e";

/**
 * Slice 31: the language the organizer used on the form; it picks the invite email template.
 * `es` is Spanish with tu, `es-vos` is Spanish with vos (rioplatense). Used only as a key into a static template map
 * and in a SQL CHECK (migration 0015); never interpolated into text.
 */
export const ORGANIZER_LOCALES = ["en", "es", "es-vos", "ca", "da"] as const;
export const organizerLocaleSchema = z.enum(ORGANIZER_LOCALES);
export type OrganizerLocale = z.infer<typeof organizerLocaleSchema>;
export const DEFAULT_ORGANIZER_LOCALE: OrganizerLocale = "es";

/**
 * Slice 44: where an access request came from. Both are optional and best effort: any missing, malformed or wrong-type value
 * becomes `null` and never causes a 400. The server does no normalisation (no trim, no lowercase).
 * `sourceRef` is a campaign tag from `?ref=`; `pageLang` is the language of the page the form was on.
 */
export const SOURCE_REF_RE = /^[a-z0-9-]{1,40}$/;
export const PAGE_LANGS = ["es", "ca", "en", "da"] as const;
export const pageLangSchema = z.enum(PAGE_LANGS);
export type PageLang = z.infer<typeof pageLangSchema>;

const FIELD_CODE_SET: ReadonlySet<string> = new Set(FIELD_ERROR_CODES);

const norm = (s: string) => s.normalize("NFC").replace(/\r\n/g, "\n").trim();
const missing = { error: (iss: { input?: unknown }) => (iss.input === undefined ? "required" : "invalid") };

/** Required text: empty is `required`. */
function requiredText(max: number, multiline = false) {
  return z
    .string(missing)
    .transform(norm)
    .pipe(
      z
        .string()
        .min(1, "required")
        .max(max, "too_long")
        .refine((s) => !(multiline ? FORBIDDEN_MULTI_LINE : FORBIDDEN_SINGLE_LINE).test(s), "control_chars"),
    );
}

/** Optional text: missing or blank is absent (`undefined`). */
function optionalText(max: number, multiline = false) {
  return z
    .string(missing)
    .optional()
    .transform((s) => (s === undefined ? undefined : norm(s)))
    .pipe(
      z
        .string()
        .max(max, "too_long")
        .refine((s) => !(multiline ? FORBIDDEN_MULTI_LINE : FORBIDDEN_SINGLE_LINE).test(s), "control_chars")
        .optional()
        .transform((s) => (s === "" ? undefined : s)),
    );
}

export const organizerRequestSchema = z.strictObject({
  name: requiredText(ORGANIZER_REQUEST_LIMITS.name),
  email: z
    .string(missing)
    .transform(norm)
    .pipe(
      z
        .string()
        .min(1, "required")
        .max(ORGANIZER_REQUEST_LIMITS.email, "too_long")
        .refine((s) => !FORBIDDEN_SINGLE_LINE.test(s), "control_chars")
        .pipe(z.email("invalid")),
    )
    .transform((s) => s.toLowerCase()),
  eventName: requiredText(ORGANIZER_REQUEST_LIMITS.eventName),
  /** Slice 31. Missing means `es`; an unknown value is a 400 (`locale` / `invalid`). */
  locale: organizerLocaleSchema.default(DEFAULT_ORGANIZER_LOCALE),
  /** Slice 44. Invalid or missing becomes null, never a 400. */
  sourceRef: z.string().regex(SOURCE_REF_RE).nullable().catch(null),
  pageLang: pageLangSchema.nullable().catch(null),
  eventDate: optionalText(ORGANIZER_REQUEST_LIMITS.eventDate),
  city: optionalText(ORGANIZER_REQUEST_LIMITS.city),
  role: optionalText(ORGANIZER_REQUEST_LIMITS.role),
  message: optionalText(ORGANIZER_REQUEST_LIMITS.message, true),
  /** Honeypot. Real users never fill it; any content is accepted (and answered with the normal success). */
  website: z.string().max(ORGANIZER_REQUEST_LIMITS.website).optional(),
  elapsedMs: z.number(missing).int().min(0).max(ORGANIZER_REQUEST_LIMITS.maxElapsedMs),
  turnstileToken: z.string(missing).min(1, "required").max(ORGANIZER_REQUEST_LIMITS.turnstileToken, "too_long"),
});
/** What the web sends. */
export type OrganizerRequestInput = Omit<z.input<typeof organizerRequestSchema>, "sourceRef" | "pageLang"> & {
  sourceRef?: string | null;
  pageLang?: PageLang | null;
};
/** What the server works with after parsing. */
export type OrganizerRequestParsed = z.output<typeof organizerRequestSchema>;

export const ORGANIZER_FIELD_PATHS = ["name", "email", "eventName", "locale", "eventDate", "city", "role", "message", "elapsedMs", "turnstileToken"] as const;
type OrganizerPath = (typeof ORGANIZER_FIELD_PATHS)[number];

/** Maps a zod error from `organizerRequestSchema` to stable field codes. Never echoes submitted values. */
export function toOrganizerFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const first = issue.path[0];
    let path: OrganizerPath | "body" = (ORGANIZER_FIELD_PATHS as readonly unknown[]).includes(first) ? (first as OrganizerPath) : "body";
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

/** 201 body, also for honeypot hits and per-email cap hits (uniform, nothing to probe). */
export const organizerRequestResponseSchema = z.object({ ok: z.literal(true) });
export type OrganizerRequestResponse = z.infer<typeof organizerRequestResponseSchema>;

// --- Admin list ------------------------------------------------------------------------------
export const ORGANIZER_LIST_MAX_LIMIT = 50;
export const ORGANIZER_LIST_DEFAULT_LIMIT = 25;
export const EMAIL_STATUSES = ["pending", "sent", "failed", "skipped"] as const;

/**
 * Slice 31: request status as the Admin sees it. `pending`, `invited` and `discarded` are stored; `joined` is derived on read
 * (the request's invite was used, or an organizer with that email exists) and is never stored.
 */
export const REQUEST_STATUSES = ["pending", "invited", "joined", "discarded"] as const;
export const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;
export const REQUEST_FILTERS = ["pending", "invited", "joined", "discarded", "all"] as const;
export const requestFilterSchema = z.enum(REQUEST_FILTERS);
export type RequestFilter = z.infer<typeof requestFilterSchema>;
export const DEFAULT_REQUEST_FILTER: RequestFilter = "pending";

export const organizerRequestListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(ORGANIZER_LIST_MAX_LIMIT).default(ORGANIZER_LIST_DEFAULT_LIMIT),
  /** Opaque: the `nextCursor` of the previous page (`<createdAt>:<id>`). Use it only with the same `status` it came from. */
  cursor: z
    .string()
    .regex(/^\d{1,16}:[A-Za-z0-9_-]{1,64}$/)
    .optional(),
  status: requestFilterSchema.default(DEFAULT_REQUEST_FILTER),
});
export type OrganizerRequestListQuery = z.infer<typeof organizerRequestListQuerySchema>;

/** State of the invite linked to the request. `null` when there is none (or retention purged it). */
export const REQUEST_INVITE_STATES = ["active", "expired", "revoked", "used"] as const;

export const organizerRequestRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  eventName: z.string(),
  eventDate: z.string().nullable(),
  city: z.string().nullable(),
  role: z.string().nullable(),
  message: z.string().nullable(),
  /** Status of the slice 30 notification email to contact@ (not the invite email). */
  emailStatus: z.enum(EMAIL_STATUSES),
  /** Epoch ms, UTC. */
  createdAt: z.number().int(),
  /** Slice 31. */
  status: requestStatusSchema,
  locale: organizerLocaleSchema,
  /** Epoch ms of the last Invite / Invite again. */
  invitedAt: z.number().int().nullable(),
  inviteExpiresAt: z.number().int().nullable(),
  inviteState: z.enum(REQUEST_INVITE_STATES).nullable(),
  /** Slice 44. */
  sourceRef: z.string().nullable(),
  pageLang: pageLangSchema.nullable(),
});
export type OrganizerRequestRow = z.infer<typeof organizerRequestRowSchema>;

export const organizerRequestListResponseSchema = z.object({
  requests: z.array(organizerRequestRowSchema).max(ORGANIZER_LIST_MAX_LIMIT),
  nextCursor: z.string().nullable(),
});
export type OrganizerRequestListResponse = z.infer<typeof organizerRequestListResponseSchema>;

// --- Slice 31: Admin actions on a request ---------------------------------------------------------
export const INVITE_NOTE_MAX = 1000;
/** Raw input bound before normalizing (the body limit already bounds the request). */
const INVITE_NOTE_RAW_MAX = 4000;

/**
 * Plain text note. NFC, CRLF and CR to LF, trim. Stripped silently: C0/C1 controls except LF, bidi overrides and isolates
 * (U+202A-202E, U+2066-2069), zero-width characters (U+200B-200D, U+2060, U+FEFF), LRM/RLM/ALM (U+200E, U+200F, U+061C) and line/paragraph separators (U+2028, U+2029). Blank means absent.
 * The limit counts UTF-16 units after normalizing. Shared with the web for the counter.
 */
export function normalizeInviteNote(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩​-‍⁠﻿\u200E\u200F\u061C\u2028\u2029]/g, "")
    .trim();
}

export const inviteActionBodySchema = z.strictObject({
  note: z
    .string()
    .max(INVITE_NOTE_RAW_MAX, "too_long")
    .transform(normalizeInviteNote)
    .pipe(z.string().max(INVITE_NOTE_MAX, "too_long"))
    .transform((s) => (s === "" ? undefined : s))
    .optional(),
});
export type InviteActionBodyInput = z.input<typeof inviteActionBodySchema>;

/** Discard and restore take no fields. Send `{}` (the API requires a JSON content type on every POST). */
export const emptyActionBodySchema = z.strictObject({});

/** Request id in the URL: a positive integer in decimal (the `id` of a row, as a string). */
export const REQUEST_ID_REGEX = /^[1-9]\d{0,15}$/;

export const INVITE_EMAIL_STATUSES = ["sent", "failed", "skipped"] as const;
export type InviteEmailStatus = (typeof INVITE_EMAIL_STATUSES)[number];
/** Invite emails per UTC day, across all requests. At the cap the invite is created and the email is `skipped`. */
export const INVITE_EMAIL_DAILY_CAP = 20;

/** 201 of `POST /:id/invite` and `POST /:id/invite-again`. */
export const inviteFromRequestResponseSchema = z.object({
  request: organizerRequestRowSchema,
  /** Status of the invite email. `skipped`: Resend not configured or daily cap reached. */
  emailStatus: z.enum(INVITE_EMAIL_STATUSES),
  /**
   * Absolute link `<PUBLIC_ORIGIN>/panel/invite/<token>`. Present only when `emailStatus` is `failed` or `skipped`. It is
   * returned once and never stored: keep it in dialog state only. Retry = Invite again (new token).
   */
  inviteLink: z.string().optional(),
});
export type InviteFromRequestResponse = z.infer<typeof inviteFromRequestResponseSchema>;

/** 200 of `POST /:id/discard` and `POST /:id/restore`. */
export const organizerRequestActionResponseSchema = z.object({ request: organizerRequestRowSchema });
export type OrganizerRequestActionResponse = z.infer<typeof organizerRequestActionResponseSchema>;

// --- Slice 44: Admin counts by source ---------------------------------------------------------------
const windowCountsSchema = z.object({
  total: z.number().int().min(0),
  byLang: z.object({
    es: z.number().int().min(0),
    ca: z.number().int().min(0),
    en: z.number().int().min(0),
    da: z.number().int().min(0),
    none: z.number().int().min(0),
  }),
  byRef: z.object({
    /** Top 10 refs by count (ties by ref ascending). */
    top: z.array(z.object({ ref: z.string(), count: z.number().int().min(1) })).max(10),
    /** Requests with a ref that is not in `top`. */
    other: z.number().int().min(0),
    /** Requests with no ref (null). */
    none: z.number().int().min(0),
  }),
});
/** `GET /api/v1/admin/organizer-requests/summary`. Rolling windows from the server clock; every request counts, whatever its status. */
export const organizerRequestSummarySchema = z.object({ last7d: windowCountsSchema, last30d: windowCountsSchema });
export type OrganizerRequestSummary = z.infer<typeof organizerRequestSummarySchema>;
