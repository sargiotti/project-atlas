import {
  createInviteResponseSchema,
  inspectInviteResponseSchema,
  inviteListResponseSchema,
  meResponseSchema,
  type InspectInviteResponse,
  type InviteSummary,
  type Organizer,
} from "@atlas/contract";

// Session lives in an HttpOnly cookie set by the Worker. Nothing from auth is ever kept in
// localStorage / sessionStorage; every response here is held in React state only. (Accepted exception, security P4
// of slice 08c: the Points editor's unsaved draft, keyed by the organizer id from /auth/me and wiped on sign out;
// it holds no session data. See lib/pointsDraft.ts.)
const BASE = "/api/v1";

/** Google sign-in is a plain same-origin navigation (302 to Google). No third-party script. */
export function googleStartUrl(inviteToken?: string, termsAccepted = false) {
  if (!inviteToken) return `${BASE}/auth/google/start`;
  // terms=true only when the checkbox is ticked (slice 32); the server is the authority.
  return `${BASE}/auth/google/start?invite=${encodeURIComponent(inviteToken)}${termsAccepted ? "&terms=true" : ""}`;
}

async function request(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  return fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
}

async function errorCode(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j?.error?.code === "string" ? j.error.code : "error";
  } catch {
    return "error";
  }
}

const rethrowAbort = (e: any) => {
  if (e?.name === "AbortError") throw e;
};

export type MeResult = { status: "ok"; organizer: Organizer; pendingCount: number } | { status: "unauthenticated" } | { status: "error" };

export async function fetchMe(signal?: AbortSignal): Promise<MeResult> {
  try {
    const res = await request("GET", "/auth/me", undefined, signal);
    if (res.status === 401) return { status: "unauthenticated" };
    if (!res.ok) return { status: "error" };
    const me = meResponseSchema.parse(await res.json());
    return { status: "ok", organizer: me.organizer, pendingCount: me.pendingCount ?? 0 };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export async function logout(): Promise<boolean> {
  try {
    const res = await request("POST", "/auth/logout", {});
    return res.ok;
  } catch {
    return false;
  }
}

export type InspectResult = { status: "ok"; invite: InspectInviteResponse } | { status: "not_found" } | { status: "error" };

export async function inspectInvite(token: string, signal?: AbortSignal): Promise<InspectResult> {
  try {
    const res = await request("POST", "/invites/inspect", { token }, signal);
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", invite: inspectInviteResponseSchema.parse(await res.json()) };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type ListResult = { status: "ok"; invites: InviteSummary[] } | { status: "unauthenticated" | "forbidden" | "error" };

export async function listInvites(signal?: AbortSignal): Promise<ListResult> {
  try {
    const res = await request("GET", "/admin/invites", undefined, signal);
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 403) return { status: "forbidden" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", invites: inviteListResponseSchema.parse(await res.json()).invites };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type CreateResult =
  | { status: "ok"; invite: InviteSummary; invitePath: string }
  | { status: "failed"; code: string; http: number }
  | { status: "error" };

export async function createInvite(email: string): Promise<CreateResult> {
  try {
    const res = await request("POST", "/admin/invites", { email });
    if (!res.ok) return { status: "failed", code: await errorCode(res), http: res.status };
    const { invite, invitePath } = createInviteResponseSchema.parse(await res.json());
    return { status: "ok", invite, invitePath };
  } catch {
    return { status: "error" };
  }
}

export type RevokeResult = { status: "ok" | "gone" | "used" | "error" };

export async function revokeInvite(id: string): Promise<RevokeResult> {
  try {
    const res = await request("DELETE", `/admin/invites/${encodeURIComponent(id)}`);
    if (res.status === 204) return { status: "ok" };
    if (res.status === 404) return { status: "gone" };
    if (res.status === 409) return { status: (await errorCode(res)) === "invite_used" ? "used" : "error" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}
