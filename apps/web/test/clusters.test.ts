import { describe, expect, it } from "vitest";
import { allSamePlace, fitRing, groupPins, ringOffsets } from "../src/lib/clusters";

const pin = (id: string, x: number, y: number) => ({ id, x, y });

describe("groupPins", () => {
  it("merges pins closer than 44 px and keeps pins at 44 px or more apart", () => {
    const g = groupPins([pin("a", 0, 0), pin("b", 43.9, 0), pin("c", 200, 0), pin("d", 244, 0)], null);
    expect(g.clusters.map((c) => c.members.map((m) => m.id))).toEqual([["a", "b"]]);
    expect(g.singles.map((s) => s.id)).toEqual(["c", "d"]);
  });

  it("is greedy in pin order: the first pin takes its neighbours, a chain does not pull in the rest", () => {
    // a-b 30, b-c 30, a-c 60: a takes b, c stays alone (b is already used).
    const g = groupPins([pin("a", 0, 0), pin("b", 30, 0), pin("c", 60, 0)], null);
    expect(g.clusters.map((c) => c.members.map((m) => m.id))).toEqual([["a", "b"]]);
    expect(g.singles.map((s) => s.id)).toEqual(["c"]);
    // The cluster anchors at the member closest to the centroid.
    expect(groupPins([pin("a", 0, 0), pin("b", 30, 0), pin("c", 14, 0)], null).clusters[0]!.anchor.id).toBe("c");
    // Pins on identical coordinates stay together.
    const same = groupPins([pin("a", 5, 5), pin("b", 5, 5), pin("c", 5, 5)], null);
    expect(same.clusters[0]!.members).toHaveLength(3);
    expect(allSamePlace(same.clusters[0]!.members)).toBe(true);
    expect(allSamePlace([pin("a", 0, 0), pin("b", 1, 0)])).toBe(false);
  });

  it("never puts the selected pin in a cluster, so the count excludes it", () => {
    const g = groupPins([pin("a", 0, 0), pin("b", 10, 0), pin("c", 20, 0)], "b");
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0]!.members.map((m) => m.id)).toEqual(["a", "c"]);
    // With only one neighbour left, the group dissolves into a plain pin.
    expect(groupPins([pin("a", 0, 0), pin("b", 10, 0)], "b").clusters).toHaveLength(0);
  });
});

describe("split ring", () => {
  it("keeps fanned pins at least 56 px apart for every group size up to 8", () => {
    for (let n = 2; n <= 8; n++) {
      const o = ringOffsets(n);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(o[i]!.dx - o[j]!.dx, o[i]!.dy - o[j]!.dy)).toBeGreaterThanOrEqual(56 - 1e-6);
    }
  });

  it("shifts the ring inward so it stays below the top bar and inside the screen", () => {
    const offs = ringOffsets(6);
    const c = fitRing({ x: 10, y: 90 }, offs, { left: 8, top: 82, right: 375, bottom: 700 });
    for (const o of offs) {
      expect(c.x + o.dx - 24).toBeGreaterThanOrEqual(8);
      expect(c.y + o.dy - 23).toBeGreaterThanOrEqual(82);
    }
  });
});
