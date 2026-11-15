import { z } from "zod";
import { eventPreviewResponseSchema } from "./panel-events.ts";
import { eventStatusSchema, reasonSchema } from "./event-status.ts";
import { slugSchema } from "./map-bundle.ts";

/** Slice 08b: publish with Admin approval. Timestamps are ISO 8601 UTC strings (ms precision). */

/** Daily cap of organizer transitions (request, withdraw, unpublish) per UTC day. */
export const DAILY_TRANSITION_CAP = 30;
export const ADMIN_LIST_DEFAULT_LIMIT = 50;
export const ADMIN_LIST_MAX_LIMIT = 100;

// --- Organizer: POST /api/v1/panel/events/:id/{publish-request,withdraw,unpublish} -> PanelEventResponse -------
export const publishActionRequestSchema = z.strictObject({});
export type PublishActionRequest = z.infer<typeof publishActionRequestSchema>;

// --- Admin: /api/v1/admin/events/... ------------------------------------------------------------------------
export const organizerContactSchema = z.object({ displayName: z.string(), email: z.string() });

/** `organizer` is null for seeded demo events (no owner). */
export const adminEventRowSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  city: z.string(),
  country: z.string(),
  status: eventStatusSchema,
  requestedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  /** `approvedAt` is set and `updatedAt > approvedAt`. */
  editedSinceApproval: z.boolean(),
  organizer: organizerContactSchema.nullable(),
});
export type AdminEventRow = z.infer<typeof adminEventRowSchema>;

/** `GET /pending` and `GET /published` query. Invalid values are `400 validation_error`. */
export const adminListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(ADMIN_LIST_MAX_LIMIT).default(ADMIN_LIST_DEFAULT_LIMIT),
  /** Opaque: the `nextCursor` of the previous page. */
  cursor: z
    .string()
    .regex(/^\d{1,16}:[A-Za-z0-9_-]{1,64}$/)
    .optional(),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

const adminListShape = {
  events: z.array(adminEventRowSchema).max(ADMIN_LIST_MAX_LIMIT),
  /** Pending: events In review (the badge). Published: events Published. */
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
};
/** Oldest `requestedAt` first. */
export const adminPendingListResponseSchema = z.object(adminListShape);
export type AdminPendingListResponse = z.infer<typeof adminPendingListResponseSchema>;
/** `updatedAt` descending. */
export const adminPublishedListResponseSchema = z.object(adminListShape);
export type AdminPublishedListResponse = z.infer<typeof adminPublishedListResponseSchema>;

/** `GET /:id/review`: the owner-preview payload plus the review facts. 404 unless In review or Published. */
export const adminReviewResponseSchema = eventPreviewResponseSchema.extend({
  review: z.object({
    id: z.string().min(1),
    status: eventStatusSchema,
    /** Content version. Send it back to `approve`. */
    updatedAt: z.iso.datetime(),
    requestedAt: z.iso.datetime().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    editedSinceApproval: z.boolean(),
    organizer: organizerContactSchema.nullable(),
  }),
});
export type AdminReviewResponse = z.infer<typeof adminReviewResponseSchema>;

export const approveRequestSchema = z.strictObject({ updatedAt: z.iso.datetime() });
export type ApproveRequest = z.infer<typeof approveRequestSchema>;
export const rejectRequestSchema = z.strictObject({ reason: reasonSchema });
export type RejectRequest = z.infer<typeof rejectRequestSchema>;
export const adminUnpublishRequestSchema = z.strictObject({ reason: reasonSchema });
export type AdminUnpublishRequest = z.infer<typeof adminUnpublishRequestSchema>;

export const adminDecisionResponseSchema = z.object({
  event: z.object({ id: z.string().min(1), status: eventStatusSchema, approvedAt: z.iso.datetime().nullable() }),
  /** Events In review after this decision (the badge). */
  pendingCount: z.number().int().nonnegative(),
});
export type AdminDecisionResponse = z.infer<typeof adminDecisionResponseSchema>;
