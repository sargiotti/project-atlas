import { JUST_DROP_CATEGORIES, MAX_POINTS_PER_MAP, NAME_IT_CATEGORIES, POINTS_SAVE_BODY_LIMIT, POINT_CATEGORIES, POINT_DESCRIPTION_MAX, POINT_NAME_MAX } from "@atlas/contract";
import type { DraftItem, ServerPoint } from "../api/panelPoints";

// Slice 08c. The editor's local model: everything (place, move, name, delete, undo) happens here, nothing is sent
// until Save. Limits and category groups mirror the contract (the server re-checks every one).
export const NAME_IT = NAME_IT_CATEGORIES;
export const JUST_DROP = JUST_DROP_CATEGORIES;
export { POINT_NAME_MAX, POINT_DESCRIPTION_MAX, POINT_CATEGORIES };
export const MAX_POINTS = MAX_POINTS_PER_MAP;
export const MAX_BODY_BYTES = POINTS_SAVE_BODY_LIMIT;

export const isNameIt = (category: string) => (NAME_IT as readonly string[]).includes(category);

/** `key` is the local identity (the server id for saved Points, a temporary one for new). `id` exists only once saved. */
export type EditorPoint = { key: string; id?: string; category: string; name: string | null; description: string; x: number; y: number };

export const fromServer = (p: ServerPoint): EditorPoint => ({ key: p.id, id: p.id, category: p.category, name: p.name, description: p.description, x: p.x, y: p.y });

let tmp = 0;
export const newKey = () => `tmp-${Date.now().toString(36)}-${(tmp++).toString(36)}`;

const round5 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e5) / 1e5;

/** Length in code points, as the server counts it (after NFC and trim). */
export const cpLen = (s: string) => [...s.normalize("NFC").trim()].length;

const cleanName = (name: string | null) => {
  const n = (name ?? "").normalize("NFC").trim();
  return n === "" ? null : n;
};
const cleanDesc = (d: string) => d.normalize("NFC").replace(/\r\n/g, "\n").trim();

/** The normalized shape of a Point: what is compared (unsaved counter) and what is sent. New Points have no `id`. */
export function toItem(p: EditorPoint): DraftItem {
  const item: DraftItem = { category: p.category, name: cleanName(p.name), description: cleanDesc(p.description), x: round5(p.x), y: round5(p.y) };
  return p.id ? { id: p.id, ...item } : item;
}

const sameItem = (a: DraftItem, b: DraftItem) =>
  a.category === b.category && a.name === b.name && a.description === b.description && a.x === b.x && a.y === b.y;

/** Created + changed + deleted Points against the last saved set. A Point added and removed again counts 0. */
export function countChanges(saved: EditorPoint[], current: EditorPoint[]): number {
  const base = new Map(saved.map((p) => [p.id!, toItem(p)]));
  let n = 0;
  const seen = new Set<string>();
  for (const p of current) {
    if (!p.id) n++;
    else {
      seen.add(p.id);
      const b = base.get(p.id);
      if (!b || !sameItem(b, toItem(p))) n++;
    }
  }
  for (const id of base.keys()) if (!seen.has(id)) n++;
  return n;
}

export const needsName = (p: EditorPoint) => isNameIt(p.category) && cleanName(p.name) === null;

export type Issue = { key: string; field: "name" | "description"; code: "required" | "too_long" };

/** Everything that blocks Save (AC8, AC14). Just-drop with a blank name is fine: it just means "no custom name". */
export function validate(points: EditorPoint[]): Issue[] {
  const out: Issue[] = [];
  for (const p of points) {
    const name = cleanName(p.name);
    if (isNameIt(p.category) && name === null) out.push({ key: p.key, field: "name", code: "required" });
    else if (name !== null && cpLen(name) > POINT_NAME_MAX) out.push({ key: p.key, field: "name", code: "too_long" });
    if (cpLen(p.description) > POINT_DESCRIPTION_MAX) out.push({ key: p.key, field: "description", code: "too_long" });
  }
  return out;
}

export const bodyBytes = (json: string) => new TextEncoder().encode(json).length;

/**
 * A draft put back on top of the server's current set. The draft only knows what the organizer's screen looked like,
 * not what they had deleted, so against a NEWER server set (`sameBase` false) it is merged, never allowed to delete
 * what it does not mention: Points that exist only on the server stay. A Point the server no longer has comes back as
 * a new one (the server rejects unknown ids).
 */
export function mergeDraft(draft: EditorPoint[], server: EditorPoint[], sameBase: boolean): EditorPoint[] {
  const ids = new Set(server.map((p) => p.id));
  const mine = draft.map((p) => (p.id && !ids.has(p.id) ? { ...p, id: undefined, key: newKey() } : p));
  if (sameBase) return mine;
  const kept = new Set(mine.map((p) => p.id).filter(Boolean));
  return [...mine, ...server.filter((p) => !kept.has(p.id))];
}
