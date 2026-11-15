import { panelSessionsResponseSchema, saveSessionsResponseSchema, type PanelSessionsResponse } from "@atlas/contract";

// Slice 13: the Schedule editor's two calls (load the whole set, save the whole set). Memory only; the unsaved-changes
// draft lives in lib/scheduleDraft.ts. The server is the authority. Never retried here.
const BASE = "/api/v1/panel/events";

/** What goes over the wire. New sessions carry no `id`: the server assigns it. */
export type SessionItem = { id?: string; pointId: string; title: string; start: string; end: string; description?: string };
export type SaveBody = { baseUpdatedAt: string; sessions: SessionItem[] };

export type SessionFieldError = { index: number; field: string; code: string };

export type LoadResult = ({ status: "ok" } & PanelSessionsResponse) | { status: "unauthenticated" | "not_found" | "error" };

export type SaveResult =
  | ({ status: "ok"; created: { index: number; id: string }[] } & PanelSessionsResponse)
  | { status: "unauthenticated" | "not_found" | "event_changed" | "too_large" | "error" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid"; fields: SessionFieldError[]; general: string[] };

export async function getSessions(eventId: string, signal?: AbortSignal): Promise<LoadResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/sessions`, { signal, headers: { Accept: "application/json" } });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "error" };
    return { status: "ok", ...panelSessionsResponseSchema.parse(await res.json()) };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}

/** "sessions.3.start" -> { index: 3, field: "start" }. */
export function parseSessionPath(path: unknown, code: unknown): SessionFieldError | null {
  const m = typeof path === "string" ? /^sessions\.(\d+)\.([a-zA-Z]+)$/.exec(path) : null;
  return m && typeof code === "string" ? { index: Number(m[1]), field: m[2]!, code } : null;
}

export async function saveSessions(eventId: string, body: SaveBody): Promise<SaveResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/sessions`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 413) return { status: "too_large" };
    if (res.status === 429) {
      const n = Number(res.headers.get("Retry-After"));
      return { status: "rate_limited", retryAfter: Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60 };
    }
    if (res.ok) {
      const d = saveSessionsResponseSchema.parse(await res.json());
      return { status: "ok", ...d };
    }
    let code = "error";
    let fields: unknown;
    try {
      const j = await res.json();
      code = typeof j?.error?.code === "string" ? j.error.code : "error";
      fields = j?.error?.fields;
    } catch {
      /* no body */
    }
    if (res.status === 409 && code === "event_changed") return { status: "event_changed" };
    if (res.status === 400 && code === "validation_error") {
      const list = Array.isArray(fields) ? fields : [];
      const item = list.map((f: any) => parseSessionPath(f?.path, f?.code)).filter((f): f is SessionFieldError => !!f);
      const general = list.filter((f: any) => typeof f?.path === "string" && !/^sessions\.\d+\./.test(f.path)).map((f: any) => `${f.path}:${f.code}`);
      return { status: "invalid", fields: item, general };
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}
