import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, eventInputSchema, toFieldErrors } from "@atlas/contract";

const valid = {
  name: "Fiesta de mi barrio",
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  timeZone: "Europe/Dublin",
  city: "Galway",
  country: "IE",
  language: "en",
  description: "A street party.",
  website: "https://example.com",
};

/** Field codes for a body, or null when it is valid. */
const codes = (over: Record<string, unknown>) => {
  const r = eventInputSchema.safeParse({ ...valid, ...over });
  return r.success ? null : toFieldErrors(r.error).map((f) => `${f.path}:${f.code}`);
};

describe("EventInput", () => {
  it("accepts a valid event, normalizes it and stores blank optionals as null", () => {
    const r = eventInputSchema.parse({ ...valid, name: "  Café Fest  ", description: "", website: "  " });
    expect(r.name).toBe("Café Fest"); // trimmed and NFC
    expect(r.description).toBeNull();
    expect(r.website).toBeNull();
    expect(eventInputSchema.parse({ ...valid, description: undefined, website: null }).website).toBeNull();
    expect(eventInputSchema.parse(valid).website).toBe("https://example.com/"); // url.href
  });

  it("name: 3 to 80 characters, measured after trim", () => {
    expect(codes({ name: "ab" })).toEqual(["name:too_short"]);
    expect(codes({ name: "  ab  " })).toEqual(["name:too_short"]);
    expect(codes({ name: "abc" })).toBeNull();
    expect(codes({ name: "a".repeat(80) })).toBeNull();
    expect(codes({ name: "a".repeat(81) })).toEqual(["name:too_long"]);
    expect(codes({ name: undefined })).toEqual(["name:required"]);
  });

  it("rejects control, bidi and zero-width characters; a line break only in the description", () => {
    for (const bad of ["a‮b", "a​b", "ab\u0000c", "a\u0085b", "a b", "a\nb"]) {
      expect(codes({ name: bad, city: bad })).toEqual(["name:control_chars", "city:control_chars"]);
    }
    expect(codes({ description: "line one\r\nline two" })).toBeNull();
    expect(eventInputSchema.parse({ ...valid, description: "a\r\nb" }).description).toBe("a\nb");
    expect(codes({ description: "a‮b" })).toEqual(["description:control_chars"]);
    expect(codes({ description: "a\rb" })).toEqual(["description:control_chars"]);
  });

  it("description: 500 ok, 501 rejected, URLs allowed as text", () => {
    expect(codes({ description: "x".repeat(500) })).toBeNull();
    expect(codes({ description: "x".repeat(501) })).toEqual(["description:too_long"]);
    expect(eventInputSchema.parse({ ...valid, description: "see https://evil.example/x" }).description).toBe(
      "see https://evil.example/x",
    );
  });

  it("dates: end before start, 30-day span ok, 31 rejected, real calendar days, year window", () => {
    expect(codes({ startDate: "2026-07-10", endDate: "2026-07-09" })).toEqual(["endDate:end_before_start"]);
    expect(codes({ startDate: "2026-07-10", endDate: "2026-07-10" })).toBeNull();
    expect(codes({ startDate: "2026-07-01", endDate: "2026-07-31" })).toBeNull(); // 30 days
    expect(codes({ startDate: "2026-07-01", endDate: "2026-08-01" })).toEqual(["endDate:span_too_long"]); // 31 days
    expect(codes({ startDate: "2028-02-29", endDate: "2028-03-01" })).toBeNull(); // leap day
    expect(codes({ startDate: "2026-02-29", endDate: "2026-03-01" })).toEqual(["startDate:invalid_date"]);
    expect(codes({ startDate: "2026-02-30" })).toEqual(["startDate:invalid_date"]);
    expect(codes({ startDate: "1999-12-31", endDate: "2000-01-01" })).toEqual(["startDate:invalid_date"]);
    expect(codes({ startDate: "2099-12-31", endDate: "2099-12-31" })).toBeNull();
    expect(codes({ startDate: "2100-01-01", endDate: "2100-01-01" })).toEqual([
      "startDate:invalid_date",
      "endDate:invalid_date",
    ]);
    expect(codes({ startDate: "2026-7-1" })).toEqual(["startDate:invalid_date"]);
  });

  it("website: https only, no userinfo, a dotted public host, at most 200 characters", () => {
    expect(codes({ website: "http://example.com" })).toEqual(["website:website_not_https"]);
    expect(codes({ website: "example.com" })).toEqual(["website:website_not_https"]);
    expect(codes({ website: "javascript:alert(1)" })).toEqual(["website:website_not_https"]);
    expect(codes({ website: "data:text/html,x" })).toEqual(["website:website_not_https"]);
    expect(codes({ website: "https://user:pw@example.com" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://localhost/x" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://intranet/x" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://127.0.0.1/" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://[::1]/" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://exa mple.com" })).toEqual(["website:invalid_url"]);
    expect(codes({ website: "https://example.com/\tx" })).toEqual(["website:control_chars"]);
    expect(codes({ website: `https://example.com/${"a".repeat(181)}` })).toEqual(["website:too_long"]);
    expect(codes({ website: `https://example.com/${"a".repeat(180)}` })).toBeNull();
  });

  it("time zone, country and language are allowlists", () => {
    expect(codes({ timeZone: "UTC" })).toBeNull();
    expect(codes({ timeZone: "America/New_York" })).toBeNull();
    for (const bad of ["Mars/Olympus", "+05:00", "europe/dublin", "", "EST5EDT x"]) {
      expect(codes({ timeZone: bad })).toEqual(["timeZone:invalid_time_zone"]);
    }
    expect(codes({ country: "ZZ" })).toEqual(["country:invalid_country"]);
    expect(codes({ country: "ie" })).toEqual(["country:invalid_country"]);
    expect(codes({ language: "fr" })).toEqual(["language:invalid_language"]);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES).toContain("DK");
  });

  it("rejects unknown keys (mass assignment) without echoing them", () => {
    for (const key of ["slug", "status", "ownerId", "owner_id", "dayStart", "id"]) {
      const r = eventInputSchema.safeParse({ ...valid, [key]: "x" });
      expect(r.success).toBe(false);
      if (!r.success) {
        const fields = toFieldErrors(r.error);
        expect(fields).toEqual([{ path: "body", code: "unknown_field" }]);
        expect(JSON.stringify(fields)).not.toContain(key);
      }
    }
    expect(toFieldErrors(eventInputSchema.safeParse("nope").error!)).toEqual([{ path: "body", code: "invalid" }]);
  });
});
