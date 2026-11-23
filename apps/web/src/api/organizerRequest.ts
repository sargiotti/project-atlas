import {
  inviteFromRequestResponseSchema,
  organizerRequestActionResponseSchema,
  organizerRequestListResponseSchema,
  organizerRequestSummarySchema,
  type OrganizerRequestSummary,
  type InviteFromRequestResponse,
  type OrganizerRequestRow,
  type RequestFilter,
  type FieldError,
  type OrganizerRequestInput,
  type OrganizerRequestListResponse,
} from "@atlas/contract";

const BASE = "/api/v1";

export type SubmitResult =
  | { status: "ok" }
  | { status: "fields"; fields: FieldError[] }
  | { status: "rejected" } // submission_rejected: too fast or Turnstile failed. The widget must be reset.
  | { status: "rate_limited" }
  | { status: "daily_cap" }
  | { status: "unavailable" } // 503
  | { status: "error" }; // network or anything unexpected

async function errorOf(res: Response): Promise<{ code: string; fields: FieldError[] }> {
  try {
    const j = await res.json();
    return {
      code: typeof j?.error?.code === "string" ? j.error.code : "error",
      fields: Array.isArray(j?.error?.fields) ? j.error.fields.filter((f: any) => typeof f?.path === "string" && typeof f?.code === "string") : [],
    };
  } catch {
    return { code: "error", fields: [] };
  }
}

/** POST /api/v1/organizer-requests (public). The body is exactly the contract shape; nothing is stored client-side. */
export async function submitOrganizerRequest(body: OrganizerRequestInput, signal?: AbortSignal): Promise<SubmitResult> {
  try {
    const res = await fetch(`${BASE}/organizer-requests`, {
      method: "POST",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 201) return { status: "ok" };
    const { code, fields } = await errorOf(res);
    if (res.status === 400 && code === "submission_rejected") return { status: "rejected" };
    if (res.status === 400 && code === "validation_error") return { status: "fields", fields };
    if (res.status === 429) return { status: code === "daily_cap_reached" ? "daily_cap" : "rate_limited" };
    if (res.status === 503) return { status: "unavailable" };
    return { status: "error" };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}

export type ListResult =
  | { status: "ok"; page: OrganizerRequestListResponse }
  | { status: "unauthenticated" | "forbidden" | "error" };

/** GET /api/v1/admin/organizer-requests (admin only; the server enforces it). */
export async function listOrganizerRequests(cursor?: string | null, signal?: AbortSignal, status: RequestFilter = "pending"): Promise<ListResult> {
  try {
    const q = new URLSearchParams({ status });
    if (cursor) q.set("cursor", cursor);
    const res = await fetch(`${BASE}/admin/organizer-requests?${q}`, { signal, headers: { Accept: "application/json" } });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 403) return { status: "forbidden" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", page: organizerRequestListResponseSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}

export type RequestAction = "invite" | "invite-again" | "discard" | "restore";
export type ActionResult =
  | { status: "ok"; request: OrganizerRequestRow; emailStatus?: InviteFromRequestResponse["emailStatus"]; inviteLink?: string }
  | { status: "unauthenticated" | "forbidden" | "error" }
  /** 4xx/409 with the server's error code: invalid_transition, invite_already_pending, email_already_registered, invite_cap_reached, validation_error, not_found. */
  | { status: "failed"; code: string };

/** POST /api/v1/admin/organizer-requests/:id/{invite,invite-again,discard,restore}. Discard and restore send `{}`. */
export async function requestAction(id: string, action: RequestAction, note?: string): Promise<ActionResult> {
  try {
    const body = action === "invite" || action === "invite-again" ? (note ? { note } : {}) : {};
    const res = await fetch(`${BASE}/admin/organizer-requests/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 403) return { status: "forbidden" };
    if (res.ok) {
      const j = await res.json();
      if (action === "invite" || action === "invite-again") {
        const r = inviteFromRequestResponseSchema.parse(j);
        return { status: "ok", request: r.request, emailStatus: r.emailStatus, inviteLink: r.inviteLink };
      }
      return { status: "ok", request: organizerRequestActionResponseSchema.parse(j).request };
    }
    if (res.status >= 400 && res.status < 500) return { status: "failed", code: (await errorOf(res)).code };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** GET /api/v1/admin/organizer-requests/summary (slice 44). Any failure just hides the box: null. */
export async function getRequestSummary(signal?: AbortSignal): Promise<OrganizerRequestSummary | null> {
  try {
    const res = await fetch(`${BASE}/admin/organizer-requests/summary`, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return organizerRequestSummarySchema.parse(await res.json());
  } catch {
    return null;
  }
}
