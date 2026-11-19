import { env } from "cloudflare:workers";
import app from "../src/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorResponseSchema, organizerRequestListResponseSchema, organizerRequestSchema, toOrganizerFieldErrors, type OrganizerRequestInput } from "@atlas/contract";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { isAllowedTurnstileHostname } from "../src/application/turnstile";
import { buildNotification, defang } from "../src/application/organizer-notify";
import { pruneOrganizerRequests } from "../src/application/prune";

const ORIGIN = "http://atlas.test";
const baseEnv = { ...env, PUBLIC_ORIGIN: "https://atlas.test", TURNSTILE_SECRET: "real-secret", RESEND_API_KEY: "re_test", NOTIFY_FROM: "leyenda.ink <noreply@leyenda.ink>", NOTIFY_TO: "contact@leyenda.ink", NOTIFY_SUBJECT_PREFIX: "" };

let ip = 0;
const post = (json: unknown, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request(`${ORIGIN}/api/v1/organizer-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": `198.51.100.${(ip++ % 250) + 1}`, ...headers },
      body: JSON.stringify(json),
    }),
    { ...baseEnv, ...over } as unknown as typeof env,
  );

const form = (over: Partial<OrganizerRequestInput> = {}): OrganizerRequestInput => ({
  name: "Ana Pérez",
  email: "Ana@Example.com",
  eventName: "Fiesta del barrio",
  elapsedMs: 8000,
  turnstileToken: "token",
  ...over,
});

const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM organizer_requests").first<{ n: number }>())!.n;

type Fetch = typeof fetch;
let turnstile: { success: boolean; action?: string; hostname?: string; status?: number; throws?: boolean };
let resendStatus: number;
let calls: string[];

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM organizer_requests").run();
  turnstile = { success: true, action: "organizer_request", hostname: "atlas.test" };
  resendStatus = 200;
  calls = [];
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("siteverify")) {
      if (turnstile.throws) throw new Error("network");
      return Response.json({ success: turnstile.success, action: turnstile.action, hostname: turnstile.hostname }, { status: turnstile.status ?? 200 });
    }
    if (url.includes("api.resend.com")) return new Response("{}", { status: resendStatus });
    throw new Error(`unexpected fetch ${url}`);
  }) as Fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("organizerRequestSchema", () => {
  it("normalizes: trims, lowercases the email and treats blank optionals as absent", () => {
    const r = organizerRequestSchema.parse(form({ name: "  Ana  ", eventDate: "   ", city: "" }));
    expect(r).toMatchObject({ name: "Ana", email: "ana@example.com", eventDate: undefined, city: undefined });
  });

  it("reports stable codes per field and never the values", () => {
    const bad = { ...form({ email: "nope", name: "", eventName: "a\nb", city: "x".repeat(101), message: "ok\nline" }), extra: 1 };
    const res = organizerRequestSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (res.success) return;
    const fields = toOrganizerFieldErrors(res.error);
    expect(fields).toEqual(
      expect.arrayContaining([
        { path: "email", code: "invalid" },
        { path: "name", code: "required" },
        { path: "eventName", code: "control_chars" },
        { path: "city", code: "too_long" },
        { path: "body", code: "unknown_field" },
      ]),
    );
    expect(fields.some((f) => f.path === "message")).toBe(false); // a newline is fine in the message
  });
});

describe("POST /api/v1/organizer-requests", () => {
  it("stores a valid request, answers 201 no-store, and emails the organizer details with Reply-To", async () => {
    let sent: { subject: string; reply_to: string; text: string; html?: string } | undefined;
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("api.resend.com")) sent = JSON.parse(String(init?.body));
      return original(input, init);
    }) as Fetch);
    const res = await post(form({ message: "See https://x.example and www.y.example" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    const row = await env.DB.prepare("SELECT * FROM organizer_requests").first<Record<string, unknown>>();
    expect(row).toMatchObject({ name: "Ana Pérez", email: "ana@example.com", email_status: "sent" });
    expect(sent?.subject).toBe(`New organizer request #${row!.id}`);
    expect(sent?.reply_to).toBe("ana@example.com");
    expect(sent?.html).toBeUndefined();
    expect(sent?.text).toContain("hxxps://x[.]example and www[.]y[.]example");
  });

  it("keeps the request when the email service fails", async () => {
    resendStatus = 500;
    expect((await post(form())).status).toBe(201);
    expect((await env.DB.prepare("SELECT email_status AS s FROM organizer_requests").first<{ s: string }>())!.s).toBe("failed");
  });

  it("marks the email as skipped when no Resend key is configured", async () => {
    expect((await post(form(), { RESEND_API_KEY: undefined })).status).toBe(201);
    expect((await env.DB.prepare("SELECT email_status AS s FROM organizer_requests").first<{ s: string }>())!.s).toBe("skipped");
  });

  it("answers the normal 201 to a honeypot hit and stores, verifies and sends nothing", async () => {
    const res = await post(form({ website: "http://spam.example" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(await count()).toBe(0);
    expect(calls).toEqual([]);
  });

  it("refuses a submission that was too fast before calling Turnstile", async () => {
    const res = await post(form({ elapsedMs: 1200 }));
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("submission_rejected");
    expect(calls).toEqual([]);
    expect(await count()).toBe(0);
  });

  it("refuses a failed, wrong-action or wrong-hostname Turnstile with one generic code", async () => {
    for (const t of [{ success: false }, { success: true, action: "other", hostname: "atlas.test" }, { success: true, action: "organizer_request", hostname: "evil.example" }]) {
      turnstile = t;
      const res = await post(form());
      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(await res.json()).error.code).toBe("submission_rejected");
    }
    expect(await count()).toBe(0);
  });

  it("fails closed (503, nothing stored) when Turnstile cannot be reached or the secret is missing", async () => {
    turnstile = { success: true, throws: true };
    expect((await post(form())).status).toBe(503);
    turnstile = { success: true, status: 502 };
    expect((await post(form())).status).toBe(503);
    expect((await post(form(), { TURNSTILE_SECRET: undefined })).status).toBe(503);
    expect(await count()).toBe(0);
  });

  it("answers the uniform 201 and stores nothing past 3 per email per day", async () => {
    for (let i = 0; i < 4; i++) expect((await post(form())).status).toBe(201);
    expect(await count()).toBe(3);
  });

  it("answers 429 daily_cap_reached once 50 requests are stored today", async () => {
    const now = Date.now();
    await env.DB.batch(Array.from({ length: 50 }, (_, i) => env.DB.prepare("INSERT INTO organizer_requests (name, email, event_name, created_at) VALUES ('n', ?1, 'e', ?2)").bind(`u${i}@example.com`, now)));
    const res = await post(form({ email: "fresh@example.com" }));
    expect(res.status).toBe(429);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("daily_cap_reached");
    expect(await count()).toBe(50);
  });

  it("rejects cross-site posts, non-JSON and oversized bodies before any work", async () => {
    expect((await post(form(), {}, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post(form(), {}, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(form({ message: "x".repeat(9000) }))).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("answers 429 with Retry-After when the per-IP limiter refuses", async () => {
    const res = await post(form(), { FORM_LIMITER: { limit: async () => ({ success: false }) } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(calls).toEqual([]);
  });
});

describe("notification and retention", () => {
  it("prints '-' for empty optional fields and puts only the server id in the subject", () => {
    const parsed = organizerRequestSchema.parse(form({ eventName: "Evil <b>subject</b>" }));
    const { subject, text } = buildNotification(7, 0, parsed, "[preview] ");
    expect(subject).toBe("[preview] New organizer request #7");
    expect(text).toContain("City: -");
    expect(text).toContain("Event: Evil <b>subject</b>");
  });

  it("defangs URLs and bare domains in user text but not in the Email line", () => {
    expect(defang("see https://evil.com and www.x.org or foo.io")).toBe("see hxxps://evil[.]com and www[.]x[.]org or foo[.]io");
    expect(defang(defang("a.com"))).toBe("a[.]com");
    const parsed = organizerRequestSchema.parse(form({ eventName: "fest.ar", message: "visit evil.com" }));
    const { text } = buildNotification(1, 0, parsed, "");
    expect(text).toContain("Event: fest[.]ar");
    expect(text).toContain("visit evil[.]com");
    expect(text).toContain("Email: ana@example.com");
  });

  it("accepts only the PUBLIC_ORIGIN host in production and fixed preview hosts on previews", () => {
    expect(isAllowedTurnstileHostname("https://leyenda.ink", "leyenda.ink")).toBe(true);
    for (const h of ["www.leyenda.ink", "slice-x-atlas.sargiotti67.workers.dev", "atlas.sargiotti67.workers.dev", "evil.example"]) expect(isAllowedTurnstileHostname("https://leyenda.ink", h)).toBe(false);
    const prev = "https://atlas.sargiotti67.workers.dev";
    for (const h of ["atlas.sargiotti67.workers.dev", "slice-30-organizer-page-atlas.sargiotti67.workers.dev"]) expect(isAllowedTurnstileHostname(prev, h)).toBe(true);
    for (const h of ["leyenda.ink", "evilatlas.sargiotti67.workers.dev", "x-atlas.sargiotti67.workers.dev.evil.com", "x-atlas.other.dev"]) expect(isAllowedTurnstileHostname(prev, h)).toBe(false);
  });

  it("prunes requests older than 12 months only", async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizer_requests (name, email, event_name, created_at) VALUES ('old', 'o@example.com', 'e', ?1)").bind(now - 366 * 86_400_000),
      env.DB.prepare("INSERT INTO organizer_requests (name, email, event_name, created_at) VALUES ('new', 'n@example.com', 'e', ?1)").bind(now - 364 * 86_400_000),
    ]);
    expect(await pruneOrganizerRequests(env.DB, now)).toBe(1);
    expect(await count()).toBe(1);
  });
});

describe("GET /api/v1/admin/organizer-requests", () => {
  const get = (path: string, session?: string) =>
    app.fetch(new Request(`${ORIGIN}${path}`, { headers: { "cf-connecting-ip": "203.0.113.9", ...(session ? { cookie: `__Host-atlas_session=${session}` } : {}) } }), baseEnv as unknown as typeof env);
  let seq = 0;
  async function user(role: "organizer" | "admin") {
    const n = ++seq;
    const session = randomToken();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, 'P', ?4, 0)").bind(`org_req${n}`, `reqsub${n}`, `req${n}@example.com`, role),
      env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), `org_req${n}`, Date.now() + 3_600_000),
    ]);
    return session;
  }

  it("is denied to anonymous visitors (401) and organizers (403)", async () => {
    expect((await get("/api/v1/admin/organizer-requests")).status).toBe(401);
    expect((await get("/api/v1/admin/organizer-requests", await user("organizer"))).status).toBe(403);
  });

  it("lists newest first with a cursor, no-store", async () => {
    await env.DB.batch([1, 2, 3].map((i) => env.DB.prepare("INSERT INTO organizer_requests (name, email, event_name, created_at) VALUES (?1, 'a@example.com', 'e', ?2)").bind(`n${i}`, 1_000 + i)));
    const session = await user("admin");
    const first = await get("/api/v1/admin/organizer-requests?limit=2", session);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const page1 = organizerRequestListResponseSchema.parse(await first.json());
    expect(page1.requests.map((r) => r.name)).toEqual(["n3", "n2"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = organizerRequestListResponseSchema.parse(await (await get(`/api/v1/admin/organizer-requests?limit=2&cursor=${page1.nextCursor}`, session)).json());
    expect(page2.requests.map((r) => r.name)).toEqual(["n1"]);
    expect(page2.nextCursor).toBeNull();
    expect((await get("/api/v1/admin/organizer-requests?limit=999", session)).status).toBe(400);
  });
});
