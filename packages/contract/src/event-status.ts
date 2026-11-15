import { z } from "zod";
import { REASON_MAX, cleanReason, codePointLength } from "./text-rules.ts";

/** Slice 08b: where an event is in the publish flow. `rejected` is shown to organizers as "Not approved". */
export const EVENT_STATUSES = ["draft", "in_review", "published", "rejected", "unpublished_admin"] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

const reasonText = z
  .string({ error: (iss) => (iss.input === undefined ? "required" : "invalid") })
  .transform(cleanReason)
  .refine((s) => codePointLength(s) <= REASON_MAX, "too_long")
  .transform((s) => (s === "" ? null : s));

/**
 * Optional moderation reason. Cleaned (NFC, invisible characters and `<` `>` removed, whitespace collapsed,
 * trimmed), then limited to 200 Unicode code points: longer is an error (`too_long`), never truncated.
 * Missing, null and blank all become `null`.
 */
export const reasonSchema = z.preprocess((v) => (v === undefined ? null : v), reasonText.nullable());
export type Reason = z.infer<typeof reasonSchema>;
