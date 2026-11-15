import { z } from "zod";
import { FIELD_ERROR_CODES, SESSION_INPUT_FIELDS, SESSION_PATH_MAX_INDEX, type FieldError, type FieldErrorCode } from "./field-errors.ts";
import { MAX_POINTS_PER_MAP, MAX_SESSIONS_PER_EVENT, pointIdSchema, pointSchema, sessionSchema } from "./map-bundle.ts";
import { text } from "./panel-events.ts";
import { MAX_FIELD_ERRORS } from "./panel-points.ts";
import { MAX_SESSION_MS, parseUtcInstant } from "./schedule.ts";

/**
 * Slice 13: the organizer's Schedule editor. One request saves the whole set of the event's Sessions atomically.
 * Sessions live on stage and landmark Points only. The time window is `sessionWindow` (schedule.ts).
 */

export const SESSION_TITLE_MAX = 120;
export const SESSION_DESCRIPTION_MAX = 300;
/** Body limit of the Sessions save route only (1 MiB). The Points save keeps 512 KB, every other panel route 8 KB. */
export const SESSIONS_SAVE_BODY_LIMIT = 1_048_576;
/** Categories that can hold Sessions. */
export const SESSION_CATEGORIES = ["stage", "landmark"] as const;
export const canHaveSessions = (category: string): boolean => (SESSION_CATEGORIES as readonly string[]).includes(category);

const FIELD_CODES: ReadonlySet<string> = new Set(FIELD_ERROR_CODES);

/** `YYYY-MM-DDTHH:MM:SSZ`, a real instant. */
const instant = z
  .string({ error: (iss) => (iss.input === undefined ? "required" : "invalid") })
  .refine((v) => parseUtcInstant(v) !== null, "invalid");

/**
 * One Session of the whole-set save. Text rules as the rest of the panel (NFC, CRLF to LF, trim, same blocklists).
 * Output: `description` is absent when blank; `id` is present only for existing Sessions of THIS event.
 * Window, overlap and caps are checked by the server against stored data (they need the event and the other items).
 */
export const sessionDraftSchema = z
  .strictObject({
    id: pointIdSchema.optional(),
    pointId: pointIdSchema,
    title: text(1, SESSION_TITLE_MAX, false),
    start: instant,
    end: instant,
    description: z.string().nullish(),
  })
  .transform((s, ctx) => {
    let description: string | undefined;
    if (s.description !== null && s.description !== undefined) {
      const parsed = text(0, SESSION_DESCRIPTION_MAX, true).safeParse(s.description);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: (parsed.error.issues[0]?.message as FieldErrorCode) ?? "invalid", path: ["description"] });
        return z.NEVER;
      }
      if (parsed.data !== "") description = parsed.data;
    }
    const a = parseUtcInstant(s.start);
    const b = parseUtcInstant(s.end);
    if (a !== null && b !== null) {
      if (b <= a) {
        ctx.addIssue({ code: "custom", message: "invalid", path: ["end"] });
        return z.NEVER;
      }
      if (b - a > MAX_SESSION_MS) {
        ctx.addIssue({ code: "custom", message: "too_long", path: ["end"] });
        return z.NEVER;
      }
    }
    return {
      ...(s.id === undefined ? {} : { id: s.id }),
      pointId: s.pointId,
      title: s.title,
      start: s.start,
      end: s.end,
      ...(description === undefined ? {} : { description }),
    };
  });
export type SessionDraft = z.infer<typeof sessionDraftSchema>;

export const saveSessionsRequestSchema = z
  .strictObject({
    /** The `eventUpdatedAt` the editor last received. */
    baseUpdatedAt: z.iso.datetime(),
    /** 0 allowed (deletes everything). More than 1000 -> `too_long` at `sessions`. */
    sessions: z.array(sessionDraftSchema).max(MAX_SESSIONS_PER_EVENT, "too_long"),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const s of body.sessions) {
      if (s.id === undefined) continue;
      if (seen.has(s.id)) return void ctx.addIssue({ code: "custom", message: "invalid", path: ["sessions"] });
      seen.add(s.id);
    }
  });
export type SaveSessionsRequest = z.infer<typeof saveSessionsRequestSchema>;

/** `sessions` sorted by start, end, id. `points`: stage and landmark Points only, in `sortPoints` order. */
export const panelSessionsResponseSchema = z.object({
  sessions: z.array(sessionSchema).max(MAX_SESSIONS_PER_EVENT),
  points: z.array(pointSchema).max(MAX_POINTS_PER_MAP),
  /** `HH:MM` in the Event's zone (not editable by organizers). */
  dayStart: z.string(),
  /** The `sessionWindow` of the event as UTC instants: `from` inclusive, `until` exclusive. */
  window: z.object({ from: z.string(), until: z.string() }),
  eventUpdatedAt: z.iso.datetime(),
});
export type PanelSessionsResponse = z.infer<typeof panelSessionsResponseSchema>;

export const saveSessionsResponseSchema = panelSessionsResponseSchema.extend({
  counts: z.object({ created: z.number().int().min(0), updated: z.number().int().min(0), deleted: z.number().int().min(0) }),
  /** `index` is the position of the new item in the request `sessions`. */
  created: z.array(z.object({ index: z.number().int().min(0), id: pointIdSchema })),
});
export type SaveSessionsResponse = z.infer<typeof saveSessionsResponseSchema>;

const ITEM_PATH_FIELDS: ReadonlySet<string> = new Set(SESSION_INPUT_FIELDS);

/** Maps a zod error from `saveSessionsRequestSchema` to stable, indexed field codes. Never echoes submitted values. */
export function toSessionFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    let path: FieldError["path"] = "body";
    const [a, b, c] = issue.path;
    if (a === "baseUpdatedAt") path = "baseUpdatedAt";
    else if (a === "sessions") {
      path = "sessions";
      if (typeof b === "number" && b <= SESSION_PATH_MAX_INDEX && typeof c === "string" && ITEM_PATH_FIELDS.has(c)) {
        path = `sessions.${b}.${c as (typeof SESSION_INPUT_FIELDS)[number]}`;
      }
    }
    let code: FieldErrorCode;
    if (issue.code === "unrecognized_keys") code = "unknown_field";
    else if (FIELD_CODES.has(issue.message)) code = issue.message as FieldErrorCode;
    else if (issue.code === "too_small") code = "too_short";
    else if (issue.code === "too_big") code = "too_long";
    else code = "invalid";
    const key = `${path}:${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ path, code });
      if (out.length >= MAX_FIELD_ERRORS) break;
    }
  }
  return out;
}
