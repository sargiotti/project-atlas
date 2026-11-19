import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, googleCalendarUrl, icsFileName } from "../src/lib/calendar";

const base = {
  session: { id: "fest-s-1", title: "Band; The, Best", start: "2026-07-10T20:00:00Z", end: "2026-07-10T21:30:00Z", description: undefined as string | undefined },
  placeName: "Main Stage",
  eventName: "Test Fest",
  slug: "test-fest",
  origin: "https://atlas.example",
  nowMs: Date.UTC(2026, 6, 1, 12, 0, 0),
};

describe("ics text escaping", () => {
  it("escapes backslash first, then semicolon, comma and newline, and drops CR", () => {
    expect(escapeIcsText("a\\b;c,d\r\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });

  it("a title, description or place name that tries to inject lines stays inside one escaped property", () => {
    const evil = "Set\n BEGIN:VEVENT\nATTACH:http://evil.example\r\nX:y";
    const ics = buildIcs({ ...base, session: { ...base.session, title: evil, description: evil }, placeName: evil, eventName: evil });
    const lines = ics.split("\r\n");
    expect(lines.filter((l) => l.startsWith("BEGIN:VEVENT"))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("ATTACH"))).toBe(false);
    const u = ics.replace(/\r\n /g, "");
    expect(u).toContain("SUMMARY:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\\nX:y — ");
    expect(u).toContain("DESCRIPTION:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\\nX:y\\n\\n");
    expect(u).toContain("LOCATION:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\\nX:y\\, Set");
  });
});

describe("ics folding and structure", () => {
  it("folds at 75 octets counted in UTF-8 bytes and never splits a multibyte character", () => {
    const line = "SUMMARY:" + "é€😀".repeat(30);
    const parts = foldIcsLine(line);
    expect(parts.length).toBeGreaterThan(1);
    const enc = new TextEncoder();
    for (const p of parts) expect(enc.encode(p).length).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    // Unfolding gives the original back.
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });

  it("a long title with ; , backslash and four-byte characters folds within 75 octets and unfolds to the escaped original", () => {
    const title = ("a;b,c\\" + "\u{1F600}".repeat(2)).repeat(20).slice(0, 120);
    const ics = buildIcs({ ...base, session: { ...base.session, title } });
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n /g, "")).toContain(`SUMMARY:${escapeIcsText(title)} — Main Stage\r\n`);
  });

  it("builds a fixed CRLF template with UTC times, a UID on our host and the link back", () => {
    const ics = buildIcs({ ...base, session: { ...base.session, description: "Plain" } });
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "").includes("\n")).toBe(false);
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("UID:fest-s-1@atlas.example\r\n");
    expect(unfolded).toContain("DTSTAMP:20260701T120000Z\r\n");
    expect(unfolded).toContain("DTSTART:20260710T200000Z\r\n");
    expect(unfolded).toContain("DTEND:20260710T213000Z\r\n");
    expect(unfolded).toContain("SUMMARY:Band\\; The\\, Best — Main Stage\r\n");
    expect(unfolded).toContain("LOCATION:Main Stage\\, Test Fest\r\n");
    expect(unfolded).toContain("DESCRIPTION:Plain\\n\\nhttps://atlas.example/e/test-fest\r\n");
    for (const forbidden of ["ORGANIZER", "ATTENDEE", "ATTACH", "VALARM"]) expect(unfolded).not.toContain(forbidden);
  });

  it("omits the link back when the slug is not valid and never uses the title in the file name", () => {
    const ics = buildIcs({ ...base, slug: "Bad Slug/../x" });
    expect(ics).not.toContain("/e/");
    expect(icsFileName("test-fest", "fest-s-1")).toBe("atlas-test-fest-fest-s-1.ics");
    expect(icsFileName("test-fest", "../evil")).toBe("atlas-session.ics");
  });
});

describe("Google Calendar link", () => {
  it("uses the fixed base and URLSearchParams-encoded parameters", () => {
    const url = new URL(googleCalendarUrl({ ...base, session: { ...base.session, title: "A&B=C#d", description: "x" } }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("A&B=C#d — Main Stage");
    expect(url.searchParams.get("dates")).toBe("20260710T200000Z/20260710T213000Z");
    expect(url.searchParams.get("location")).toBe("Main Stage, Test Fest");
    expect(url.searchParams.get("details")).toBe("x\n\nhttps://atlas.example/e/test-fest");
    expect([...url.searchParams.keys()].sort()).toEqual(["action", "dates", "details", "location", "text"]);
  });

  it("a description with &add= and &text= stays inside the details parameter", () => {
    const url = new URL(googleCalendarUrl({ ...base, session: { ...base.session, description: "x&add=evil@example.com&text=Hacked#frag" } }));
    expect(url.searchParams.getAll("add")).toEqual([]);
    expect(url.searchParams.get("text")).toBe("Band; The, Best — Main Stage");
    expect(url.searchParams.get("details")).toContain("x&add=evil@example.com&text=Hacked#frag");
  });

  it("truncates a long description so the URL stays short but keeps the link back", () => {
    const url = googleCalendarUrl({ ...base, session: { ...base.session, title: "T".repeat(120), description: "é\n".repeat(150) } });
    expect(url.length).toBeLessThanOrEqual(2000);
    expect(new URL(url).searchParams.get("details")).toContain("https://atlas.example/e/test-fest");
  });
});
