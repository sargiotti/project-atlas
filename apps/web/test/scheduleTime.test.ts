import { describe, expect, it } from "vitest";
import { isInSessionWindow, sessionWindow, utcToLocal } from "@atlas/contract";
import { clearAllDrafts, purgeForeignDrafts } from "../src/lib/draftStorage";
import { findProblems, mergeDraft, type EditorSession } from "../src/lib/scheduleModel";
import { findClash, parseTypedTime, resolveEnd, resolveTime, suggestFixes } from "../src/lib/scheduleTime";

const TZ = "America/Buenos_Aires"; // UTC-3, no DST
const clock = (ms: number) => utcToLocal(ms, TZ);

describe("typed times", () => {
  it.each([
    ["2130", "21:30"], ["930", "09:30"], ["21:30", "21:30"], ["21.30", "21:30"], ["21h", "21:00"], ["21h30", "21:30"],
    ["9pm", "21:00"], ["9:30 pm", "21:30"], ["12am", "00:00"], ["12pm", "12:00"], ["9", "09:00"], ["0", "00:00"], ["  7  ", "07:00"],
  ])("%s -> %s", (raw, want) => expect(parseTypedTime(raw)).toBe(want));

  it.each(["", "banana", "25:00", "24", "12:60", "2460", "13pm", "0pm", "9:3", "1:2:3", "-1"])("refuses %j", (raw) => expect(parseTypedTime(raw)).toBeNull());
});

describe("festival day maths", () => {
  it("a time before the day start is early the next morning; from the day start on it is that date", () => {
    expect(clock(resolveTime("2026-12-12", "21:00", "06:00", TZ)!)).toEqual({ date: "2026-12-12", time: "21:00" });
    expect(clock(resolveTime("2026-12-12", "01:30", "06:00", TZ)!)).toEqual({ date: "2026-12-13", time: "01:30" });
    expect(clock(resolveTime("2026-12-12", "06:00", "06:00", TZ)!)).toEqual({ date: "2026-12-12", time: "06:00" });
    expect(clock(resolveTime("2026-12-12", "05:59", "06:00", TZ)!)).toEqual({ date: "2026-12-13", time: "05:59" });
  });

  it("an end before the start means the next morning, equal is refused, and a DST gap is reported", () => {
    const start = resolveTime("2026-12-12", "23:00", "06:00", TZ)!;
    const end = resolveEnd(start, "2026-12-12", "01:00", "06:00", TZ);
    expect(end.ok && clock((end as { ms: number }).ms)).toEqual({ date: "2026-12-13", time: "01:00" });
    expect(resolveEnd(start, "2026-12-12", "23:00", "06:00", TZ)).toEqual({ ok: false, reason: "equal" });
    // Madrid, spring forward 2026-03-29: 02:30 does not exist
    expect(resolveTime("2026-03-28", "02:30", "06:00", "Europe/Madrid")).toBeNull();
  });
});

describe("the event window (AC6)", () => {
  const w = sessionWindow("2026-12-12", "2026-12-13", "06:00", TZ);
  const at = (date: string, time: string) => resolveTime(date, time, "00:00", TZ)!; // the plain wall-clock instant
  it("accepts the last night after midnight and refuses its 06:00", () => {
    expect(isInSessionWindow(at("2026-12-14", "01:30"), w)).toBe(true);
    expect(isInSessionWindow(at("2026-12-14", "05:59"), w)).toBe(true);
    expect(isInSessionWindow(at("2026-12-14", "06:00"), w)).toBe(false);
  });
  it("refuses a start before the day start of the first day", () => {
    expect(isInSessionWindow(at("2026-12-12", "05:59"), w)).toBe(false);
    expect(isInSessionWindow(at("2026-12-12", "06:00"), w)).toBe(true);
  });
  it("findProblems flags a start outside the window", () => {
    const s = (start: string, end: string): EditorSession => ({ key: start, pointId: "p", title: "T", description: "", start, end });
    const bad = findProblems([s("2026-12-14T09:00:00Z", "2026-12-14T10:00:00Z"), s("2026-12-14T04:30:00Z", "2026-12-14T05:30:00Z")], w);
    expect(bad.get("2026-12-14T09:00:00Z")?.kind).toBe("outside"); // 06:00 on the day after the last day
    expect(bad.has("2026-12-14T04:30:00Z")).toBe(false); // 01:30 is the last night
  });
});

