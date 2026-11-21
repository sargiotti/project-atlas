import { describe, expect, it } from "vitest";
import { addDays } from "@atlas/contract";
import { demoShiftDays, shiftLocalDateTime, shiftUtcInstant, targetStartDate } from "./demo-dates";

describe("targetStartDate", () => {
  it("now: yesterday; coming-up: three weeks ahead", () => {
    expect(targetStartDate("now", "2026-11-21")).toBe("2026-11-20");
    expect(targetStartDate("coming-up", "2026-11-21")).toBe("2026-12-12");
  });

  it("weekend: Friday of the current weekend (Fri-Sun) or the next one (Mon-Thu)", () => {
    // 2026-11-20 is a Friday.
    expect(targetStartDate("weekend", "2026-11-20")).toBe("2026-11-20");
    expect(targetStartDate("weekend", "2026-11-21")).toBe("2026-11-20");
    expect(targetStartDate("weekend", "2026-11-22")).toBe("2026-11-20");
    expect(targetStartDate("weekend", "2026-11-23")).toBe("2026-11-27");
    expect(targetStartDate("weekend", "2026-11-26")).toBe("2026-11-27");
  });
});

describe("demoShiftDays", () => {
  it("is 0 for slugs outside the allowlist, so real events never move", () => {
    expect(demoShiftDays("my-real-festival", "2020-01-01", "Europe/Madrid", Date.UTC(2026, 10, 21))).toBe(0);
  });

  it("uses today in the event's zone and is idempotent", () => {
    // 23:30 UTC on the 21st is already 00:30 on the 22nd in Copenhagen (UTC+1).
    const now = Date.UTC(2026, 10, 21, 23, 30);
    const days = demoShiftDays("havnelobet", "2026-11-10", "Europe/Copenhagen", now);
    expect(shiftLocalDateTime("2026-11-10T00:00", days).slice(0, 10)).toBe("2026-12-13");
    expect(demoShiftDays("havnelobet", "2026-12-13", "Europe/Copenhagen", now)).toBe(0);
  });
});

describe("mercado-medieval-toledo", () => {
  it("lands on the current weekend's Friday and its 3-day span (Fri-Sun) moves with it", () => {
    const now = Date.UTC(2026, 10, 21, 12); // Saturday
    const days = demoShiftDays("mercado-medieval-toledo", "2026-12-11", "Europe/Madrid", now);
    expect(addDays("2026-12-11", days)).toBe("2026-11-20");
    expect(addDays("2026-12-13", days)).toBe("2026-11-22");
    expect(shiftLocalDateTime("2026-12-12T22:00", days)).toBe("2026-11-21T22:00");
  });
});

describe("shifting sessions", () => {
  it("keeps the local wall-clock time across a DST change", () => {
    // 2026-10-24 20:00 Madrid (UTC+2) moved 7 days is 2026-10-31 20:00 (still UTC+1 after 25 Oct): 19:00Z.
    expect(shiftUtcInstant("2026-10-24T18:00:00Z", 7, "Europe/Madrid")).toBe("2026-10-31T19:00:00Z");
    expect(shiftLocalDateTime("2026-07-11T00:30", 3)).toBe("2026-07-14T00:30");
  });
});
