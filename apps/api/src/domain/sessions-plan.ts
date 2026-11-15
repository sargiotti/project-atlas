import {
  MAX_SESSIONS_PER_EVENT,
  MAX_SESSIONS_PER_POINT,
  canHaveSessions,
  isInSessionWindow,
  parseUtcInstant,
  type FieldError,
  type PointCategory,
  type Session,
  type SessionDraft,
  type SessionWindow,
} from "@atlas/contract";

/** Slice 13: what a "save the whole set of Sessions" request changes. Pure: no I/O, no framework. */
export interface SessionsPlan {
  /** `index` is the position in the request, so the client can map its temporary ids to the new ones. */
  toCreate: Array<{ index: number; session: Session }>;
  toUpdate: Session[];
  toDelete: string[];
  /** Number of Sessions the event has after the save. */
  finalCount: number;
  /** The whole resulting set (unsorted). */
  result: Session[];
}

export type PlanResult =
  | { ok: true; plan: SessionsPlan }
  | { ok: false; reason: "unknown_session_id" | "unknown_point_id" }
  | { ok: false; reason: "invalid"; fields: FieldError[] };

export const MAX_FIELD_ERRORS = 20;

const unchanged = (a: Session, b: Session) =>
  a.pointId === b.pointId && a.title === b.title && (a.description ?? "") === (b.description ?? "") && a.start === b.start && a.end === b.end;

/**
 * `drafts` are validated and normalized (`saveSessionsRequestSchema`); `points` maps every Point id of THIS event to its
 * category; `current` are the event's stored Sessions.
 *
 * Order of refusals: an item naming a Session id that is not the event's, or a Point id that is not the event's, is
 * `unknown_*` (the caller answers the uniform 404, nothing else is said). Only then the semantic 400s, all on the full
 * resulting set: category of the Point, start inside the window, at most 150 per Point, no overlap per Point
 * (half-open `[start, end)`; touching is fine; sort + linear scan). Unchanged Sessions produce no write.
 */
export function planSessions(args: {
  current: readonly Session[];
  drafts: readonly SessionDraft[];
  points: ReadonlyMap<string, PointCategory>;
  window: SessionWindow;
  newId: () => string;
}): PlanResult {
  const { current, drafts, points, window, newId } = args;
  const byId = new Map(current.map((s) => [s.id, s] as const));

  for (const d of drafts) {
    if (d.id !== undefined && !byId.has(d.id)) return { ok: false, reason: "unknown_session_id" };
    if (!points.has(d.pointId)) return { ok: false, reason: "unknown_point_id" };
  }

  const fields: FieldError[] = [];
  const seen = new Set<string>();
  const flag = (path: FieldError["path"], code: FieldError["code"]) => {
    const key = `${path}:${code}`;
    if (fields.length < MAX_FIELD_ERRORS && !seen.has(key)) {
      seen.add(key);
      fields.push({ path, code } as FieldError);
    }
  };

  const keep = new Set<string>();
  const toCreate: SessionsPlan["toCreate"] = [];
  const toUpdate: Session[] = [];
  const result: Session[] = [];
  const perPoint = new Map<string, Array<{ index: number; start: number; end: number }>>();

  drafts.forEach((d, index) => {
    const session: Session = {
      id: d.id ?? newId(),
      pointId: d.pointId,
      title: d.title,
      start: d.start,
      end: d.end,
      ...(d.description === undefined ? {} : { description: d.description }),
    };
    result.push(session);
    if (d.id === undefined) toCreate.push({ index, session });
    else {
      keep.add(d.id);
      if (!unchanged(byId.get(d.id)!, session)) toUpdate.push(session);
    }

    if (!canHaveSessions(points.get(d.pointId)!)) flag(`sessions.${index}.pointId` as FieldError["path"], "invalid");
    const start = parseUtcInstant(d.start)!;
    const end = parseUtcInstant(d.end)!;
    if (!isInSessionWindow(start, window)) flag(`sessions.${index}.start` as FieldError["path"], "outside_dates");
    const list = perPoint.get(d.pointId) ?? [];
    list.push({ index, start, end });
    perPoint.set(d.pointId, list);
    if (list.length === MAX_SESSIONS_PER_POINT + 1) flag(`sessions.${index}.pointId` as FieldError["path"], "too_long");
  });

  // Overlap per Point on the full resulting set: sort by start, then a running maximum end. The later item is flagged.
  for (const list of perPoint.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
    let maxEnd = -Infinity;
    for (const it of list) {
      if (it.start < maxEnd) flag(`sessions.${it.index}.start` as FieldError["path"], "overlap");
      if (it.end > maxEnd) maxEnd = it.end;
    }
  }

  const toDelete = current.filter((s) => !keep.has(s.id)).map((s) => s.id);
  const finalCount = result.length;
  if (finalCount > MAX_SESSIONS_PER_EVENT) flag("sessions", "too_long");

  if (fields.length > 0) return { ok: false, reason: "invalid", fields };
  return { ok: true, plan: { toCreate, toUpdate, toDelete, finalCount, result } };
}

export const isEmptyPlan = (p: SessionsPlan) => p.toCreate.length === 0 && p.toUpdate.length === 0 && p.toDelete.length === 0;
