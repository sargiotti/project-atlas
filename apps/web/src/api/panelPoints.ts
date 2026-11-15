import { panelPointsResponseSchema, savePointsResponseSchema, type Point } from "@atlas/contract";

// Slice 08c: the Points editor's two calls (load the set, save the whole set). Memory only here; the one accepted
// localStorage exception (the unsaved-changes draft) lives in lib/pointsDraft.ts. The server is the authority.
const BASE = "/api/v1/panel/events";

/** A Point as the editor routes return it. `name` is null when there is no custom name (Just-drop categories). */
export type ServerPoint = Point;

/** What goes over the wire. New Points carry no `id`: the server assigns it. */
export type DraftItem = { id?: string; category: string; name: string | null; description: string; x: number; y: number };
export type SaveBody = { baseUpdatedAt: string; points: DraftItem[] };

export type PointFieldError = { index: number; field: string; code: string };

export type LoadResult =
  | { status: "ok"; points: ServerPoint[]; eventUpdatedAt: string }
  | { status: "unauthenticated" | "not_found" | "map_required" | "error" };

export type SaveResult =
  | { status: "ok"; points: ServerPoint[]; eventUpdatedAt: string; created: { index: number; id: string }[] }
  | { status: "unauthenticated" | "not_found" | "map_required" | "event_changed" | "too_large" | "error" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid"; fields: PointFieldError[] };

async function codeOf(res: Response): Promise<{ code: string; fields: unknown }> {
  try {
    const j = await res.json();
    return { code: typeof j?.error?.code === "string" ? j.error.code : "error", fields: j?.error?.fields };
  } catch {
    return { code: "error", fields: undefined };
  }
}

export async function getPoints(eventId: string, signal?: AbortSignal): Promise<LoadResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/points`, { signal, headers: { Accept: "application/json" } });
    if (res.status === 401) return { status: "unauthenticated" };
    if (res.status === 404) return { status: "not_found" };
    if (res.status === 409) return (await codeOf(res)).code === "map_required" ? { status: "map_required" } : { status: "error" };
    if (!res.ok) return { status: "error" };
    const d = panelPointsResponseSchema.parse(await res.json());
    return { status: "ok", points: d.points, eventUpdatedAt: d.eventUpdatedAt };
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    return { status: "error" };
  }
}

/** "points.3.name" -> { index: 3, field: "name" }. Anything else is not about a single Point. */
export function parseFieldPath(path: unknown, code: unknown): PointFieldError | null {
  const m = typeof path === "string" ? /^points\.(\d+)\.([a-zA-Z]+)$/.exec(path) : null;
  return m && typeof code === "string" ? { index: Number(m[1]), field: m[2]!, code } : null;
}

/** One PUT with the full desired set. Never retried here (see the 429 / 409 rules of the slice). */
export async function savePoints(eventId: string, body: SaveBody): Promise<SaveResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/points`, {
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
      const d = savePointsResponseSchema.parse(await res.json());
      return { status: "ok", points: d.points, eventUpdatedAt: d.eventUpdatedAt, created: d.created };
    }
    const { code, fields } = await codeOf(res);
    if (res.status === 409 && code === "event_changed") return { status: "event_changed" };
    if (res.status === 409 && code === "map_required") return { status: "map_required" };
    if (res.status === 400 && code === "validation_error") {
      const list = Array.isArray(fields) ? fields.map((f: any) => parseFieldPath(f?.path, f?.code)).filter((f): f is PointFieldError => !!f) : [];
      return { status: "invalid", fields: list };
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}
