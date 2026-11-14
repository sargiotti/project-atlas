import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "@atlas/contract";
import { bucketByDay, dayWindow, layoutColumn, openingFor, readZoom, ZOOM_KEY } from "../src/lib/scheduleGrid";
import { withTimes } from "../src/lib/schedule";

const HOUR = 3_600_000;
const s = (id: string, pointId: string, start: string, end: string) => ({ id, pointId, title: id, start, end });

describe("day window and day assignment", () => {
  it("is 23 h on the day that ends when clocks spring forward, 25 h when they fall back", () => {
    // Madrid: clocks go forward on Sun 2026-03-29 (02:00) and back on Sun 2026-10-25 (03:00). Day start 06:00.
    const spring = dayWindow("2026-03-28", "Europe/Madrid", "06:00");
    expect((spring.endMs - spring.startMs) / HOUR).toBe(23);
    const fall = dayWindow("2026-10-24", "Europe/Madrid", "06:00");
    expect((fall.endMs - fall.startMs) / HOUR).toBe(25);
    const plain = dayWindow("2026-07-10", "Europe/Madrid", "06:00");
    expect((plain.endMs - plain.startMs) / HOUR).toBe(24);
  });

  it("files a 02:00 session under the previous day, on a normal night and across the DST change", () => {
    const list = withTimes(
      [
        // 02:00 Saturday in July (UTC+2 in Madrid): Friday's grid.
        s("night", "a", "2026-07-11T00:00:00Z", "2026-07-11T01:00:00Z"),
        // 01:30 CET and 03:30 CEST on the night clocks go forward: both still Saturday 28 March's grid.
        s("before-change", "a", "2026-03-29T00:30:00Z", "2026-03-29T00:50:00Z"),
        s("after-change", "a", "2026-03-29T01:30:00Z", "2026-03-29T02:00:00Z"),
        // 07:00 on the 29th is the next grid day.
        s("morning", "a", "2026-03-29T05:00:00Z", "2026-03-29T06:00:00Z"),
      ],
      "Europe/Madrid",
      "06:00",
    );
    const day = (id: string) => list.find((x) => x.id === id)!.day;
    expect(day("night")).toBe("2026-07-10");
    expect(day("before-change")).toBe("2026-03-28");
    expect(day("after-change")).toBe("2026-03-28");
    expect(day("morning")).toBe("2026-03-29");

    // Every session sits inside the window of its own day (not a fixed 24 h).
    for (const x of list) {
      const w = dayWindow(x.day, "Europe/Madrid", "06:00");
      expect(x.startMs).toBeGreaterThanOrEqual(w.startMs);
      expect(x.startMs).toBeLessThan(w.endMs);
    }
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
  });

  it("builds tabs only from days with sessions and keeps columns in point order", () => {
    const list = withTimes(
      [
        s("a1", "p2", "2026-07-10T19:00:00Z", "2026-07-10T20:00:00Z"),
        s("a2", "p1", "2026-07-10T20:00:00Z", "2026-07-10T21:00:00Z"),
        // Far later day: no days are invented in between.
        s("b1", "p3", "2026-08-20T19:00:00Z", "2026-08-20T20:00:00Z"),
      ],
      "UTC",
      "06:00",
    );
    const { days, byDay } = bucketByDay(list, ["p1", "p2", "p3"]);
    expect(days).toEqual(["2026-07-10", "2026-08-20"]);
    expect([...byDay.get("2026-07-10")!.keys()]).toEqual(["p1", "p2"]);
  });
});

describe("opening rule", () => {
  const list = withTimes(
    [
      s("fri", "a", "2026-07-10T18:00:00Z", "2026-07-10T19:00:00Z"),
      s("fri-late", "a", "2026-07-10T23:30:00Z", "2026-07-11T00:30:00Z"),
      s("sat", "a", "2026-07-11T12:00:00Z", "2026-07-11T13:00:00Z"),
    ],
    "UTC",
    "06:00",
  );
  const days = ["2026-07-10", "2026-07-11"];
  const at = (iso: string) => openingFor(list, days, Date.parse(iso), "UTC", "06:00")!;

  it("reads before, running, gap and ended from the sessions", () => {
    expect(at("2026-07-01T00:00:00Z").state).toBe("before");
    expect(at("2026-07-10T18:30:00Z").state).toBe("live");
    expect(at("2026-07-10T21:00:00Z").state).toBe("gap");
    expect(at("2026-07-11T13:00:00Z").state).toBe("after");
  });

  it("opens a post-midnight gap on the next session's day", () => {
    const o = at("2026-07-11T02:00:00Z"); // still Friday's grid day
    expect(o.state).toBe("gap");
    expect(o.day).toBe("2026-07-11");
    expect(o.next?.id).toBe("sat");
  });
});

describe("lanes", () => {
  it("puts overlapping sessions side by side and never overlaps enlarged short blocks", () => {
    const [a, b, c] = withTimes(
      [
        s("a", "p", "2026-07-10T20:00:00Z", "2026-07-10T22:00:00Z"),
        s("b", "p", "2026-07-10T21:00:00Z", "2026-07-10T23:00:00Z"),
        s("c", "p", "2026-07-10T21:00:00Z", "2026-07-10T21:05:00Z"), // 5 min: drawn at the minimum height
      ],
      "UTC",
      "06:00",
    );
    const col = layoutColumn([a!, b!, c!], a!.startMs, 0.6, 24);
    expect(col.maxLanes).toBe(3);
    const lanes = col.blocks.map((x) => x.lane);
    expect(new Set(lanes).size).toBe(3);
    expect(col.blocks.every((x) => x.lanes === 3)).toBe(true);
  });
});

describe("zoom memory", () => {
  beforeEach(() => localStorage.clear());
  it("only trusts the three known steps", () => {
    expect(readZoom()).toBe(1);
    localStorage.setItem(ZOOM_KEY, "detail");
    expect(readZoom()).toBe(2);
    localStorage.setItem(ZOOM_KEY, "<img src=x>");
    expect(readZoom()).toBe(1);
    localStorage.setItem(ZOOM_KEY, "9");
    expect(readZoom()).toBe(1);
  });
});
