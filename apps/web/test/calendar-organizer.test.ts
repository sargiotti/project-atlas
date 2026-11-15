import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, googleCalendarUrl } from "../src/lib/calendar";

// Slice 13: organizers now write the titles, descriptions and place names. These lock the escaping against input shaped
// like an attack (the escaping itself already existed since slice 09; see calendar.test.ts for the basics).
const base = {
  session: { id: "fest-s-1", title: "Band; The, Best", start: "2026-07-10T20:00:00Z", end: "2026-07-10T21:30:00Z", description: undefined as string | undefined },
  placeName: "Main Stage",
  eventName: "Test Fest",
  slug: "test-fest",
  origin: "https://atlas.example",
  nowMs: Date.UTC(2026, 6, 1, 12, 0, 0),
};
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("organizer-style input", () => {
  it("a title, description or place name with line breaks and a fake VEVENT stays inside one escaped property", () => {
    const evil = "Set\n BEGIN:VEVENT\nATTACH:http://evil.example";
    const ics = buildIcs({ ...base, session: { ...base.session, title: evil, description: evil }, placeName: evil, eventName: evil });
    const lines = ics.split("\r\n");
    expect(lines.filter((l) => l.startsWith("BEGIN:VEVENT"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("ATTACH"))).toHaveLength(0);
    const u = unfold(ics);
    expect(u).toContain("SUMMARY:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example — ");
    expect(u).toContain("DESCRIPTION:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\\n\\n");
    expect(u).toContain("LOCATION:Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\\, Set\\n BEGIN:VEVENT\\nATTACH:http://evil.example\r\n");
  });

  it("a 120-character title with ; , backslash and four-byte characters folds within 75 octets and unfolds to the original", () => {
    const title = ("a;b,c\\" + "\u{1F600}".repeat(2)).repeat(20).slice(0, 120);
    const ics = buildIcs({ ...base, session: { ...base.session, title } });
    const enc = new TextEncoder();
    for (const line of ics.split("\r\n")) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(`SUMMARY:${escapeIcsText(title)} — Main Stage\r\n`);
  });

  it("a description with &add= and &text= stays inside the details parameter of the Google link", () => {
    const url = new URL(googleCalendarUrl({ ...base, session: { ...base.session, description: "x&add=evil@example.com&text=Hacked#frag" } }));
    expect(url.searchParams.getAll("add")).toEqual([]);
    expect(url.searchParams.get("text")).toBe("Band; The, Best — Main Stage");
    expect(url.searchParams.get("details")).toContain("x&add=evil@example.com&text=Hacked#frag");
    expect([...url.searchParams.keys()].sort()).toEqual(["action", "dates", "details", "location", "text"]);
  });
});
