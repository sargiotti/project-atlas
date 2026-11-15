import {
  eventPreviewResponseSchema,
  fieldErrorSchema,
  panelEventListResponseSchema,
  panelEventResponseSchema,
  type EventPreviewResponse,
  type FieldError,
  type PanelEvent,
} from "@atlas/contract";
import { z } from "zod";

// Organizer events (slice 07). Everything returned here lives in React state only: never localStorage or
// sessionStorage (shared devices). The one accepted exception (security P4, slice 08c) is the Points editor's
// unsaved-changes draft: the organizer's own non-secret Points of one event, scoped by organizer and event, wiped on
// sign out (lib/pointsDraft.ts). The server is the authority; the SPA only maps statuses to screens.
const BASE = "/api/v1/panel";

type Fail = { status: "unauthenticated" } | { status: "not_found" } | { status: "error" };
const rethrowAbort = (e: any) => {
  if (e?.name === "AbortError") throw e;
};

async function call(method: string, path: string, body?: unknown, signal?: AbortSignal) {
  return fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Statuses every panel route shares. 401 -> login, 404 -> generic not found; the UI never probes further. */
function common(res: Response): Fail | null {
  if (res.status === 401) return { status: "unauthenticated" };
  if (res.status === 404) return { status: "not_found" };
  return null;
}

async function errorBody(res: Response): Promise<{ code: string; fields: FieldError[]; count: number }> {
  try {
    const j = await res.json();
    const parsed = z.array(fieldErrorSchema).safeParse(j?.error?.fields);
    const count = Number.isInteger(j?.error?.count) && j.error.count > 0 ? j.error.count : 0;
    return { code: typeof j?.error?.code === "string" ? j.error.code : "error", fields: parsed.success ? parsed.data : [], count };
  } catch {
    return { code: "error", fields: [], count: 0 };
  }
}

export type ListResult = { status: "ok"; events: PanelEvent[] } | Fail;
export async function listEvents(signal?: AbortSignal): Promise<ListResult> {
  try {
    const res = await call("GET", "/events", undefined, signal);
    const c = common(res);
    if (c) return c;
    if (!res.ok) return { status: "error" };
    return { status: "ok", events: panelEventListResponseSchema.parse(await res.json()).events };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type GetResult = { status: "ok"; event: PanelEvent } | Fail;
export async function getEvent(id: string, signal?: AbortSignal): Promise<GetResult> {
  try {
    const res = await call("GET", `/events/${encodeURIComponent(id)}`, undefined, signal);
    const c = common(res);
    if (c) return c;
    if (!res.ok) return { status: "error" };
    return { status: "ok", event: panelEventResponseSchema.parse(await res.json()).event };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type PreviewResult = { status: "ok"; preview: EventPreviewResponse } | Fail;
export async function getPreview(id: string, signal?: AbortSignal): Promise<PreviewResult> {
  try {
    const res = await call("GET", `/events/${encodeURIComponent(id)}/preview`, undefined, signal);
    const c = common(res);
    if (c) return c;
    if (!res.ok) return { status: "error" };
    return { status: "ok", preview: eventPreviewResponseSchema.parse(await res.json()) };
  } catch (e) {
    rethrowAbort(e);
    return { status: "error" };
  }
}

export type SaveResult =
  | { status: "ok"; event: PanelEvent }
  | { status: "invalid"; fields: FieldError[] }
  | { status: "limit" }
  /** Slice 13: the new dates or time zone would leave `count` shows outside the event. Nothing was saved. */
  | { status: "sessions_outside_dates"; count: number }
  | Fail;

async function save(method: "POST" | "PUT", path: string, input: unknown): Promise<SaveResult> {
  try {
    const res = await call(method, path, input);
    const c = common(res);
    if (c) return c;
    if (res.ok) return { status: "ok", event: panelEventResponseSchema.parse(await res.json()).event };
    const { code, fields, count } = await errorBody(res);
    if (res.status === 400 && code === "validation_error") return { status: "invalid", fields };
    if (res.status === 409 && code === "sessions_outside_dates") return { status: "sessions_outside_dates", count };
    if (res.status === 409 && code === "event_limit_reached") return { status: "limit" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

export const createEvent = (input: unknown) => save("POST", "/events", input);
export const updateEvent = (id: string, input: unknown) => save("PUT", `/events/${encodeURIComponent(id)}`, input);

export type DeleteResult = { status: "ok" } | Fail;
export async function deleteEvent(id: string): Promise<DeleteResult> {
  try {
    const res = await call("DELETE", `/events/${encodeURIComponent(id)}`);
    if (res.status === 204 || res.status === 200) return { status: "ok" };
    return common(res) ?? { status: "error" };
  } catch {
    return { status: "error" };
  }
}
