import { MAX_POINTS_PER_MAP, type Point, type PointDraft } from "@atlas/contract";

/** Slice 08c: what a "save the whole set" request changes. Pure: no I/O, no framework. O(n) in both sets. */
export interface PointsDiff {
  /** `index` is the position in the request, so the client can map its temporary ids to the new ones. */
  toCreate: Array<{ index: number; point: Point }>;
  toUpdate: Point[];
  toDelete: string[];
  /** Number of Points the event has after the save. */
  finalCount: number;
}

export type DiffResult = { ok: true; diff: PointsDiff } | { ok: false; reason: "unknown_point_id" | "too_many_points" };

const sameNullable = (a: string | null, b: string | null) => a === b;

const unchanged = (a: Point, b: Point) =>
  a.category === b.category && sameNullable(a.name, b.name) && a.description === b.description && a.x === b.x && a.y === b.y;

/**
 * `drafts` are validated and normalized (`savePointsRequestSchema`). An item with an `id` must be a current Point
 * of the event; anything else is `unknown_point_id` (the caller answers the uniform 404). Unchanged Points produce
 * no write. Current Points absent from the request are deleted.
 */
export function diffPoints(current: readonly Point[], drafts: readonly PointDraft[], newId: () => string): DiffResult {
  const byId = new Map(current.map((p) => [p.id, p] as const));
  const keep = new Set<string>();
  const toCreate: PointsDiff["toCreate"] = [];
  const toUpdate: Point[] = [];

  for (let index = 0; index < drafts.length; index++) {
    const d = drafts[index]!;
    if (d.id === undefined) {
      toCreate.push({ index, point: { id: newId(), name: d.name, category: d.category, description: d.description, x: d.x, y: d.y } });
      continue;
    }
    const before = byId.get(d.id);
    if (!before) return { ok: false, reason: "unknown_point_id" };
    keep.add(d.id);
    const after: Point = { id: d.id, name: d.name, category: d.category, description: d.description, x: d.x, y: d.y };
    if (!unchanged(before, after)) toUpdate.push(after);
  }

  const toDelete = current.filter((p) => !keep.has(p.id)).map((p) => p.id);
  const finalCount = current.length - toDelete.length + toCreate.length;
  if (finalCount > MAX_POINTS_PER_MAP) return { ok: false, reason: "too_many_points" };
  return { ok: true, diff: { toCreate, toUpdate, toDelete, finalCount } };
}

export const isEmptyDiff = (d: PointsDiff) => d.toCreate.length === 0 && d.toUpdate.length === 0 && d.toDelete.length === 0;
