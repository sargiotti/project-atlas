import {
  organizerRequestListResponseSchema,
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
export async function listOrganizerRequests(cursor?: string | null, signal?: AbortSignal): Promise<ListResult> {
  try {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`${BASE}/admin/organizer-requests${q}`, { signal, headers: { Accept: "application/json" } });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 403) return { status: "forbidden" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", page: organizerRequestListResponseSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}
