import { z } from "zod";
import { FIELD_ERROR_CODES, POINT_INPUT_FIELDS, type FieldError, type FieldErrorCode } from "./field-errors.ts";
import {
  MAX_POINTS_PER_MAP,
  POINT_DESCRIPTION_MAX,
  POINT_NAME_MAX,
  isJustDropCategory,
  pointCategorySchema,
  pointIdSchema,
  pointSchema,
} from "./map-bundle.ts";
import { normalizeText, text } from "./panel-events.ts";
import { FORBIDDEN_SINGLE_LINE } from "./text-rules.ts";

/**
 * Slice 08c: the organizer's Points editor. One request saves the whole set of the event's Points atomically.
 * `NAME_IT_CATEGORIES`, `JUST_DROP_CATEGORIES`, `POINT_NAME_MAX` and `POINT_DESCRIPTION_MAX` live in map-bundle.ts
 * (the public `pointSchema` needs them) and are exported from the package index.
 */

const FIELD_CODES: ReadonlySet<string> = new Set(FIELD_ERROR_CODES);

/** `""` allowed. */
const descriptionField = text(0, POINT_DESCRIPTION_MAX, true);
/** Rounded to 5 decimals (about 1 px on a 100 000 px map). */
const coord = z
  .number({ error: (iss) => (iss.input === undefined ? "required" : "invalid") })
  .min(0, "invalid")
  .max(1, "invalid")
  .transform((n) => Math.round(n * 1e5) / 1e5);

/**
 * Name rules: Name-it needs 1-80 code points. Just-drop may be null/absent (no custom name) or 1-80; a string that
 * is blank after trimming becomes null (a cleared field means "back to the default"). Output `name` is always
 * `string | null`, never `""`.
 */
export const pointDraftSchema = z
  .strictObject({
    /** Present only for existing Points of THIS event. */
    id: pointIdSchema.optional(),
    category: pointCategorySchema,
    name: z.string().nullish(),
    description: descriptionField,
    x: coord,
    y: coord,
  })
  .transform((p, ctx) => {
    const bad = (message: FieldErrorCode) => {
      ctx.addIssue({ code: "custom", message, path: ["name"] });
      return z.NEVER;
    };
    const justDrop = isJustDropCategory(p.category);
    let name: string | null = null;
    if (p.name === null || p.name === undefined) {
      if (!justDrop) return bad("required");
    } else {
      const n = normalizeText(p.name);
      if (n === "") {
        if (!justDrop) return bad("too_short");
      } else {
        if ([...n].length > POINT_NAME_MAX) return bad("too_long");
        if (FORBIDDEN_SINGLE_LINE.test(n)) return bad("control_chars");
        name = n;
      }
    }
    return { ...(p.id === undefined ? {} : { id: p.id }), category: p.category, name, description: p.description, x: p.x, y: p.y };
  });
export type PointDraft = z.infer<typeof pointDraftSchema>;

export const savePointsRequestSchema = z
  .strictObject({
    /** The `eventUpdatedAt` the editor last received. */
    baseUpdatedAt: z.iso.datetime(),
    /** 0 allowed (deletes everything). More than 500 -> `too_long` at `points`. */
    points: z.array(pointDraftSchema).max(MAX_POINTS_PER_MAP, "too_long"),
    /**
     * Slice 13: acknowledgement that deleting these Points also deletes their Sessions. Must cover every deleted Point
     * that has Sessions, else 409 `point_has_sessions`. Ids that are not deleted by this save are ignored.
     */
    deleteSessionsOf: z.array(pointIdSchema).max(MAX_POINTS_PER_MAP, "too_long").optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const p of body.points) {
      if (p.id === undefined) continue;
      if (seen.has(p.id)) return void ctx.addIssue({ code: "custom", message: "invalid", path: ["points"] });
      seen.add(p.id);
    }
  });
export type SavePointsRequest = z.infer<typeof savePointsRequestSchema>;

/** `points` in `sortPoints` order (category, name, id). */
export const panelPointsResponseSchema = z.object({
  points: z.array(pointSchema).max(MAX_POINTS_PER_MAP),
  /** Slice 13: number of Sessions per Point id, only Points that have some. */
  sessionCounts: z.record(pointIdSchema, z.number().int().min(1)),
  eventUpdatedAt: z.iso.datetime(),
});
export type PanelPointsResponse = z.infer<typeof panelPointsResponseSchema>;

export const savePointsResponseSchema = panelPointsResponseSchema.extend({
  counts: z.object({ created: z.number().int().min(0), updated: z.number().int().min(0), deleted: z.number().int().min(0),
    /** Slice 13: Sessions removed with their deleted Points. */
    sessionsDeleted: z.number().int().min(0),
  }),
  /** `index` is the position of the new item in the request `points`. */
  created: z.array(z.object({ index: z.number().int().min(0), id: pointIdSchema })),
});
export type SavePointsResponse = z.infer<typeof savePointsResponseSchema>;

/** Body limit of the save route only (512 KB). Every other panel route keeps 8 KB. */
export const POINTS_SAVE_BODY_LIMIT = 524_288;
export const MAX_FIELD_ERRORS = 20;

const ITEM_PATH_FIELDS: ReadonlySet<string> = new Set(POINT_INPUT_FIELDS);

/** Maps a zod error from `savePointsRequestSchema` to stable, indexed field codes. Never echoes submitted values. */
export function toPointFieldErrors(error: z.ZodError): FieldError[] {
  const out: FieldError[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    let path: FieldError["path"] = "body";
    const [a, b, c] = issue.path;
    if (a === "baseUpdatedAt") path = "baseUpdatedAt";
    else if (a === "deleteSessionsOf") path = "deleteSessionsOf";
    else if (a === "points") {
      path = "points";
      if (typeof b === "number" && b < MAX_POINTS_PER_MAP && typeof c === "string" && ITEM_PATH_FIELDS.has(c)) {
        path = `points.${b}.${c as (typeof POINT_INPUT_FIELDS)[number]}`;
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