describe("overlaps", () => {
  const span = (id: string, a: number, b: number) => ({ id, title: id, startMs: a * 3600_000, endMs: b * 3600_000 });
  it("is half open: touching is fine, one minute of overlap is not", () => {
    const list = [span("a", 20, 21)];
    expect(findClash(list, 21 * 3600_000, 22 * 3600_000)).toBeNull();
    expect(findClash(list, 20.5 * 3600_000, 21.5 * 3600_000)?.id).toBe("a");
    expect(findClash(list, 19 * 3600_000, 20 * 3600_000)).toBeNull();
  });
  it("offers a fix that starts when the clash ends and one that uses the nearest free time", () => {
    const list = [span("a", 20, 21), span("b", 22, 23)];
    const clash = findClash(list, 20.5 * 3600_000, 21.5 * 3600_000)!;
    const fixes = suggestFixes(list, 20.5 * 3600_000, 21.5 * 3600_000, clash, 18 * 3600_000, 30 * 3600_000);
    expect(fixes[0]).toEqual({ kind: "start", startMs: 21 * 3600_000, endMs: 22 * 3600_000 });
    expect(fixes).toHaveLength(2);
    expect(fixes[1]!.kind).toBe("free");
    expect(findClash(list, fixes[1]!.startMs, fixes[1]!.endMs)).toBeNull();
  });
  it("findProblems names the earlier show an overlapping one clashes with", () => {
    const s = (key: string, start: string, end: string): EditorSession => ({ key, pointId: "p", title: key, description: "", start, end });
    const w = sessionWindow("2026-12-12", "2026-12-13", "06:00", TZ);
    const p = findProblems([s("a", "2026-12-12T23:00:00Z", "2026-12-13T00:00:00Z"), s("b", "2026-12-12T23:30:00Z", "2026-12-13T00:30:00Z"), s("c", "2026-12-13T00:30:00Z", "2026-12-13T01:30:00Z")], w);
    expect(p.get("b")).toMatchObject({ kind: "overlap", with: { key: "a" } });
    expect(p.has("c")).toBe(false);
  });
});

describe("rebasing a draft on a newer server set", () => {
  const s = (key: string, pointId: string, id?: string): EditorSession => ({ key, id, pointId, title: key, description: "", start: "2026-12-12T23:00:00Z", end: "2026-12-13T00:00:00Z" });
  it("keeps server-only shows, keeps new ones and drops (and counts) shows of a place that is gone", () => {
    const server = [s("srv1", "stage", "srv1"), s("srv2", "stage", "srv2")];
    const draft = [s("srv1", "stage", "srv1"), s("tmp1", "stage"), s("old", "church", "old"), s("tmp2", "church")];
    const m = mergeDraft(draft, server, false, new Set(["stage"]));
    expect(m.dropped).toBe(2);
    expect(m.sessions.map((x) => x.key).sort()).toEqual(["srv1", "srv2", "tmp1"]);
  });
  it("a draft show whose id the server no longer has comes back as a new one, never as an update", () => {
    const m = mergeDraft([s("gone", "stage", "gone")], [], false, new Set(["stage"]));
    expect(m.sessions).toHaveLength(1);
    expect(m.sessions[0]!.id).toBeUndefined();
  });
});

describe("draft wipes", () => {
  it("sign out removes every draft prefix of every organizer; the foreign purge keeps only the signed-in organizer's", () => {
    localStorage.clear();
    localStorage.setItem("atlas.pointsDraft.v1.o1.e1", "{}");
    localStorage.setItem("atlas.scheduleDraft.v1.o1.e1", "{}");
    localStorage.setItem("atlas.pointsDraft.v1.o2.e9", "{}");
    localStorage.setItem("atlas.scheduleDraft.v1.o2.e9", "{}");
    localStorage.setItem("atlas.lang", "en");
    purgeForeignDrafts("o1");
    expect(Object.keys(localStorage).sort()).toEqual(["atlas.lang", "atlas.pointsDraft.v1.o1.e1", "atlas.scheduleDraft.v1.o1.e1"]);
    clearAllDrafts();
    expect(Object.keys(localStorage)).toEqual(["atlas.lang"]);
  });
});
