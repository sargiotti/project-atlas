import type { Hono, MiddlewareHandler } from "hono";
import {
  adminListQuerySchema,
  adminUnpublishRequestSchema,
  approveRequestSchema,
  rejectRequestSchema,
  toFieldErrors,
  type AdminDecisionResponse,
  type AdminPendingListResponse,
  type AdminPublishedListResponse,
  type AdminReviewResponse,
  type EventStatus,
} from "@atlas/contract";
import { D1AdminEventRepository } from "../adapters/d1-admin-event-repository";
import { D1PublicationRepository } from "../adapters/d1-publication-repository";
import { runTransition } from "../application/publication";
import type { PublishAction } from "../domain/publication";
import { errorResponse } from "./errors";
import { logPublication, refusalResponse } from "./publication-http";
import { toPreviewBody } from "./preview-body";
import type { AppContext, AppEnv } from "./types";

const NO_STORE = "no-store";
/** Seeded demo events have ids like `evt_tiny-fest`, so underscores are allowed here (unlike organizer routes). */
const ADMIN_EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Per-Admin-user limit (key = user id, so it runs after requireAuth). Fails open. The IP-keyed AUTH_LIMITER stays
 * on /admin/invites* only: an Admin working through a queue must not hit a 10 / min IP cap.
 */
export const adminLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.ADMIN_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.get("user").id })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": "60" });
  }
  await next();
};

async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

const notFound = (c: AppContext) => errorResponse(c, 404, "event_not_found", NO_STORE);

/**
 * Admin event moderation. The prefix chain in auth-routes (guardMutations, limitBody, requireAuth, requireAdmin: the
 * role is read from D1 on every request) has already run, so every handler here is Admin-only.
 */
export function registerAdminEventRoutes(app: Hono<AppEnv>): void {
  app.use("/api/v1/admin/events/*", adminLimiter);

  const listQuery = (c: AppContext) => {
    const q = c.req.query();
    return adminListQuerySchema.safeParse({ ...(q.limit !== undefined ? { limit: q.limit } : {}), ...(q.cursor !== undefined ? { cursor: q.cursor } : {}), ...unknownKeys(q) });
  };

  app.get("/api/v1/admin/events/pending", async (c) => {
    const parsed = listQuery(c);
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE);
    const body: AdminPendingListResponse = await new D1AdminEventRepository(c.env.DB).pending(parsed.data.limit, parsed.data.cursor);
    return c.json(body);
  });

  app.get("/api/v1/admin/events/published", async (c) => {
    const parsed = listQuery(c);
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE);
    const body: AdminPublishedListResponse = await new D1AdminEventRepository(c.env.DB).published(parsed.data.limit, parsed.data.cursor);
    return c.json(body);
  });

  // Read-only: what the event looks like right now, plus the version (`updatedAt`) to send back to approve.
  app.get("/api/v1/admin/events/:id/review", async (c) => {
    const id = c.req.param("id");
    if (!ADMIN_EVENT_ID.test(id)) return notFound(c);
    const r = await new D1AdminEventRepository(c.env.DB).review(id);
    if (!r) return notFound(c);
    const body: AdminReviewResponse = {
      ...toPreviewBody(r.event),
      review: {
        id: r.event.id,
        status: r.event.status,
        updatedAt: r.event.updatedAt,
        requestedAt: r.requestedAt,
        approvedAt: r.approvedAt,
        editedSinceApproval: r.editedSinceApproval,
        organizer: r.organizer,
      },
    };
    return c.json(body);
  });

  const decide = async (c: AppContext, action: PublishAction, to: EventStatus, input: { expectedUpdatedAt?: number; reason?: string | null }) => {
    const id = c.req.param("id") ?? "";
    if (!ADMIN_EVENT_ID.test(id)) return notFound(c);
    const repo = new D1PublicationRepository(c.env.DB);
    const now = Date.now();
    const result = await runTransition(repo, { action, eventId: id, actorId: c.get("user").id, now, ...input });
    if (!result.ok) {
      logPublication(c, action, result.reason, id);
      return refusalResponse(c, result.reason, "fields" in result ? result.fields : undefined);
    }
    logPublication(c, action, "ok", id);
    const body: AdminDecisionResponse = {
      event: { id, status: to, approvedAt: action === "approve" ? new Date(now).toISOString() : null },
      pendingCount: await repo.pendingCount(),
    };
    return c.json(body);
  };

  app.post("/api/v1/admin/events/:id/approve", async (c) => {
    const parsed = approveRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE, {}, toFieldErrors(parsed.error));
    return decide(c, "approve", "published", { expectedUpdatedAt: Date.parse(parsed.data.updatedAt) });
  });

  app.post("/api/v1/admin/events/:id/reject", async (c) => {
    const parsed = rejectRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE, {}, toFieldErrors(parsed.error));
    return decide(c, "reject", "rejected", { reason: parsed.data.reason });
  });

  app.post("/api/v1/admin/events/:id/unpublish", async (c) => {
    const parsed = adminUnpublishRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE, {}, toFieldErrors(parsed.error));
    return decide(c, "admin_unpublish", "unpublished_admin", { reason: parsed.data.reason });
  });
}

/** Query keys other than `limit` and `cursor` make the strict schema fail (no silent ignoring). */
function unknownKeys(q: Record<string, string>): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) if (k !== "limit" && k !== "cursor") extra[k] = v;
  return extra;
}
