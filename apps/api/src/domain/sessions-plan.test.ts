import { describe, expect, it } from "vitest";
import { formatUtcInstant, sessionDraftSchema, sessionWindow, type PointCategory, type Session, type SessionDraft } from "@atlas/contract";
import { isEmptyPlan, planSessions } from "./sessions-plan";

const window = sessionWindow("2026-07-10", "2026-07-12", "06:00", "Europe/Dublin");
const points = new Map<string, PointCategory>([["stage", "stage"], ["stage2", "stage"], ["wc", "toilets"]]);
const at = (h: number, m = 0, day = 10) => `2026-07-${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const draft = (over: Partial<SessionDraft> = {}): SessionDraft => ({ pointId: "stage", title: "T", start: at(18), end: at(19), ...over });
const plan = (drafts: SessionDraft[], current: Session[] = []) => planSessions({ current, drafts, points, window, newId: (() => { let n = 0; return () => `new${++n}`; })() });
const fields = (r: ReturnType<typeof plan>) => (r.ok || r.reason !== "invalid" ? null : r.fields);

describe("planSessions", () => {
  it("touching ends are allowed, any overlap is flagged on the later item, other points are independent", () => {
    expect(plan([draft(), draft({ start: at(19), end: at(20) }), draft({ pointId: "stage2", start: at(18, 30), end: at(19, 30) })]).ok).toBe(true);
    expect(fields(plan([draft({ start: at(18, 30), end: at(19, 30) }), draft()]))).toEqual([{ path: "sessions.0.start", code: "overlap" }]);
    // containment and identical ranges
    expect(fields(plan([draft({ end: at(22) }), draft({ start: at(19), end: at(20) })]))).toEqual([{ path: "sessions.1.start", code: "overlap" }]);
    expect(fields(plan([draft(), draft()]))).toEqual([{ path: "sessions.1.start", code: "overlap" }]);
  });

  it("window, category and caps are checked on the whole resulting set; at most 20 field errors", () => {
    expect(fields(plan([draft({ start: at(4, 59), end: at(7) })]))).toEqual([{ path: "sessions.0.start", code: "outside_dates" }]);
    expect(fields(plan([draft({ pointId: "wc" })]))).toEqual([{ path: "sessions.0.pointId", code: "invalid" }]);
    const many = Array.from({ length: 151 }, (_, i) => draft({ start: formatUtcInstant(window.from + i * 20 * 60_000), end: formatUtcInstant(window.from + (i + 1) * 20 * 60_000) }));
    expect(fields(plan(many))?.some((f) => f.code === "too_long")).toBe(true);
    const bad = Array.from({ length: 40 }, (_, i) => draft({ start: at(1), end: at(2, i + 1) }));
    expect(fields(plan(bad))!.length).toBe(20);
  });

  it("unknown ids win over the semantic errors, and an unchanged set is an empty plan", () => {
    expect(plan([draft({ id: "ghost" }), draft({ pointId: "wc" })])).toEqual({ ok: false, reason: "unknown_session_id" });
    expect(plan([draft({ pointId: "ghost" })])).toEqual({ ok: false, reason: "unknown_point_id" });
    const current: Session[] = [{ id: "a", pointId: "stage", title: "T", start: at(18), end: at(19) }];
    const same = plan([{ ...draft(), id: "a" }], current);
    expect(same.ok && isEmptyPlan(same.plan)).toBe(true);
    const moved = plan([{ ...draft({ title: "Other" }), id: "a" }], current);
    expect(moved.ok && moved.plan.toUpdate.map((s) => s.id)).toEqual(["a"]);
    const gone = plan([], current);
    expect(gone.ok && gone.plan.toDelete).toEqual(["a"]);
  });
});

describe("sessionDraftSchema", () => {
  const parse = (o: Record<string, unknown>) => sessionDraftSchema.safeParse({ pointId: "stage", title: "T", start: at(18), end: at(19), ...o });
  it("normalizes text and drops a blank description", () => {
    const r = parse({ title: " Café \r\n".trim(), description: "  " });
    expect(r.success && r.data).toEqual({ pointId: "stage", title: "Café", start: at(18), end: at(19) });
    const d = parse({ description: "a\r\nb " });
    expect(d.success && d.data.description).toBe("a\nb");
  });
  it("end after start, at most 24 h, real instants, no unknown keys", () => {
    expect(parse({ end: at(18) }).success).toBe(false);
    expect(parse({ end: at(18, 0, 11) }).success).toBe(true); // exactly 24 h
    expect(parse({ end: at(18, 1, 11) }).success).toBe(false);
    expect(parse({ start: "2026-02-30T10:00:00Z" }).success).toBe(false);
    expect(parse({ extra: 1 }).success).toBe(false);
  });
});
