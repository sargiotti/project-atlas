import { describe, expect, it } from "vitest";
import { MAX_POINTS_PER_MAP, pointSchema, savePointsRequestSchema, toPointFieldErrors } from "@atlas/contract";

const BASE = "2026-11-15T10:00:00.000Z";
const body = (points: unknown[], extra: Record<string, unknown> = {}) => ({ baseUpdatedAt: BASE, points, ...extra });
const item = (over: Record<string, unknown> = {}) => ({ category: "stage", name: "Main stage", description: "", x: 0.5, y: 0.5, ...over });
const parse = (v: unknown) => savePointsRequestSchema.safeParse(v);
const errors = (v: unknown) => {
  const r = parse(v);
  if (r.success) throw new Error("expected a validation error");
  return toPointFieldErrors(r.error);
};

describe("savePointsRequestSchema: name rules per category group", () => {
  it("Name-it needs a name of 1-80 code points, trimmed and NFC", () => {
    const ok = parse(body([item({ name: "  Café  " })]));
    expect(ok.success && ok.data.points[0]!.name).toBe("Café");
    expect(errors(body([item({ name: null })]))).toEqual([{ path: "points.0.name", code: "required" }]);
    expect(errors(body([item({ category: "food", name: undefined })]))).toEqual([{ path: "points.0.name", code: "required" }]);
    expect(errors(body([item({ name: "   " })]))).toEqual([{ path: "points.0.name", code: "too_short" }]);
    expect(errors(body([item({ name: "" })]))).toEqual([{ path: "points.0.name", code: "too_short" }]);
    expect(parse(body([item({ name: "a".repeat(80) })])).success).toBe(true);
    expect(errors(body([item({ name: "a".repeat(81) })]))).toEqual([{ path: "points.0.name", code: "too_long" }]);
    // 80 astral characters are 80 code points (160 UTF-16 units): allowed. 81 are not.
    expect(parse(body([item({ name: "\u{1F600}".repeat(80) })])).success).toBe(true);
    expect(errors(body([item({ name: "\u{1F600}".repeat(81) })]))).toEqual([{ path: "points.0.name", code: "too_long" }]);
  });

  it("Just-drop: null, absent and blank all mean no custom name; a real name is kept", () => {
    for (const category of ["toilets", "first-aid", "info", "entrance-exit"]) {
      for (const name of [null, undefined, "", "   ", "\t \n"]) {
        const r = parse(body([item({ category, name })]));
        expect(r.success && r.data.points[0]!.name).toBeNull();
      }
      const named = parse(body([item({ category, name: " North toilets " })]));
      expect(named.success && named.data.points[0]!.name).toBe("North toilets");
      expect(errors(body([item({ category, name: "a".repeat(81) })]))).toEqual([{ path: "points.0.name", code: "too_long" }]);
    }
  });

  it("rejects control, bidi and invisible characters in the name and the description", () => {
    expect(errors(body([item({ name: "Main\nstage" })]))).toEqual([{ path: "points.0.name", code: "control_chars" }]);
    expect(errors(body([item({ name: "Main‮stage" })]))).toEqual([{ path: "points.0.name", code: "control_chars" }]);
    expect(errors(body([item({ category: "toilets", name: "A​b" })]))).toEqual([{ path: "points.0.name", code: "control_chars" }]);
    expect(errors(body([item({ description: "a\u0000b" })]))).toEqual([{ path: "points.0.description", code: "control_chars" }]);
    // A description may have newlines (CRLF is normalized), not other controls.
    const ok = parse(body([item({ description: "line one\r\nline two" })]));
    expect(ok.success && ok.data.points[0]!.description).toBe("line one\nline two");
  });
});

describe("savePointsRequestSchema: the rest of the body", () => {
  it("description: empty allowed, up to 500 code points", () => {
    expect(parse(body([item({ description: "" })])).success).toBe(true);
    expect(parse(body([item({ description: "d".repeat(500) })])).success).toBe(true);
    expect(errors(body([item({ description: "d".repeat(501) })]))).toEqual([{ path: "points.0.description", code: "too_long" }]);
    expect(errors(body([item({ description: undefined })]))).toEqual([{ path: "points.0.description", code: "required" }]);
  });

  it("coordinates are finite numbers in [0, 1], rounded to 5 decimals", () => {
    const r = parse(body([item({ x: 0.123456789, y: 1 })]));
    expect(r.success && [r.data.points[0]!.x, r.data.points[0]!.y]).toEqual([0.12346, 1]);
    for (const bad of [-0.0001, 1.0001, "0.5", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errors(body([item({ x: bad })]))[0], String(bad)).toMatchObject({ path: "points.0.x", code: "invalid" });
    }
    expect(errors(body([item({ y: undefined })]))).toEqual([{ path: "points.0.y", code: "required" }]);
  });

  it("category must be one of the nine; unknown keys are refused", () => {
    expect(errors(body([item({ category: "casino" })]))).toEqual([{ path: "points.0.category", code: "invalid" }]);
    expect(errors(body([item({ eventId: "other" })]))).toEqual([{ path: "points", code: "unknown_field" }]);
    expect(errors(body([], { extra: 1 }))).toEqual([{ path: "body", code: "unknown_field" }]);
    expect(errors(body([item({ id: "UPPER CASE" })]))).toEqual([{ path: "points.0.id", code: "invalid" }]);
  });

  it("duplicate ids are refused; 0 items is fine; 500 is the cap", () => {
    expect(errors(body([item({ id: "a1" }), item({ id: "a1" })]))).toEqual([{ path: "points", code: "invalid" }]);
    expect(parse(body([])).success).toBe(true);
    expect(parse(body(Array.from({ length: MAX_POINTS_PER_MAP }, () => item()))).success).toBe(true);
    expect(errors(body(Array.from({ length: MAX_POINTS_PER_MAP + 1 }, () => item())))).toEqual([{ path: "points", code: "too_long" }]);
  });

  it("baseUpdatedAt must be an ISO instant; errors never echo values and stop at 20", () => {
    expect(errors({ baseUpdatedAt: "yesterday", points: [] })).toEqual([{ path: "baseUpdatedAt", code: "invalid" }]);
    const many = errors(body(Array.from({ length: 60 }, (_, i) => item({ name: i % 2 ? "x".repeat(99) : null, x: 7 }))));
    expect(many.length).toBe(20);
    expect(JSON.stringify(many)).not.toContain("xxxx");
  });
});

describe("pointSchema (what visitors receive)", () => {
  const point = { id: "p1", name: "Main", category: "stage", description: "Hello", x: 0.1, y: 0.2 };
  it("accepts a null name only on Just-drop categories", () => {
    expect(pointSchema.safeParse({ ...point, category: "toilets", name: null }).success).toBe(true);
    expect(pointSchema.safeParse({ ...point, name: null }).success).toBe(false);
  });
  it("refuses poisoned text so it can never reach visitors", () => {
    expect(pointSchema.safeParse({ ...point, name: "A‮b" }).success).toBe(false);
    expect(pointSchema.safeParse({ ...point, description: "A\u0007b" }).success).toBe(false);
    expect(pointSchema.safeParse({ ...point, description: "a\nb" }).success).toBe(true);
  });
});
