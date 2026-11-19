import { env } from "cloudflare:workers";
import app from "../src/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVITE_EMAIL_DAILY_CAP,
  INVITE_TOKEN_REGEX,
  ORGANIZER_LOCALES,
  inviteActionBodySchema,
  inviteFromRequestResponseSchema,
  organizerRequestActionResponseSchema,
  organizerRequestListResponseSchema,
  type OrganizerLocale,
} from "@atlas/contract";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { buildInviteEmail } from "../src/application/invite-email";

const ORIGIN = "http://atlas.test";
const baseEnv = { ...env, PUBLIC_ORIGIN: "https://atlas.test", RESEND_API_KEY: "re_test", NOTIFY_SUBJECT_PREFIX: "" };
const BASE = "/api/v1/admin/organizer-requests";

type Fetch = typeof fetch;
let resendStatus: number;
let sent: Array<Record<string, any>>;
let logs: string[];

beforeEach(async () => {
  await env.DB.batch(
    ["organizer_requests", "invite_email_log", "sessions", "invites", "organizers"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
  resendStatus = 200;
  sent = [];
  logs = [];
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.resend.com")) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response('{"id":"secret-response-body"}', { status: resendStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as Fetch);
  for (const m of ["log", "error", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let seq = 0;
async function user(role: "organizer" | "admin") {
  const n = ++seq;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, 'P', ?4, 0)").bind(`org_inv${n}`, `invsub${n}`, `user${n}@example.com`, role),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), `org_inv${n}`, Date.now() + 3_600_000),
  ]);
  return session;
}

let ip = 0;
const call = (method: string, path: string, session?: string, body?: unknown, over: Record<string, unknown> = {}) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        "cf-connecting-ip": `203.0.113.${(ip++ % 250) + 1}`,
        ...(method !== "GET" ? { "content-type": "application/json", origin: ORIGIN } : {}),
        ...(session ? { cookie: `__Host-atlas_session=${session}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { ...baseEnv, ...over } as unknown as typeof env,
  );

async function addRequest(over: { email?: string; locale?: OrganizerLocale; status?: string; createdAt?: number } = {}): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO organizer_requests (name, email, event_name, created_at, locale, status) VALUES ('Ana', ?1, 'Fiesta', ?2, ?3, ?4)")
    .bind(over.email ?? "ana@example.com", over.createdAt ?? Date.now(), over.locale ?? "es", over.status ?? "pending")
    .run();
  return r.meta.last_row_id;
}
const invite = (session: string, id: number, body: unknown = {}) => call("POST", `${BASE}/${id}/invite`, session, body);
const again = (session: string, id: number, body: unknown = {}) => call("POST", `${BASE}/${id}/invite-again`, session, body);
const statusOf = async (id: number) => (await env.DB.prepare("SELECT status FROM organizer_requests WHERE id = ?1").bind(id).first<{ status: string }>())!.status;
const inviteCount = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM invites").first<{ n: number }>())!.n;
const tokenOf = (link: string) => link.split("/panel/invite/")[1]!;

describe("authorization on every new mutation", () => {
  it("anonymous is 401 and an organizer is 403; nothing changes and no email goes out", async () => {
    const id = await addRequest();
    const organizer = await user("organizer");
    for (const action of ["invite", "invite-again", "discard", "restore"]) {
      expect((await call("POST", `${BASE}/${id}/${action}`, undefined, {})).status, `anon ${action}`).toBe(401);
      expect((await call("POST", `${BASE}/${id}/${action}`, organizer, {})).status, `organizer ${action}`).toBe(403);
    }
    expect(await statusOf(id)).toBe("pending");
    expect(await inviteCount()).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("POST /:id/invite", () => {
  it("creates the invite, marks Invited and sends one fixed-shape email; the response never carries the token", async () => {
    const admin = await user("admin");
    const id = await addRequest({ email: "ana@example.com", locale: "ca" });
    const res = await invite(admin, id, { note: "  Hola Ana\r\nCom estàs?  " });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const body = inviteFromRequestResponseSchema.parse(JSON.parse(text));
    expect(body.emailStatus).toBe("sent");
    expect(body.inviteLink).toBeUndefined();
    expect(text).not.toContain("/panel/invite/");
    expect(body.request.status).toBe("invited");
    expect(body.request.inviteState).toBe("active");
    expect(await statusOf(id)).toBe("invited");

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail.from).toBe("leyenda.ink <noreply@leyenda.ink>");
    expect(mail.reply_to).toBe("contact@leyenda.ink");
    expect(mail.to).toEqual(["ana@example.com"]);
    expect(mail.subject).toBe("La teva invitació a leyenda.ink");
    expect(mail.html).toBeUndefined();
    expect(mail.text.startsWith("Hola Ana\nCom estàs?\n----\nL'únic enllaç per acceptar és el de sota, a atlas.test.\n\n")).toBe(true);
    const link = /https:\/\/atlas\.test\/panel\/invite\/(\S+)/.exec(mail.text)!;
    expect(INVITE_TOKEN_REGEX.test(link[1]!)).toBe(true);
    expect(mail.text).toContain("ana@example.com");

    // Only the hash is stored.
    const row = await env.DB.prepare("SELECT token_hash, email FROM invites").first<{ token_hash: string; email: string }>();
    expect(row!.token_hash).toBe(await sha256Hex(link[1]!));
    expect(row!.email).toBe("ana@example.com");
    // The token, address, note and Resend body never reach the logs.
    const all = logs.join("\n");
    for (const secret of [link[1]!, "ana@example.com", "Hola Ana", "secret-response-body", "re_test"]) expect(all).not.toContain(secret);
  });

  it("returns the link once when Resend fails; the invite still exists and the link matches the stored hash", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    resendStatus = 500;
    const res = await invite(admin, id);
    expect(res.status).toBe(201);
    const body = inviteFromRequestResponseSchema.parse(await res.json());
    expect(body.emailStatus).toBe("failed");
    expect(body.inviteLink).toMatch(/^https:\/\/atlas\.test\/panel\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(await sha256Hex(tokenOf(body.inviteLink!))).toBe((await env.DB.prepare("SELECT token_hash FROM invites").first<{ token_hash: string }>())!.token_hash);
    expect(body.request.status).toBe("invited");
    // The list never exposes it.
    const list = await (await call("GET", `${BASE}?status=all`, admin)).text();
    expect(list).not.toContain("/panel/invite/");
    expect(logs.join("\n")).not.toContain(tokenOf(body.inviteLink!));
  });

  it("skips the email at the daily cap but still creates the invite and returns the link", async () => {
    const admin = await user("admin");
    const now = Date.now();
    await env.DB.batch(Array.from({ length: INVITE_EMAIL_DAILY_CAP }, (_, i) => env.DB.prepare("INSERT INTO invite_email_log (invite_id, created_at) VALUES (?1, ?2)").bind(`inv_cap${i}`, now)));
    const id = await addRequest();
    const body = inviteFromRequestResponseSchema.parse(await (await invite(admin, id)).json());
    expect(body.emailStatus).toBe("skipped");
    expect(body.inviteLink).toBeDefined();
    expect(sent).toHaveLength(0);
    expect(await statusOf(id)).toBe("invited");
    expect(await inviteCount()).toBe(1);
  });

  it("counts only the current UTC day against the cap", async () => {
    const admin = await user("admin");
    const yesterday = Math.floor(Date.now() / 86_400_000) * 86_400_000 - 1000;
    await env.DB.batch(Array.from({ length: INVITE_EMAIL_DAILY_CAP }, (_, i) => env.DB.prepare("INSERT INTO invite_email_log (invite_id, created_at) VALUES (?1, ?2)").bind(`inv_old${i}`, yesterday)));
    const id = await addRequest();
    expect(inviteFromRequestResponseSchema.parse(await (await invite(admin, id)).json()).emailStatus).toBe("sent");
  });

  it("is skipped (link returned) when Resend is not configured", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    const res = await call("POST", `${BASE}/${id}/invite`, admin, {}, { RESEND_API_KEY: undefined });
    const body = inviteFromRequestResponseSchema.parse(await res.json());
    expect(body.emailStatus).toBe("skipped");
    expect(body.inviteLink).toBeDefined();
  });

  it("409 invite_already_pending when an active invite exists for the email; nothing changes, no email", async () => {
    const admin = await user("admin");
    const id = await addRequest({ email: "ana@example.com" });
    await env.DB.prepare("INSERT INTO invites (id, token_hash, email, created_by, created_at, expires_at) VALUES ('inv_x', 'h', 'ana@example.com', (SELECT id FROM organizers LIMIT 1), ?1, ?2)").bind(Date.now(), Date.now() + 1e9).run();
    const res = await invite(admin, id);
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe("invite_already_pending");
    expect(await statusOf(id)).toBe("pending");
    expect(await inviteCount()).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it("409 email_already_registered when the person already has an account; the row shows Joined", async () => {
    const admin = await user("admin");
    await env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org_ana', 'sub_ana', 'ana@example.com', 'Ana', 'organizer', 0)").run();
    const id = await addRequest({ email: "ana@example.com" });
    const res = await invite(admin, id);
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe("email_already_registered");
    expect(sent).toHaveLength(0);
    const joined = organizerRequestListResponseSchema.parse(await (await call("GET", `${BASE}?status=joined`, admin)).json());
    expect(joined.requests.map((r) => r.status)).toEqual(["joined"]);
    expect(organizerRequestListResponseSchema.parse(await (await call("GET", BASE, admin)).json()).requests).toHaveLength(0);
  });

  it("409 email_already_registered for the configured Admin email", async () => {
    const admin = await user("admin");
    const id = await addRequest({ email: "admin@example.com" });
    expect((await invite(admin, id)).status).toBe(409);
    expect(await inviteCount()).toBe(0);
  });

  it("the double-click loser gets 409 and sends nothing (compare-and-swap)", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    const [a, b] = await Promise.all([invite(admin, id), invite(admin, id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect((await loser.json() as any).error.code).toMatch(/invalid_transition|invite_already_pending/);
    expect(await inviteCount()).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("validates the body: strict keys, note at most 1000 characters, hostile characters stripped", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    expect((await invite(admin, id, { note: "x", email: "evil@example.com" })).status).toBe(400);
    expect((await invite(admin, id, { note: "x".repeat(1001) })).status).toBe(400);
    expect((await invite(admin, id, { note: 5 })).status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
    expect(inviteActionBodySchema.parse({ note: "a‮b​c\u0007d\u0085e\r\nf" }).note).toBe("abcde\nf");
    expect(inviteActionBodySchema.parse({ note: "a\u200Eb\u200Fc\u061Cd\u2028e\u2029f\ng" }).note).toBe("abcdef\ng");
    expect(inviteActionBodySchema.parse({ note: " \n " }).note).toBeUndefined();
    const res = await invite(admin, id, { note: "gate ‮hello​" });
    expect(res.status).toBe(201);
    expect(sent[0]!.text.startsWith("gate hello\n")).toBe(true);
  });

  it("404 for an unknown or malformed id", async () => {
    const admin = await user("admin");
    expect((await invite(admin, 99999)).status).toBe(404);
    expect((await call("POST", `${BASE}/abc/invite`, admin, {})).status).toBe(404);
    expect((await call("POST", `${BASE}/0/discard`, admin, {})).status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});

describe("POST /:id/invite-again", () => {
  it("revokes the active invite, creates a new one, emails again; the old link stops working", async () => {
    const admin = await user("admin");
    const id = await addRequest({ locale: "en" });
    await invite(admin, id);
    const first = /panel\/invite\/(\S+)/.exec(sent[0]!.text)![1]!;
    const res = await again(admin, id, { note: "second try" });
    expect(res.status).toBe(201);
    expect(inviteFromRequestResponseSchema.parse(await res.json()).emailStatus).toBe("sent");
    expect(sent).toHaveLength(2);
    const second = /panel\/invite\/(\S+)/.exec(sent[1]!.text)![1]!;
    expect(second).not.toBe(first);
    expect(sent[1]!.subject).toBe("Your invitation to leyenda.ink");
    const inspect = (token: string) => call("POST", "/api/v1/invites/inspect", undefined, { token });
    expect(await (await inspect(first)).json()).toEqual({ status: "revoked" });
    expect(((await (await inspect(second)).json()) as any).status).toBe("valid");
    expect(await statusOf(id)).toBe("invited");
  });

  it("works on an expired invite and as the retry after a failed email", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    resendStatus = 500;
    await invite(admin, id);
    resendStatus = 200;
    await env.DB.prepare("UPDATE invites SET expires_at = ?1").bind(Date.now() - 1000).run();
    const list = organizerRequestListResponseSchema.parse(await (await call("GET", `${BASE}?status=invited`, admin)).json());
    expect(list.requests[0]!.inviteState).toBe("expired");
    const res = await again(admin, id);
    expect(res.status).toBe(201);
    expect(inviteFromRequestResponseSchema.parse(await res.json()).request.inviteState).toBe("active");
  });

  it("two concurrent Invite agains: one wins, the loser gets 409 and sends nothing", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    await invite(admin, id);
    sent.length = 0;
    const [a, b] = await Promise.all([again(admin, id), again(admin, id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(sent).toHaveLength(1);
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE revoked_at IS NULL AND used_at IS NULL").first<{ n: number }>();
    expect(active!.n).toBe(1);
  });

  it("is refused on a Pending request and on a Joined one", async () => {
    const admin = await user("admin");
    const pending = await addRequest({ email: "p@example.com" });
    const r1 = await again(admin, pending);
    expect(r1.status).toBe(409);
    expect((await r1.json() as any).error.code).toBe("invalid_transition");

    const id = await addRequest({ email: "j@example.com" });
    await invite(admin, id);
    await env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES ('org_j', 'sub_j', 'j@example.com', 'J', 'organizer', 0)").run();
    const r2 = await again(admin, id);
    expect(r2.status).toBe(409);
    expect((await r2.json() as any).error.code).toBe("email_already_registered");
  });
});

describe("discard and restore", () => {
  it("Pending -> Discarded -> Pending, and every other transition is 409 invalid_transition", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    const code = async (r: Response) => (await r.json() as any).error?.code;
    const act = (a: string) => call("POST", `${BASE}/${id}/${a}`, admin, {});

    expect(await code(await act("restore"))).toBe("invalid_transition");
    const d = await act("discard");
    expect(d.status).toBe(200);
    expect(organizerRequestActionResponseSchema.parse(await d.json()).request.status).toBe("discarded");
    expect(await code(await act("discard"))).toBe("invalid_transition");
    expect(await code(await invite(admin, id))).toBe("invalid_transition");
    expect(await code(await again(admin, id))).toBe("invalid_transition");
    expect(organizerRequestListResponseSchema.parse(await (await call("GET", BASE, admin)).json()).requests).toHaveLength(0);
    expect(organizerRequestListResponseSchema.parse(await (await call("GET", `${BASE}?status=discarded`, admin)).json()).requests).toHaveLength(1);
    expect((await act("restore")).status).toBe(200);
    expect(await statusOf(id)).toBe("pending");

    await invite(admin, id);
    expect(await code(await act("discard"))).toBe("invalid_transition");
    expect(await code(await act("restore"))).toBe("invalid_transition");
    expect(await statusOf(id)).toBe("invited");
    expect((await call("POST", `${BASE}/9999/discard`, admin, {})).status).toBe(404);
  });

  it("takes no fields", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    expect((await call("POST", `${BASE}/${id}/discard`, admin, { note: "x" })).status).toBe(400);
    expect(await statusOf(id)).toBe("pending");
  });
});

describe("list filter and Joined", () => {
  it("defaults to pending; filters invited, joined, discarded, all; rejects unknown values", async () => {
    const admin = await user("admin");
    const p = await addRequest({ email: "p@example.com", createdAt: 1000 });
    const i = await addRequest({ email: "i@example.com", createdAt: 2000 });
    const d = await addRequest({ email: "d@example.com", createdAt: 3000, status: "discarded" });
    const j = await addRequest({ email: "j@example.com", createdAt: 4000 });
    await invite(admin, i);
    await invite(admin, j);
    await env.DB.prepare("UPDATE invites SET used_at = ?1 WHERE email = 'j@example.com'").bind(Date.now()).run();
    const ids = async (q: string) => {
      const res = await call("GET", `${BASE}${q}`, admin);
      const text = await res.text();
      expect(res.status, text).toBe(200);
      return organizerRequestListResponseSchema.parse(JSON.parse(text)).requests.map((r) => Number(r.id));
    };
    expect(await ids("")).toEqual([p]);
    expect(await ids("?status=pending")).toEqual([p]);
    expect(await ids("?status=invited")).toEqual([i]);
    expect(await ids("?status=joined")).toEqual([j]);
    expect(await ids("?status=discarded")).toEqual([d]);
    expect(await ids("?status=all")).toEqual([j, d, i, p]);
    expect((await call("GET", `${BASE}?status=bogus`, admin)).status).toBe(400);
  });
});

describe("invite email templates", () => {
  it("every locale has its own subject, the fixed order, and only the allowed interpolations", () => {
    const subjects = new Map<string, string>();
    for (const locale of ORGANIZER_LOCALES) {
      const { subject, text } = buildInviteEmail(locale, { note: "NOTE", link: "https://x.test/panel/invite/T", email: "a@b.test", host: "atlas.test" });
      subjects.set(locale, subject);
      const lines = text.split("\n");
      expect(lines[0]).toBe("NOTE");
      expect(lines[1]).toBe("----");
      expect(lines[2]).toMatch(/atlas\.test\.$/);
      expect(lines[2]).not.toBe(lines[0]);
      expect(text.indexOf("NOTE")).toBeLessThan(text.indexOf("https://x.test/panel/invite/T"));
      expect(text).toContain("a@b.test");
      expect(text).toContain("7");
      expect(text.trimEnd().endsWith("leyenda.ink")).toBe(true);
      expect(buildInviteEmail(locale, { link: "L", email: "e" }).text.startsWith("NOTE")).toBe(false);
    }
    expect(subjects.get("es")).toBe("Tu invitación a leyenda.ink");
    expect(subjects.get("da")).toBe("Din invitation til leyenda.ink");
    expect(new Set(subjects.values()).size).toBe(4); // es and es-vos share a subject
    const tu = buildInviteEmail("es", { link: "L", email: "e" }).text;
    const vos = buildInviteEmail("es-vos", { link: "L", email: "e" }).text;
    expect(vos).not.toBe(tu);
    expect(vos).toContain("Aceptá");
  });
});

describe("admin rate limit", () => {
  it("a refusing ADMIN_LIMITER gives 429 on the list and on invite, and nothing is sent", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    const over = { ADMIN_LIMITER: { limit: async () => ({ success: false }) } };
    const list = await call("GET", BASE, admin, undefined, over);
    expect(list.status).toBe(429);
    const res = await call("POST", `${BASE}/${id}/invite`, admin, {}, over);
    expect(res.status).toBe(429);
    expect(await statusOf(id)).toBe("pending");
    expect(sent).toHaveLength(0);
  });
});

describe("invite inspection never consumes", () => {
  it("inspecting an invite any number of times leaves it usable", async () => {
    const admin = await user("admin");
    const id = await addRequest();
    resendStatus = 500;
    const res = await invite(admin, id);
    const text = await res.text();
    expect(res.status, text).toBe(201);
    const link = inviteFromRequestResponseSchema.parse(JSON.parse(text)).inviteLink!;
    const token = tokenOf(link);
    for (let n = 0; n < 3; n++) {
      const r = await call("POST", "/api/v1/invites/inspect", undefined, { token });
      expect(((await r.json()) as any).status).toBe("valid");
    }
    const row = await env.DB.prepare("SELECT used_at, revoked_at FROM invites").first<{ used_at: number | null; revoked_at: number | null }>();
    expect(row).toEqual({ used_at: null, revoked_at: null });
  });
});
