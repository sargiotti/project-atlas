import { describe, expect, it } from "vitest";
import {
  MAX_SESSIONS_PER_POINT,
  isInSessionWindow,
  localToUtc,
  mapBundleSchema,
  parseUtcInstant,
  sessionDay,
  sessionSchema,
  sessionWindow,
  utcToLocal,
  type MapBundle,
} from "@atlas/contract";

const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  pointId: "p1",
  title: "Band",
  start: "2026-07-10T18:00:00Z",
  end: "2026-07-10T19:00:00Z",
  ...over,
});

const bundle = (sessions: unknown[], event: Record<string, unknown> = {}) => ({
  event: {
    slug: "tiny-fest",
    name: "Tiny Fest",
    startDate: "2026-07-10",
    endDate: "2026-07-12",
    language: "en",
    timeZone: "Europe/Dublin",
    dayStart: "06:00",
    ...event,
  },
  map: {
    id: "m",
    theme: "dark",
    width: 10,
    height: 10,
    image: { format: "svg", variants: [{ url: "/maps/x.svg", width: 10 }] },
  },
  points: [{ id: "p1", name: "Stage", category: "stage", description: "", x: 0.5, y: 0.5 }],
  sessions,
});

describe("session rules", () => {
  it("accepts a normal session and an exactly 24 h one, rejects end <= start and > 24 h", () => {
    expect(sessionSchema.safeParse(session()).success).toBe(true);
    expect(sessionSchema.safeParse(session({ end: "2026-07-11T18:00:00Z" })).success).toBe(true);
    expect(sessionSchema.safeParse(session({ end: "2026-07-11T18:00:01Z" })).success).toBe(false);
    expect(sessionSchema.safeParse(session({ end: "2026-07-10T18:00:00Z" })).success).toBe(false);
    expect(sessionSchema.safeParse(session({ end: "2026-07-10T17:00:00Z" })).success).toBe(false);
  });

  it("rejects instants that are not strict UTC or not real", () => {
    for (const bad of ["2026-07-10T18:00:00+01:00", "2026-07-10T18:00:00.000Z", "2026-07-10 18:00:00Z", "2026-02-30T10:00:00Z"]) {
      expect(sessionSchema.safeParse(session({ start: bad })).success, bad).toBe(false);
    }
  });

  it("keeps titles single-line and free of control and bidi characters; trims them", () => {
    for (const bad of ["a\nb", "a\rb", "a\tb", "a\u0000b", "a\u007fb", "a‮b", "a⁧b", "   ", ""]) {
      expect(sessionSchema.safeParse(session({ title: bad })).success, JSON.stringify(bad)).toBe(false);
    }
    expect(sessionSchema.parse(session({ title: "  Band  " })).title).toBe("Band");
    expect(sessionSchema.safeParse(session({ title: "x".repeat(121) })).success).toBe(false);
  });

  it("allows newlines in the description but no other control characters, at most 300 chars", () => {
    expect(sessionSchema.safeParse(session({ description: "line one\nline two" })).success).toBe(true);
    for (const bad of ["a\rb", "a\tb", "a\u0000b", "a‪b", "x".repeat(301)]) {
      expect(sessionSchema.safeParse(session({ description: bad })).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("bundle-level session rules", () => {
  it("requires start within the session window (dayStart on startDate .. dayStart after endDate) in the Event time zone", () => {
    // Slice 13 window, Dublin (IST, UTC+1), dayStart 06:00: from 2026-07-10 06:00 (05:00Z) until 2026-07-13 06:00 (05:00Z).
    // First day 05:59 local: before the first festival day starts.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-10T04:59:00Z", end: "2026-07-10T07:00:00Z" })])).success).toBe(false);
    // First day 06:00 local: accepted.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-10T05:00:00Z", end: "2026-07-10T07:00:00Z" })])).success).toBe(true);
    // 2026-07-09 23:30 Dublin: the day before the event.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-09T22:30:00Z", end: "2026-07-10T01:00:00Z" })])).success).toBe(false);
    // Last night 23:30 local, ending after midnight: allowed.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-12T22:30:00Z", end: "2026-07-13T01:00:00Z" })])).success).toBe(true);
    // Last night after midnight (00:30 and 05:59 local the day after endDate): still that night's programme.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-12T23:30:00Z", end: "2026-07-13T01:00:00Z" })])).success).toBe(true);
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-13T04:59:00Z", end: "2026-07-13T06:00:00Z" })])).success).toBe(true);
    // 06:00 local on the day after endDate: the next festival day, outside.
    expect(mapBundleSchema.safeParse(bundle([session({ start: "2026-07-13T05:00:00Z", end: "2026-07-13T06:00:00Z" })])).success).toBe(false);
  });

  it("sessionWindow is dayStart-based, DST-aware and equivalent to sessionDay within startDate..endDate", () => {
    const w = sessionWindow("2026-03-28", "2026-03-29", "06:00", "Europe/Dublin"); // DST starts 2026-03-29 01:00 UTC
    expect(w.from).toBe(Date.parse("2026-03-28T06:00:00Z")); // GMT
    expect(w.until).toBe(Date.parse("2026-03-30T05:00:00Z")); // 06:00 IST = 05:00Z
    const probe = (iso: string) => isInSessionWindow(Date.parse(iso), w);
    expect(probe("2026-03-28T05:59:00Z")).toBe(false);
    expect(probe("2026-03-28T06:00:00Z")).toBe(true);
    expect(probe("2026-03-30T04:59:00Z")).toBe(true);
    expect(probe("2026-03-30T05:00:00Z")).toBe(false);
    for (const iso of ["2026-03-28T05:59:00Z", "2026-03-28T06:00:00Z", "2026-03-29T12:00:00Z", "2026-03-30T04:59:00Z", "2026-03-30T05:00:00Z"]) {
      const day = sessionDay(Date.parse(iso), "Europe/Dublin", "06:00");
      expect(probe(iso), iso).toBe(day >= "2026-03-28" && day <= "2026-03-29");
    }
  });

  it("rejects a point that is not in the bundle, duplicate ids and an invalid time zone", () => {
    expect(mapBundleSchema.safeParse(bundle([session({ pointId: "other" })])).success).toBe(false);
    expect(mapBundleSchema.safeParse(bundle([session(), session()])).success).toBe(false);
    expect(mapBundleSchema.safeParse(bundle([], { timeZone: "Mars/Olympus" })).success).toBe(false);
    expect(mapBundleSchema.safeParse(bundle([], { dayStart: "6:00" })).success).toBe(false);
  });

  it("caps sessions per point", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => session({ id: `s${i}`, start: "2026-07-10T18:00:00Z", end: "2026-07-10T19:00:00Z" }));
    expect(mapBundleSchema.safeParse(bundle(many(MAX_SESSIONS_PER_POINT))).success).toBe(true);
    expect(mapBundleSchema.safeParse(bundle(many(MAX_SESSIONS_PER_POINT + 1))).success).toBe(false);
  });

  it("defaults the new fields for payloads from before this slice", () => {
    const old = bundle([]) as MapBundle & Record<string, unknown>;
    delete (old as Record<string, unknown>).sessions;
    delete (old.event as Record<string, unknown>).timeZone;
    delete (old.event as Record<string, unknown>).dayStart;
    const parsed = mapBundleSchema.parse(old);
    expect(parsed.sessions).toEqual([]);
    expect(parsed.event.timeZone).toBe("UTC");
    expect(parsed.event.dayStart).toBe("06:00");
  });
});

describe("day assignment", () => {
  const at = (iso: string) => parseUtcInstant(iso)!;
  it("puts a set before day start on the previous day's grid (local time, summer and winter)", () => {
    // 00:30 Sat in Dublin (UTC+1) is 23:30Z Friday.
    expect(sessionDay(at("2026-07-10T23:30:00Z"), "Europe/Dublin", "06:00")).toBe("2026-07-10");
    expect(sessionDay(at("2026-07-11T00:30:00Z"), "Europe/Dublin", "06:00")).toBe("2026-07-10"); // 01:30 local
    expect(sessionDay(at("2026-07-11T04:59:00Z"), "Europe/Dublin", "06:00")).toBe("2026-07-10"); // 05:59 local
    expect(sessionDay(at("2026-07-11T05:00:00Z"), "Europe/Dublin", "06:00")).toBe("2026-07-11"); // 06:00 local
    // Madrid in December is UTC+1: 01:30 local on the 5th is still the 4th's grid.
    expect(sessionDay(at("2026-12-05T00:30:00Z"), "Europe/Madrid", "06:00")).toBe("2026-12-04");
    // A custom day start moves the boundary.
    expect(sessionDay(at("2026-12-05T04:00:00Z"), "Europe/Madrid", "04:00")).toBe("2026-12-05");
    expect(sessionDay(at("2026-12-05T02:30:00Z"), "Europe/Madrid", "04:00")).toBe("2026-12-04");
  });

  it("converts between local wall-clock time and UTC in both directions", () => {
    expect(new Date(localToUtc("2026-07-10", "18:00", "Europe/Dublin")).toISOString()).toBe("2026-07-10T17:00:00.000Z");
    expect(new Date(localToUtc("2026-12-04", "19:00", "Europe/Madrid")).toISOString()).toBe("2026-12-04T18:00:00.000Z");
    expect(new Date(localToUtc("2026-11-21", "10:00", "Europe/Copenhagen")).toISOString()).toBe("2026-11-21T09:00:00.000Z");
    expect(utcToLocal(at("2026-07-10T23:30:00Z"), "Europe/Dublin")).toEqual({ date: "2026-07-11", time: "00:30" });
  });
});
