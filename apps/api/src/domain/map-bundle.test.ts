import { describe, expect, it } from "vitest";
import { sortPoints } from "./map-bundle";

const p = (id: string, name: string, category: "stage" | "food" | "toilets") => ({
  id, name, category, description: "", x: 0, y: 0,
});

describe("sortPoints", () => {
  it("orders by category enum order, then name, then id", () => {
    const sorted = sortPoints([
      p("c", "Zed", "toilets"),
      p("b", "Alpha", "food"),
      p("a2", "Alpha", "stage"),
      p("a1", "Alpha", "stage"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["a1", "a2", "b", "c"]);
  });
});
