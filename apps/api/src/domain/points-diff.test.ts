import { describe, expect, it } from "vitest";
import type { Point, PointDraft } from "@atlas/contract";
import { diffPoints, isEmptyDiff } from "./points-diff";
import { chunkByJsonBytes } from "../adapters/d1-event-points-repository";

const p = (id: string, over: Partial<Point> = {}): Point => ({ id, name: "Main", category: "stage", description: "", x: 0.5, y: 0.5, ...over });
const draft = (over: Partial<PointDraft> = {}): PointDraft => ({ category: "stage", name: "Main", description: "", x: 0.5, y: 0.5, ...over });
let n = 0;
const newId = () => `new-${++n}`;

describe("diffPoints", () => {
  it("an unchanged set produces no writes", () => {
    const current = [p("a"), p("b", { category: "toilets", name: null })];
    const r = diffPoints(current, [draft({ id: "a" }), draft({ id: "b", category: "toilets", name: null })], newId);
    expect(r.ok && isEmptyDiff(r.diff)).toBe(true);
    expect(r.ok && r.diff.finalCount).toBe(2);
  });

  it("creates (with the request index), updates changed rows only and deletes the ones left out", () => {
    const current = [p("a"), p("b"), p("c")];
    const r = diffPoints(current, [draft({ id: "a", x: 0.9 }), draft({ id: "b" }), draft({ name: "Fresh" })], newId);
    if (!r.ok) throw new Error("expected ok");
    expect(r.diff.toUpdate.map((x) => x.id)).toEqual(["a"]);
    expect(r.diff.toDelete).toEqual(["c"]);
    expect(r.diff.toCreate).toHaveLength(1);
    expect(r.diff.toCreate[0]).toMatchObject({ index: 2, point: { name: "Fresh" } });
    expect(r.diff.finalCount).toBe(3);
  });

  it("null and a real name are different, and two nulls are equal", () => {
    const current = [p("t", { category: "toilets", name: null })];
    const named = diffPoints(current, [draft({ id: "t", category: "toilets", name: "North" })], newId);
    expect(named.ok && named.diff.toUpdate).toHaveLength(1);
    const same = diffPoints(current, [draft({ id: "t", category: "toilets", name: null })], newId);
    expect(same.ok && isEmptyDiff(same.diff)).toBe(true);
  });

  it("an id that is not a current Point of the event is refused, with nothing computed", () => {
    expect(diffPoints([p("a")], [draft({ id: "someone-elses" })], newId)).toEqual({ ok: false, reason: "unknown_point_id" });
  });

  it("an empty request deletes everything", () => {
    const r = diffPoints([p("a"), p("b")], [], newId);
    expect(r.ok && r.diff.toDelete).toEqual(["a", "b"]);
    expect(r.ok && r.diff.finalCount).toBe(0);
  });
});

describe("chunkByJsonBytes", () => {
  it("keeps a normal save in one group and splits a big one under the limit, losing nothing", () => {
    const small = Array.from({ length: 100 }, (_, i) => p(`p${i}`));
    expect(chunkByJsonBytes(small)).toHaveLength(1);
    const big = Array.from({ length: 150 }, (_, i) => p(`p${i}`, { description: "é".repeat(500) }));
    const groups = chunkByJsonBytes(big, 60_000);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toEqual(big);
    for (const g of groups) expect(new TextEncoder().encode(JSON.stringify(g)).length).toBeLessThanOrEqual(60_000);
    expect(chunkByJsonBytes([])).toEqual([]);
  });
});
