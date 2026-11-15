import {
  adminDecisionResponseSchema,
  adminPendingListResponseSchema,
  adminPublishedListResponseSchema,
  adminReviewResponseSchema,
  panelEventResponseSchema,
  type AdminEventRow,
  type AdminReviewResponse,
  type PanelEvent,
} from "@atlas/contract";

// Slice 08b: organizer transitions and Admin decisions. Nothing here is persisted in the browser. The UI only
// maps the server's answer to a screen; every rule (who may approve, which transition is legal) is the server's.
const rethrowAbort = (e: any) => {
  if (e?.name === "AbortError") throw e;
};

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  return fetch(`/api/v1${path}`, {
    method,
    signal,
    headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function codeOf(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j?.error?.code === "string" ? j.error.code : "error";
  } catch {
    return "error";
  }
}

/** Failure kinds the screens know how to explain. Anything unknown is "error". */
export type FailCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_transition"
  | "event_changed"
  | "map_required"
  | "transition_cap_reached"
  | "rate_limited"
  | "validation"
  | "too_long"
  | "error";

async function failure(res: Response): Promise<{ status: "failed"; code: FailCode }> {
  if (res.status === 401) return { status: "failed", code: "unauthenticated" };
  if (res.status === 403) return { status: "failed", code: "forbidden" };
  if (res.status === 404) return { status: "failed", code: "not_found" };
  const code = await codeOf(res);
  if (code === "validation_error") {
    // Only the reason field can be too long; everything else is "fix the event" (request) or a generic failure.
    try {
      const j = await res.clone().json();
      const fields = j?.error?.fields;
      if (Array.isArray(fields) && fields.some((f: any) => f?.field === "reason" && f?.code === "too_long")) return { status: "failed", code: "too_long" };
    } catch {}
    return { status: "failed", code: "validation" };
  }
  const known: FailCode[] = ["invalid_transition", "event_changed", "map_required", "transition_cap_reached", "rate_limited"];
  return { status: "failed", code: (known as string[]).includes(code) ? (code as FailCode) : res.status === 429 ? "rate_limited" : "error" };
}

export type Failed = { status: "failed"; code: FailCode } | { status: "error" };

// ---- organizer ---------------------------------------------------------------------------------------
export type TransitionResult = { status: "ok"; event: PanelEvent } | Failed;
export async function organizerTransition(id: string, action: "publish-request" | "withdraw" | "unpublish"): Promise<TransitionResult> {
  try {
    const res = await call("POST", `/panel/events/${encodeURIComponent(id)}/${action}`, {});
    if (res.ok) return { status: "ok", event: panelEventResponseSchema.parse(await res.json()).event };
    return await failure(res);
  } catch {
    return { status: "error" };
  }
}

// ---- Admin -------------------------------------------------------------------------------------------
export type AdminListResult = { status: "ok"; events: AdminEventRow[]; total: number; nextCursor: string | null } | Failed;
export async function adminList(kind: "pending" | "published", cursor?: string | null, signal?: AbortSignal): Promise<AdminListResult> {
  try {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await call("GET", `/admin/events/${kind}${qs}`, undefined, signal);
    if (!res.ok) return await failure(res);
    const schema = kind === "pending" ? adminPendingListResponseSchema : adminPublishedListResponseSchema;
    const j = schema.parse(await res.json());
    return { status: "ok", events: j.events, total: j.total, nextCursor: j.nextCursor };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type ReviewResult = { status: "ok"; review: AdminReviewResponse } | Failed;
export async function adminReview(id: string, signal?: AbortSignal): Promise<ReviewResult> {
  try {
    const res = await call("GET", `/admin/events/${encodeURIComponent(id)}/review`, undefined, signal);
    if (!res.ok) return await failure(res);
    return { status: "ok", review: adminReviewResponseSchema.parse(await res.json()) };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type DecisionResult = { status: "ok"; eventStatus: string; approvedAt: string | null; pendingCount: number } | Failed;
async function decide(id: string, action: string, body: unknown): Promise<DecisionResult> {
  try {
    const res = await call("POST", `/admin/events/${encodeURIComponent(id)}/${action}`, body);
    if (!res.ok) return await failure(res);
    const j = adminDecisionResponseSchema.parse(await res.json());
    return { status: "ok", eventStatus: j.event.status, approvedAt: j.event.approvedAt, pendingCount: j.pendingCount };
  } catch {
    return { status: "error" };
  }
}
export const adminApprove = (id: string, updatedAt: string) => decide(id, "approve", { updatedAt });
export const adminReject = (id: string, reason: string) => decide(id, "reject", { reason: reason.trim() === "" ? null : reason });
export const adminUnpublish = (id: string, reason: string) => decide(id, "unpublish", { reason: reason.trim() === "" ? null : reason });
