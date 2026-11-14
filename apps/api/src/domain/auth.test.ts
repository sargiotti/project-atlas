import { describe, expect, it } from "vitest";
import { DAY_MS, checkIdTokenClaims, decideSignIn, displayNameFrom, inviteStatus, normalizeEmail } from "./auth";

const NOW = 1_800_000_000_000;
const validInvite = { email: "ana@example.com", expiresAt: NOW + DAY_MS, usedAt: null, revokedAt: null };
const facts = (over: Partial<Parameters<typeof decideSignIn>[0]> = {}) => ({
  hasAccountForSub: false,
  email: "ana@example.com",
  adminEmail: "boss@example.com",
  invite: validInvite,
  inviteTokenUnknown: false,
  now: NOW,
  ...over,
});

describe("inviteStatus", () => {
  it("is valid until it expires, is used or is revoked; used wins over revoked wins over expired", () => {
    expect(inviteStatus(validInvite, NOW)).toBe("valid");
    expect(inviteStatus({ ...validInvite, expiresAt: NOW }, NOW)).toBe("expired");
    expect(inviteStatus({ ...validInvite, revokedAt: 1 }, NOW)).toBe("revoked");
    expect(inviteStatus({ ...validInvite, usedAt: 1, revokedAt: 1, expiresAt: 0 }, NOW)).toBe("used");
    expect(inviteStatus({ ...validInvite, revokedAt: 1, expiresAt: 0 }, NOW)).toBe("revoked");
  });
});

describe("decideSignIn", () => {
  it("accepts a valid invite when the verified email matches, ignoring case and spaces", () => {
    expect(decideSignIn(facts({ email: "  ANA@Example.com " }))).toEqual({ kind: "accept_invite" });
  });

  it("rejects a different email without consuming anything, and does not treat Gmail dots or plus as equal", () => {
    expect(decideSignIn(facts({ email: "bob@example.com" }))).toEqual({ kind: "reject", code: "invite_email_mismatch" });
    expect(decideSignIn(facts({ invite: { ...validInvite, email: "a.na@example.com" }, email: "ana@example.com" }))).toEqual({
      kind: "reject",
      code: "invite_email_mismatch",
    });
    expect(decideSignIn(facts({ email: "ana+x@example.com" }))).toEqual({ kind: "reject", code: "invite_email_mismatch" });
  });

  it("reports used, revoked and expired invites with their own codes, before comparing emails", () => {
    const wrongEmail = { email: "bob@example.com" };
    expect(decideSignIn(facts({ ...wrongEmail, invite: { ...validInvite, usedAt: 1 } }))).toEqual({ kind: "reject", code: "invite_used" });
    expect(decideSignIn(facts({ ...wrongEmail, invite: { ...validInvite, revokedAt: 1 } }))).toEqual({ kind: "reject", code: "invite_revoked" });
    expect(decideSignIn(facts({ ...wrongEmail, invite: { ...validInvite, expiresAt: NOW - 1 } }))).toEqual({ kind: "reject", code: "invite_expired" });
  });

  it("an unknown invite token is invite_not_found; no invite at all is no_access", () => {
    expect(decideSignIn(facts({ invite: null, inviteTokenUnknown: true }))).toEqual({ kind: "reject", code: "invite_not_found" });
    expect(decideSignIn(facts({ invite: null }))).toEqual({ kind: "reject", code: "no_access" });
  });

  it("an existing sub signs in without looking at email or invite", () => {
    expect(decideSignIn(facts({ hasAccountForSub: true, email: "other@example.com", invite: null }))).toEqual({ kind: "existing" });
  });

  it("creates the Admin only on a verified email equal to ADMIN_EMAIL (case-insensitive); an unset ADMIN_EMAIL grants nothing", () => {
    expect(decideSignIn(facts({ email: "BOSS@example.com", invite: null }))).toEqual({ kind: "create_admin" });
    expect(decideSignIn(facts({ email: "", adminEmail: "", invite: null }))).toEqual({ kind: "reject", code: "no_access" });
    expect(decideSignIn(facts({ email: "boss@example.com", adminEmail: undefined, invite: null }))).toEqual({ kind: "reject", code: "no_access" });
  });
});

describe("checkIdTokenClaims", () => {
  const nowSeconds = 1_800_000_000;
  const expected = { clientId: "client-1", nonce: "nonce-1", nowSeconds };
  const good = {
    iss: "https://accounts.google.com",
    aud: "client-1",
    azp: "client-1",
    exp: nowSeconds + 3600,
    iat: nowSeconds - 5,
    nonce: "nonce-1",
    sub: "123",
    email: "Ana@Example.com",
    email_verified: true,
    name: "Ana",
  };
  const reason = (over: Record<string, unknown>) => {
    const r = checkIdTokenClaims({ ...good, ...over }, expected);
    return r.ok ? "ok" : r.reason;
  };

  it("accepts a good token and normalizes the email", () => {
    const r = checkIdTokenClaims(good, expected);
    expect(r).toEqual({ ok: true, identity: { sub: "123", email: "ana@example.com", name: "Ana" } });
    expect(reason({ iss: "accounts.google.com" })).toBe("ok");
  });

  it.each([
    [{ iss: "https://evil.example" }, "issuer"],
    [{ aud: "other-client" }, "audience"],
    [{ aud: ["x", "client-1"] }, "ok"],
    [{ azp: "other-client" }, "azp"],
    [{ exp: nowSeconds - 61 }, "expired"],
    [{ exp: nowSeconds - 30 }, "ok"],
    [{ iat: nowSeconds + 61 }, "issued_in_future"],
    [{ nonce: "replayed" }, "nonce"],
    [{ nonce: undefined }, "nonce"],
    [{ email_verified: false }, "email_not_verified"],
    [{ email_verified: "true" }, "email_not_verified"],
    [{ email: undefined }, "email_missing"],
    [{ sub: "" }, "sub"],
  ])("%j -> %s", (over, expectedReason) => {
    expect(reason(over)).toBe(expectedReason);
  });
});

describe("small helpers", () => {
  it("normalizeEmail trims and lowercases only", () => {
    expect(normalizeEmail("  A.B+c@Example.COM ")).toBe("a.b+c@example.com");
  });
  it("displayNameFrom strips control characters, caps length and falls back to the email local part", () => {
    expect(displayNameFrom("  Ana\u0000  ‮Lopez ", "x@y.z")).toBe("Ana Lopez");
    expect(displayNameFrom("a".repeat(300), "x@y.z")).toHaveLength(100);
    expect(displayNameFrom(undefined, "ana@y.z")).toBe("ana");
    expect(displayNameFrom("   ", "ana@y.z")).toBe("ana");
  });
});
