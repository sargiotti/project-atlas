import { describe, expect, it } from "vitest";
import { daysOf, defaultDay, parseAt, splitDay, withTimes } from "../src/lib/schedule";

const tz = "Europe/Dublin"; // UTC+1 in July

describe("?at= parsing", () => {
  it("reads a valid value as event-local time", () => {
    expect(parseAt("?at=2026-07-10T21:30", tz)).toBe(Date.UTC(2026, 6, 10, 20, 30));
  });

  it.each(["", "?at=", "?at=2026-07-10", "?at=2026-07-10T21:30:00", "?at=2026-07-10T21:30Z", "?at=2026-02-31T10:00", "?at=2026-07-10T25:00", "?at=<b>x</b>", "?at=2026-07-10T21:30%0A"])(
    "ignores %s",
    (q) => {
      expect(parseAt(q, tz)).toBeNull();
    },
  );
});

const s = (id: string, start: string, end: string) => ({ id, pointId: "p", title: id, start, end });

describe("day assignment and now/next", () => {
  // Fri 19:00-20:30, Fri 21:00-22:30, Sat 00:30-01:30 (local, before the 06:00 day start), Sat 20:00-21:00.
  const sessions = withTimes(
    [
      s("a", "2026-07-10T18:00:00Z", "2026-07-10T19:30:00Z"),
      s("b", "2026-07-10T20:00:00Z", "2026-07-10T21:30:00Z"),
      s("c", "2026-07-10T23:30:00Z", "2026-07-11T00:30:00Z"),
      s("d", "2026-07-11T19:00:00Z", "2026-07-11T20:00:00Z"),
    ],
    tz,
    "06:00",
  );

  it("puts a session before the day start under the previous day", () => {
    expect(sessions.map((x) => x.day)).toEqual(["2026-07-10", "2026-07-10", "2026-07-10", "2026-07-11"]);
    expect(daysOf(sessions)).toEqual(["2026-07-10", "2026-07-11"]);
  });

  it("splits a day into now, upcoming and finished at the given instant", () => {
    const fri = sessions.filter((x) => x.day === "2026-07-10");
    const r = splitDay(fri, Date.UTC(2026, 6, 10, 20, 30));
    expect(r.now?.id).toBe("b");
    expect(r.future.map((x) => x.id)).toEqual(["c"]);
    expect(r.past.map((x) => x.id)).toEqual(["a"]);
  });

  it("opens today's day, else the next one, else the last", () => {
    const days = daysOf(sessions);
    expect(defaultDay(days, Date.UTC(2026, 6, 11, 18, 0), tz, "06:00")).toBe("2026-07-11");
    expect(defaultDay(days, Date.UTC(2026, 6, 1), tz, "06:00")).toBe("2026-07-10");
    expect(defaultDay(days, Date.UTC(2026, 7, 1), tz, "06:00")).toBe("2026-07-11");
    // 00:45 on Saturday (local) is still Friday's day.
    expect(defaultDay(days, Date.UTC(2026, 6, 10, 23, 45), tz, "06:00")).toBe("2026-07-10");
  });
});
