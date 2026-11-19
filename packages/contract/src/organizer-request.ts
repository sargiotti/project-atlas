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
export type OrganizerRequestInput = z.input<typeof organizerRequestSchema>;
/** What the server works with after parsing. */
export type OrganizerRequestParsed = z.output<typeof organizerRequestSchema>;

export const ORGANIZER_FIELD_PATHS = ["name", "email", "eventName", "eventDate", "city", "role", "message", "elapsedMs", "turnstileToken"] as const;
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

export const organizerRequestListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(ORGANIZER_LIST_MAX_LIMIT).default(ORGANIZER_LIST_DEFAULT_LIMIT),
  /** Opaque: the `nextCursor` of the previous page (`<createdAt>:<id>`). */
  cursor: z
    .string()
    .regex(/^\d{1,16}:[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});
export type OrganizerRequestListQuery = z.infer<typeof organizerRequestListQuerySchema>;

export const organizerRequestRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  eventName: z.string(),
  eventDate: z.string().nullable(),
  city: z.string().nullable(),
  role: z.string().nullable(),
  message: z.string().nullable(),
  emailStatus: z.enum(EMAIL_STATUSES),
  /** Epoch ms, UTC. */
  createdAt: z.number().int(),
});
export type OrganizerRequestRow = z.infer<typeof organizerRequestRowSchema>;

export const organizerRequestListResponseSchema = z.object({
  requests: z.array(organizerRequestRowSchema).max(ORGANIZER_LIST_MAX_LIMIT),
  nextCursor: z.string().nullable(),
});
export type OrganizerRequestListResponse = z.infer<typeof organizerRequestListResponseSchema>;
