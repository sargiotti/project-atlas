import { describe, expect, it } from "vitest";
import { preStartCopy } from "../src/lib/preStart";

const Z = "Europe/Copenhagen"; // UTC+1 in November
const at = (iso: string) => Date.parse(iso);
const start = at("2026-11-21T09:00:00Z"); // Sat 21 Nov 10:00 local

describe("pre-start banner copy", () => {
  it("under 60 min counts minutes, rounding up", () => {
    expect(preStartCopy(start, start - 25 * 60_000, Z)).toEqual({ key: "preInMin", n: 25 });
    expect(preStartCopy(start, start - 30_000, Z)).toEqual({ key: "preInMin", n: 1 });
  });
  it("1 h up to 3 h shows a duration", () => {
    expect(preStartCopy(start, start - 60 * 60_000, Z)).toEqual({ key: "preInDur", minutes: 60 });
    expect(preStartCopy(start, start - 80 * 60_000, Z)).toEqual({ key: "preInDur", minutes: 80 });
    expect(preStartCopy(start, start - 179 * 60_000, Z)).toEqual({ key: "preInDur", minutes: 179 });
  });
  it("3 h or more on the same calendar day says today at the time", () => {
    expect(preStartCopy(start, at("2026-11-21T05:00:00Z"), Z)).toEqual({ key: "preToday", time: "10:00" });
  });
  it("counts calendar days in the event zone, not 24 h blocks", () => {
    // Fri 23:00 Copenhagen (22:00Z) to Sat 10:00 is 11 h away but still "tomorrow".
    expect(preStartCopy(start, at("2026-11-20T22:00:00Z"), Z)).toEqual({ key: "preTomorrow" });
    // 23:30Z Friday is already Saturday 00:30 in Copenhagen: same calendar day as the start.
    expect(preStartCopy(start, at("2026-11-20T23:30:00Z"), Z)).toEqual({ key: "preToday", time: "10:00" });
    // New York is still on Friday at that instant, and the event starts at 04:00 there on Saturday.
    expect(preStartCopy(start, at("2026-11-20T23:30:00Z"), "America/New_York")).toEqual({ key: "preTomorrow" });
  });
  it("2 to 30 days, then the date", () => {
    expect(preStartCopy(start, at("2026-11-17T12:00:00Z"), Z)).toEqual({ key: "preInDays", n: 4 });
    expect(preStartCopy(start, at("2026-10-22T12:00:00Z"), Z)).toEqual({ key: "preInDays", n: 30 });
    expect(preStartCopy(start, at("2026-10-21T12:00:00Z"), Z)).toEqual({ key: "preOnDate", date: "2026-11-21" });
  });
  it("is null once the start is reached", () => {
    expect(preStartCopy(start, start, Z)).toBeNull();
    expect(preStartCopy(start, start + 1, Z)).toBeNull();
  });
});
