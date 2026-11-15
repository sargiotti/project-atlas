import { MAX_SESSIONS_PER_EVENT, MAX_SESSIONS_PER_POINT, SESSIONS_SAVE_BODY_LIMIT, SESSION_DESCRIPTION_MAX, SESSION_TITLE_MAX, isInSessionWindow, parseUtcInstant, type Session, type SessionWindow } from "@atlas/contract";
import type { SessionItem } from "../api/panelSessions";
import { cpLen } from "./pointsModel";

// Slice 13. The Schedule editor's local model: add, edit, delete and undo only change this list; nothing is sent until
// Save. Times travel as UTC instants (`2026-12-04T23:30:00Z`); the `start`/`end` strings are the source of truth.
export { SESSION_TITLE_MAX, SESSION_DESCRIPTION_MAX, MAX_SESSIONS_PER_POINT, MAX_SESSIONS_PER_EVENT };
export const MAX_BODY_BYTES = SESSIONS_SAVE_BODY_LIMIT;

/** `key` is the local identity (the server id for saved sessions, a temporary one for new). `id` exists only once saved. */
export type EditorSession = { key: string; id?: string; pointId: string; title: string; description: string; start: string; end: string };

export const fromServer = (s: Session): EditorSession => ({ key: s.id, id: s.id, pointId: s.pointId, title: s.title, description: s.description ?? "", start: s.start, end: s.end });

let tmp = 0;
export const newKey = () => `tmp-${Date.now().toString(36)}-${(tmp++).toString(36)}`;

const cleanTitle = (t: string) => t.normalize("NFC").replace(/\r\n?|\n/g, " ").trim();
const cleanDesc = (d: string) => d.normalize("NFC").replace(/\r\n?/g, "\n").trim();

/** The normalized shape of a session: what is compared (unsaved counter) and what is sent. New sessions have no `id`. */
export function toItem(s: EditorSession): SessionItem {
  const description = cleanDesc(s.description);
  const item: SessionItem = { pointId: s.pointId, title: cleanTitle(s.title), start: s.start, end: s.end, ...(description ? { description } : {}) };
  return s.id ? { id: s.id, ...item } : item;
}

const sameItem = (a: SessionItem, b: SessionItem) =>
  a.pointId === b.pointId && a.title === b.title && a.start === b.start && a.end === b.end && (a.description ?? "") === (b.description ?? "");

/** Created + changed + deleted against the last saved set. A session added and removed again counts 0. */
export function countChanges(saved: EditorSession[], current: EditorSession[]): number {
  const base = new Map(saved.map((s) => [s.id!, toItem(s)]));
  let n = 0;
  const seen = new Set<string>();
  for (const s of current) {
    if (!s.id) n++;
    else {
      seen.add(s.id);
      const b = base.get(s.id);
      if (!b || !sameItem(b, toItem(s))) n++;
    }
  }
  for (const id of base.keys()) if (!seen.has(id)) n++;
  return n;
}

export const bodyBytes = (json: string) => new TextEncoder().encode(json).length;

export const msOf = (iso: string) => parseUtcInstant(iso) ?? NaN;

export type Problem = { kind: "overlap"; with: EditorSession } | { kind: "outside" } | { kind: "text" };

/**
 * Everything that would make the server refuse the save (so Save can say so first): overlaps per place (half open,
 * touching is fine), a start outside the event window, an empty or too long title, a too long description.
 * Keyed by session key; at most one problem per session (the first found).
 */
export function findProblems(sessions: EditorSession[], window: SessionWindow | null): Map<string, Problem> {
  const out = new Map<string, Problem>();
  const byPoint = new Map<string, EditorSession[]>();
  for (const s of sessions) {
    const title = cleanTitle(s.title);
    if (window && !isInSessionWindow(msOf(s.start), window)) out.set(s.key, { kind: "outside" });
    else if (title === "" || cpLen(title) > SESSION_TITLE_MAX || cpLen(s.description) > SESSION_DESCRIPTION_MAX) out.set(s.key, { kind: "text" });
    const list = byPoint.get(s.pointId);
    if (list) list.push(s);
    else byPoint.set(s.pointId, [s]);
  }
  for (const list of byPoint.values()) {
    const sorted = list.slice().sort((a, b) => msOf(a.start) - msOf(b.start) || msOf(a.end) - msOf(b.end));
    let prev: EditorSession | null = null;
    for (const s of sorted) {
      if (prev && msOf(s.start) < msOf(prev.end) && !out.has(s.key)) out.set(s.key, { kind: "overlap", with: prev });
      if (!prev || msOf(s.end) > msOf(prev.end)) prev = s;
    }
  }
  return out;
}

/**
 * A draft put back on top of the server's current set. Against a NEWER server set (`sameBase` false) it is merged, never
 * allowed to delete what it does not mention (server-only sessions stay). A session the server no longer has comes back
 * as a new one (the server rejects unknown ids). Sessions whose place is gone (or is no longer a stage or landmark) are
 * dropped and counted; they are never sent.
 */
export function mergeDraft(draft: EditorSession[], server: EditorSession[], sameBase: boolean, pointIds: ReadonlySet<string>): { sessions: EditorSession[]; dropped: number } {
  const ids = new Set(server.map((s) => s.id));
  const live = draft.filter((s) => pointIds.has(s.pointId));
  const dropped = draft.length - live.length;
  const mine = live.map((s) => (s.id && !ids.has(s.id) ? { ...s, id: undefined, key: newKey() } : s));
  if (sameBase) return { sessions: mine, dropped };
  const kept = new Set(mine.map((s) => s.id).filter(Boolean));
  return { sessions: [...mine, ...server.filter((s) => !kept.has(s.id))], dropped };
}

export const sortSessions = (list: EditorSession[]) => list.slice().sort((a, b) => msOf(a.start) - msOf(b.start) || msOf(a.end) - msOf(b.end) || a.key.localeCompare(b.key));
