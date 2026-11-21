import { describe, expect, it } from "vitest";
import { PLACE_IDS, PLACES, type BillboardEvent } from "@atlas/contract";
import { groupBillboard, localDate, windowOf } from "./billboard";
import { PLACE_LOCATIONS, placeLocation } from "./places";

// 2026-11-18 is a Wednesday. Its week ends on Sunday 2026-11-22; the weekend is Fri 20 to Sun 22.
const WED = "2026-11-18";

describe("windowOf", () => {
  it.each([
    ["running event", "2026-11-17", "2026-11-19", "now"],
    ["starts today", WED, WED, "now"],
    ["ends today", "2026-11-10", WED, "now"],
    ["ended yesterday", "2026-11-10", "2026-11-17", null],
    ["starts Thursday: not the weekend", "2026-11-19", "2026-11-19", "later"],
    ["starts Friday", "2026-11-20", "2026-11-20", "weekend"],
    ["starts Sunday", "2026-11-22", "2026-11-22", "weekend"],
    ["starts next Monday", "2026-11-23", "2026-11-23", "later"],
    ["starts Friday, runs into next week", "2026-11-20", "2026-11-25", "weekend"],
  ])("%s", (_label, start, end, expected) => {
    expect(windowOf(start, end, WED)).toBe(expected);
  });

  it("multi-day event that began before the weekend is Now, not This weekend", () => {
    expect(windowOf("2026-11-19", "2026-11-22", "2026-11-21")).toBe("now");
  });

  it("on Saturday the current weekend is already Now; the next one is Coming up", () => {
    expect(windowOf("2026-11-20", "2026-11-22", "2026-11-21")).toBe("now");
    expect(windowOf("2026-11-27", "2026-11-29", "2026-11-22")).toBe("later");
  });

  it("on Sunday a Monday start is Coming up", () => {
    expect(windowOf("2026-11-23", "2026-11-23", "2026-11-22")).toBe("later");
  });

  it("on Monday the coming Friday is the weekend", () => {
    expect(windowOf("2026-11-27", "2026-11-27", "2026-11-23")).toBe("weekend");
  });
});

describe("localDate (event time zone)", () => {
  it("the same instant is a different calendar day in different zones", () => {
    const instant = Date.UTC(2026, 10, 20, 23, 30); // Fri 20 Nov, 23:30 UTC
    expect(localDate(instant, "UTC")).toBe("2026-11-20");
    expect(localDate(instant, "Europe/Madrid")).toBe("2026-11-21");
    expect(localDate(instant, "America/Argentina/Buenos_Aires")).toBe("2026-11-20");
    expect(localDate(instant, "Pacific/Auckland")).toBe("2026-11-21");
    expect(localDate(instant, "Not/AZone")).toBe("2026-11-20");
  });
});

const ev = (slug: string, start: string, end: string, nearby = false): BillboardEvent => ({
  slug, name: slug, startDate: start, endDate: end, city: "X", country: "ES", cover: null, tone: 0, nearby, isDemo: false,
});

describe("groupBillboard", () => {
  const now = Date.UTC(2026, 10, 18, 12); // Wed noon UTC

  it("puts each event in exactly one window, drops ended ones and omits empty windows", () => {
    const groups = groupBillboard(
      [
        { event: ev("ended", "2026-11-01", "2026-11-02"), timeZone: "UTC" },
        { event: ev("later", "2026-12-05", "2026-12-06"), timeZone: "UTC" },
        { event: ev("running", "2026-11-17", "2026-11-22"), timeZone: "UTC" },
      ],
      now,
    );
    expect(groups.map((g) => [g.id, g.events.map((e) => e.slug)])).toEqual([
      ["now", ["running"]],
      ["later", ["later"]],
    ]);
  });

  it("orders each window nearby first, then by start date, then slug", () => {
    const groups = groupBillboard(
      [
        { event: ev("c-far-early", "2026-12-01", "2026-12-01"), timeZone: "UTC" },
        { event: ev("b-near-late", "2026-12-10", "2026-12-10", true), timeZone: "UTC" },
        { event: ev("a-near-early", "2026-12-02", "2026-12-02", true), timeZone: "UTC" },
        { event: ev("a-far-same-day", "2026-12-01", "2026-12-01"), timeZone: "UTC" },
      ],
      now,
    );
    expect(groups[0]!.events.map((e) => e.slug)).toEqual(["a-near-early", "b-near-late", "a-far-same-day", "c-far-early"]);
  });

  it("uses each event's own time zone for today (ended in Madrid, still on in Buenos Aires)", () => {
    const lateNight = Date.UTC(2026, 10, 18, 23, 30); // Wed 23:30 UTC = Thu 00:30 in Madrid, Wed 20:30 in Buenos Aires
    const groups = groupBillboard(
      [
        { event: ev("madrid", "2026-11-18", "2026-11-18"), timeZone: "Europe/Madrid" },
        { event: ev("buenos-aires", "2026-11-18", "2026-11-18"), timeZone: "America/Argentina/Buenos_Aires" },
      ],
      lateNight,
    );
    expect(groups.flatMap((g) => g.events.map((e) => e.slug))).toEqual(["buenos-aires"]);
  });

  it("zero events: no windows", () => {
    expect(groupBillboard([], now)).toEqual([]);
  });
});

describe("place selector", () => {
  it("every contract place has a server location and nothing else is accepted", () => {
    expect(Object.keys(PLACE_LOCATIONS).sort()).toEqual([...PLACE_IDS].sort());
    for (const p of PLACES) expect(placeLocation(p.id)).toEqual(PLACE_LOCATIONS[p.id]);
  });

  it.each([null, "", "atlantis", "VALENCIA", "valencia ", "constructor", "__proto__", "toString", "40.4,-3.7", "a".repeat(33), "valencia&near=ES"])(
    "ignores %j",
    (value) => {
      expect(placeLocation(value)).toBeNull();
    },
  );
});
