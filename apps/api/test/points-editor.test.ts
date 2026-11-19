import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminReviewResponseSchema,
  errorResponseSchema,
  eventPreviewResponseSchema,
  mapBundleSchema,
  panelEventResponseSchema,
  panelMapResponseSchema,
  panelPointsResponseSchema,
  savePointsResponseSchema,
} from "@atlas/contract";
import shellSource from "../../web/index.html?raw";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { clearListEventsCache } from "../src/application/list-events";
import { D1EventPointsRepository } from "../src/adapters/d1-event-points-repository";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { fakeWebp } from "./map-fixtures";

const ORIGIN = "http://atlas.test";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", "https://atlas.test").replaceAll("__BRAND_CARD_URL__", "https://atlas.test/og/b.0badcafe.jpg");
const ASSETS = { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } }) };
const baseEnv = { ...env, ASSETS, PUBLIC_ORIGIN: "https://atlas.test" };

let ip = 0;
type Init = RequestInit & { cookie?: string; json?: unknown; form?: FormData; rawBody?: string; over?: Record<string, unknown> };
const call = (path: string, init: Init = {}) => {
  const { cookie, json, form, rawBody, over, headers, ...rest } = init;
  const h: Record<string, string> = { "cf-connecting-ip": `198.51.100.${(ip++ % 250) + 1}`, origin: ORIGIN, ...(headers as Record<string, string>) };
  if (cookie) h.cookie = `__Host-atlas_session=${cookie}`;
  let body = rest.body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  if (rawBody !== undefined) {
    h["content-type"] = "application/json";
    body = rawBody;
  }
  if (form) body = form;
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers: h, body }), { ...baseEnv, ...over } as unknown as typeof env);
};

interface User {
  id: string;
  session: string;
}
let seq = 0;
async function newUser(role: "organizer" | "admin"): Promise<User> {
  const n = ++seq;
  const id = `org_pts${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0)").bind(id, `ptssub${n}`, `pts${n}@example.com`, `Person ${n}`, role),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

const valid = { name: "Points Fest", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en", description: "Come along." };
const create = async (o: User) => {
  const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: valid });
  expect(res.status).toBe(201);
  return panelEventResponseSchema.parse(await res.json()).event;
};
const blob = (b: Uint8Array) => new Blob([b as unknown as ArrayBuffer], { type: "image/webp" });
const uploadMap = async (o: User, id: string) => {
  const f = new FormData();
  f.append("full", blob(fakeWebp(2400, 1800)));
  f.append("small", blob(fakeWebp(1200, 900)));
  f.append("theme", "light");
  const res = await call(`/api/v1/panel/events/${id}/map`, { method: "POST", cookie: o.session, form: f });
  expect(res.status).toBe(200);
  return panelMapResponseSchema.parse(await res.json()).map;
};
const readyEvent = async (o: User) => {
  const ev = await create(o);
  await uploadMap(o, ev.id);
  return ev;
};

const getPoints = async (o: User, id: string) => {
  const res = await call(`/api/v1/panel/events/${id}/points`, { cookie: o.session });
  expect(res.status).toBe(200);
  return panelPointsResponseSchema.parse(await res.json());
};
const put = (o: User, id: string, json: unknown, extra: Init = {}) => call(`/api/v1/panel/events/${id}/points`, { method: "PUT", cookie: o.session, json, ...extra });
const item = (over: Record<string, unknown> = {}) => ({ category: "stage", name: "Main stage", description: "", x: 0.5, y: 0.5, ...over });
const errorOf = async (res: Response) => errorResponseSchema.parse(await res.json()).error;
/** An error body without the per-request id, to compare answers byte for byte. */
const shape = async (res: Response) => {
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), body: text.replace(/"requestId":"[^"]*"/, '"requestId":"-"') };
};
const dbPoints = async (eventId: string) =>
  (await env.DB.prepare("SELECT id, category, name, description, x, y FROM event_points WHERE event_id = ?1 ORDER BY id").bind(eventId).all()).results;
const updatedAt = async (eventId: string) => (await env.DB.prepare("SELECT updated_at AS u FROM events WHERE id = ?1").bind(eventId).first<{ u: number }>())!.u;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearEventPreviewCache();
  clearListEventsCache();
});

describe("save: create, update and delete in one atomic request", () => {
  it("returns counts and the new ids by request index, keeps the rest, and GET returns the same set", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const first = await getPoints(o, ev.id);
    expect(first.points).toEqual([]);

    const res = await put(o, ev.id, {
      baseUpdatedAt: first.eventUpdatedAt,
      points: [item({ name: "Alpha", description: "Line one\nLine two" }), item({ category: "toilets", name: null, x: 0.1, y: 0.9 }), item({ category: "food", name: "Tacos", x: 0.3 })],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const saved = savePointsResponseSchema.parse(await res.json());
    expect(saved.counts).toEqual({ created: 3, updated: 0, deleted: 0, sessionsDeleted: 0 });
    expect(saved.created.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(new Set(saved.created.map((c) => c.id)).size).toBe(3);
    expect(saved.created.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true);
    // sortPoints order: category order (stage, food, ..., toilets), then name
    expect(saved.points.map((p) => p.name)).toEqual(["Alpha", "Tacos", null]);
    expect(Date.parse(saved.eventUpdatedAt)).toBeGreaterThan(Date.parse(first.eventUpdatedAt));
    expect(await getPoints(o, ev.id)).toEqual({ points: saved.points, sessionCounts: {}, eventUpdatedAt: saved.eventUpdatedAt });

    // Second save: update one, delete one, keep one, add one
    const alpha = saved.points.find((p) => p.name === "Alpha")!;
    const tacos = saved.points.find((p) => p.name === "Tacos")!;
    const res2 = await put(o, ev.id, {
      baseUpdatedAt: saved.eventUpdatedAt,
      points: [{ ...alpha, name: "Alpha 2", x: 0.7 }, { ...tacos }, item({ category: "info", name: "" })],
    });
    expect(res2.status).toBe(200);
    const saved2 = savePointsResponseSchema.parse(await res2.json());
    expect(saved2.counts).toEqual({ created: 1, updated: 1, deleted: 1, sessionsDeleted: 0 });
    expect(saved2.created).toEqual([{ index: 2, id: expect.any(String) }]);
    expect(saved2.points.map((p) => [p.name, p.category])).toEqual([["Alpha 2", "stage"], ["Tacos", "food"], [null, "info"]]);
    expect(await dbPoints(ev.id)).toHaveLength(3);
    expect(await getPoints(o, ev.id)).toEqual({ points: saved2.points, sessionCounts: {}, eventUpdatedAt: saved2.eventUpdatedAt });
  });

  it("a no-op save writes nothing and keeps updated_at; a real change moves it strictly forward", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).json());
    const afterCreate = await updatedAt(ev.id);

    const noop = await put(o, ev.id, { baseUpdatedAt: saved.eventUpdatedAt, points: saved.points });
    expect(noop.status).toBe(200);
    const body = savePointsResponseSchema.parse(await noop.json());
    expect(body.counts).toEqual({ created: 0, updated: 0, deleted: 0, sessionsDeleted: 0 });
    expect(body.eventUpdatedAt).toBe(saved.eventUpdatedAt);
    expect(await updatedAt(ev.id)).toBe(afterCreate);

    // Same-millisecond saves still get distinct versions
    const a = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: body.eventUpdatedAt, points: [{ ...saved.points[0], x: 0.6 }] })).json());
    const b = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: a.eventUpdatedAt, points: [{ ...saved.points[0], x: 0.7 }] })).json());
    expect(Date.parse(a.eventUpdatedAt)).toBeGreaterThan(afterCreate);
    expect(Date.parse(b.eventUpdatedAt)).toBeGreaterThan(Date.parse(a.eventUpdatedAt));
  });

  it("a stale baseUpdatedAt is 409 event_changed and nothing is written; two saves at once: exactly one wins", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).status).toBe(200);
    const before = await dbPoints(ev.id);

    const stale = await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "Other" }), item({ name: "More" })] });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe("event_changed");
    expect(await dbPoints(ev.id)).toEqual(before);

    const fresh = await getPoints(o, ev.id);
    const [r1, r2] = await Promise.all([
      put(o, ev.id, { baseUpdatedAt: fresh.eventUpdatedAt, points: [...fresh.points, item({ name: "One" })] }),
      put(o, ev.id, { baseUpdatedAt: fresh.eventUpdatedAt, points: [...fresh.points, item({ name: "Two" })] }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await dbPoints(ev.id)).toHaveLength(2);
  });

  it("a profile edit of the event (a new version) also makes an old editor session stale", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    expect((await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, city: "Cork" } })).status).toBe(200);
    expect((await errorOf(await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] }))).code).toBe("event_changed");
    expect(await dbPoints(ev.id)).toEqual([]);
  });

  it("a bad item rejects the whole save with an indexed path, writes nothing and never echoes the value", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "Keep" })] })).json());
    const before = await dbPoints(ev.id);

    const res = await put(o, ev.id, {
      baseUpdatedAt: saved.eventUpdatedAt,
      points: [item({ name: "Fine" }), item({ name: "Fine 2" }), item({ name: "Fine 3" }), item({ name: "S".repeat(81) })],
    });
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe("validation_error");
    expect(err.fields).toEqual([{ path: "points.3.name", code: "too_long" }]);
    expect(JSON.stringify(err)).not.toContain("SSSS");
    expect(await dbPoints(ev.id)).toEqual(before);
    expect(await updatedAt(ev.id)).toBe(Date.parse(saved.eventUpdatedAt));
  });

  it("the repository rolls the whole batch back when the database refuses a row (deletes and updates included)", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(
      await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "A" }), item({ name: "B" })] })).json(),
    );
    const before = await dbPoints(ev.id);
    const base = await updatedAt(ev.id);
    const [a, b] = saved.points as [(typeof saved.points)[number], (typeof saved.points)[number]];
    const repo = new D1EventPointsRepository(env.DB);
    // Delete A, update B, then insert a Name-it Point with no name: the CHECK on the table refuses it.
    await expect(
      repo.save({
        eventId: ev.id,
        ownerId: o.id,
        base,
        now: base + 5,
        currentCount: 2,
        diff: {
          toDelete: [a.id],
          toUpdate: [{ ...b, x: 0.99 }],
          toCreate: [{ index: 0, point: { id: "bad-row", name: null, category: "stage", description: "", x: 0.1, y: 0.1 } }],
          finalCount: 2,
        },
      }),
    ).rejects.toThrow();
    expect(await dbPoints(ev.id)).toEqual(before);
    expect(await updatedAt(ev.id)).toBe(base);
  });

  it("the guard is in every statement: another organizer's id or a wrong version changes nothing", async () => {
    const o = await newUser("organizer");
    const other = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "A" })] })).json());
    const before = await dbPoints(ev.id);
    const base = await updatedAt(ev.id);
    const repo = new D1EventPointsRepository(env.DB);
    const diff = { toDelete: [saved.points[0]!.id], toUpdate: [], toCreate: [{ index: 0, point: { id: "x1", name: "N", category: "food" as const, description: "", x: 0.2, y: 0.2 } }], finalCount: 1 };
    expect(await repo.save({ eventId: ev.id, ownerId: other.id, base, now: base + 1, currentCount: 1, diff })).toEqual({ ok: false, reason: "not_found" });
    expect(await repo.save({ eventId: ev.id, ownerId: o.id, base: base - 1, now: base + 1, currentCount: 1, diff })).toEqual({ ok: false, reason: "event_changed" });
    expect(await dbPoints(ev.id)).toEqual(before);
  });
});

describe("access control: every refusal looks like a missing event", () => {
  it("another organizer, a demo event and a bad id get the same 404 on GET and PUT; no Admin bypass", async () => {
    const o = await newUser("organizer");
    const intruder = await newUser("organizer");
    const admin = await newUser("admin");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).json());
    const demo = (await env.DB.prepare("SELECT id FROM events WHERE owner_id IS NULL LIMIT 1").first<{ id: string }>())!.id;

    const missing = await shape(await call(`/api/v1/panel/events/${"z".repeat(30)}/points`, { cookie: intruder.session }));
    expect(missing.status).toBe(404);
    for (const [who, id] of [[intruder, ev.id], [admin, ev.id], [intruder, demo], [intruder, "BAD ID!"], [intruder, "a".repeat(65)]] as const) {
      expect(await shape(await call(`/api/v1/panel/events/${id}/points`, { cookie: who.session }))).toEqual(missing);
      expect(await shape(await put(who, id, { baseUpdatedAt: saved.eventUpdatedAt, points: [] }))).toEqual(missing);
    }
    expect(await dbPoints(ev.id)).toHaveLength(1);
    expect((await call(`/api/v1/panel/events/${ev.id}/points`)).status).toBe(401);
  });

  it("a point id of another event (own or someone else's) or of nothing is the same 404 and writes nothing", async () => {
    const a = await newUser("organizer");
    const b = await newUser("organizer");
    const evA = await readyEvent(a);
    const evA2 = await readyEvent(a);
    const evB = await readyEvent(b);
    const mk = async (o: User, ev: { id: string }, name: string) => {
      const s = await getPoints(o, ev.id);
      return savePointsResponseSchema.parse(await (await put(o, ev.id, { baseUpdatedAt: s.eventUpdatedAt, points: [item({ name })] })).json());
    };
    const sA = await mk(a, evA, "Mine");
    const sA2 = await mk(a, evA2, "Mine too");
    const sB = await mk(b, evB, "Theirs");
    const missing = await shape(await call(`/api/v1/panel/events/${"z".repeat(30)}/points`, { cookie: a.session }));
    const before = await dbPoints(evA.id);
    const beforeB = await dbPoints(evB.id);

    for (const foreign of [sB.points[0]!.id, sA2.points[0]!.id, "no-such-point"]) {
      const res = await put(a, evA.id, { baseUpdatedAt: sA.eventUpdatedAt, points: [{ ...sA.points[0] }, { ...item(), id: foreign }] });
      expect(await shape(res)).toEqual(missing);
    }
    expect(await dbPoints(evA.id)).toEqual(before);
    expect(await dbPoints(evB.id)).toEqual(beforeB);
    expect(await updatedAt(evA.id)).toBe(Date.parse(sA.eventUpdatedAt));
  });

  it("an event without a map is 409 map_required on GET and PUT, and the other panel limits still apply", async () => {
    const o = await newUser("organizer");
    const ev = await create(o);
    expect((await errorOf(await call(`/api/v1/panel/events/${ev.id}/points`, { cookie: o.session }))).code).toBe("map_required");
    expect((await errorOf(await put(o, ev.id, { baseUpdatedAt: ev.updatedAt, points: [] }))).code).toBe("map_required");
    // Cross-site and non-JSON requests are refused before anything else
    const ready = await readyEvent(o);
    expect((await put(o, ready.id, { baseUpdatedAt: ready.updatedAt, points: [] }, { headers: { origin: "http://evil.test" } })).status).toBe(403);
    expect((await call(`/api/v1/panel/events/${ready.id}/points`, { method: "PUT", cookie: o.session, body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
  });

  it("PUT counts against the per-organizer write limiter; GET does not", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const limited = { PANEL_WRITE_LIMITER: { limit: async () => ({ success: false }) } };
    const start = await getPoints(o, ev.id);
    const res = await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] }, { over: limited });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect((await call(`/api/v1/panel/events/${ev.id}/points`, { cookie: o.session, over: limited })).status).toBe(200);
    expect(await dbPoints(ev.id)).toEqual([]);
  });
});

describe("nullable names over the API", () => {
  it("Just-drop: null, absent and blank are stored as NULL; Name-it without a name is a 400 at its index", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const res = await put(o, ev.id, {
      baseUpdatedAt: start.eventUpdatedAt,
      points: [
        item({ category: "toilets", name: null }),
        { category: "first-aid", description: "", x: 0.2, y: 0.2 },
        item({ category: "info", name: "   " }),
        item({ category: "entrance-exit", name: " Gate A " }),
      ],
    });
    expect(res.status).toBe(200);
    const saved = savePointsResponseSchema.parse(await res.json());
    expect(saved.points.map((p) => p.name).sort((x, y) => String(x).localeCompare(String(y)))).toEqual(["Gate A", null, null, null]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM event_points WHERE event_id = ?1 AND name IS NULL").bind(ev.id).first<{ n: number }>())!.n).toBe(3);

    const bad = await put(o, ev.id, { baseUpdatedAt: saved.eventUpdatedAt, points: [item(), item({ category: "stage", name: null }), item({ category: "food", name: "  " })] });
    expect((await errorOf(bad)).fields).toEqual([
      { path: "points.1.name", code: "required" },
      { path: "points.2.name", code: "too_short" },
    ]);
  });

  it("the database refuses a NULL name on a Name-it category even if the API were bypassed", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    await expect(
      env.DB.prepare("INSERT INTO event_points (event_id, id, category, name, description, x, y, created_at, updated_at) VALUES (?1, 'p', 'stage', NULL, '', 0.5, 0.5, 0, 0)").bind(ev.id).run(),
    ).rejects.toThrow();
  });
});

describe("limits", () => {
  it("500 items are accepted and 501 are refused", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => item({ name: `Point ${i}`, x: (i % 100) / 100, y: Math.floor(i / 100) / 10 }));
    const over = await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: mk(501) });
    expect(over.status).toBe(400);
    expect((await errorOf(over)).fields).toEqual([{ path: "points", code: "too_long" }]);
    expect(await dbPoints(ev.id)).toEqual([]);

    const ok = await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: mk(500) });
    expect(ok.status).toBe(200);
    expect(savePointsResponseSchema.parse(await ok.json()).counts.created).toBe(500);
    expect(await dbPoints(ev.id)).toHaveLength(500);
  });

  it("a big save is split into several statements of a bounded size and stays far below 50 queries", async () => {
    const o = await newUser("organizer");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    // About 200 worst-case-ish items (long text, non-ASCII): well over one 60 KB statement, under the 512 KB body limit.
    const points = Array.from({ length: 200 }, (_, i) => item({ name: `Étage ${i} ${"é".repeat(60)}`, description: "ü".repeat(500), x: i / 200 }));
    const statements: string[] = [];
    const sizes: number[] = [];
    const spyDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            statements.push(sql);
            const stmt = target.prepare(sql);
            return new Proxy(stmt, {
              get(s, p) {
                if (p === "bind")
                  return (...args: unknown[]) => {
                    for (const a of args) if (typeof a === "string" && a.startsWith("[")) sizes.push(new TextEncoder().encode(a).length);
                    return s.bind(...args);
                  };
                const v = (s as unknown as Record<string | symbol, unknown>)[p];
                return typeof v === "function" ? v.bind(s) : v;
              },
            });
          };
        }
        const v = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const res = await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points }, { over: { DB: spyDb } });
    expect(res.status).toBe(200);
    expect(await dbPoints(ev.id)).toHaveLength(200);
    expect(statements.length).toBeLessThan(50);
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(60_000);
  });

});

describe("publish needs a Point", () => {
  const request = (o: User, id: string) => call(`/api/v1/panel/events/${id}/publish-request`, { method: "POST", cookie: o.session, json: {} });

  it("0 Points is 409 points_required (after the map check); 1 Point passes", async () => {
    const o = await newUser("organizer");
    const noMap = await create(o);
    expect((await errorOf(await request(o, noMap.id))).code).toBe("map_required");

    const ev = await readyEvent(o);
    const refused = await request(o, ev.id);
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("points_required");
    expect(panelEventResponseSchema.parse(await (await call(`/api/v1/panel/events/${ev.id}`, { cookie: o.session })).json()).event.status).toBe("draft");

    const start = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).status).toBe(200);
    const ok = await request(o, ev.id);
    expect(ok.status).toBe(200);
    expect(panelEventResponseSchema.parse(await ok.json()).event.status).toBe("in_review");
  });

  it("someone else's event is still the plain 404, and a published event is not affected by an empty save", async () => {
    const o = await newUser("organizer");
    const other = await newUser("organizer");
    const admin = await newUser("admin");
    const ev = await readyEvent(o);
    expect((await errorOf(await request(other, ev.id))).code).toBe("event_not_found");

    const start = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).status).toBe(200);
    expect((await request(o, ev.id)).status).toBe(200);
    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: admin.session })).json());
    expect(rv.points).toHaveLength(1);
    expect((await call(`/api/v1/admin/events/${ev.id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: rv.review.updatedAt } })).status).toBe(200);

    // The empty save is allowed on a published event, and the event stays published; going back needs a Point again
    const now = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: now.eventUpdatedAt, points: [] })).status).toBe(200);
    expect(panelEventResponseSchema.parse(await (await call(`/api/v1/panel/events/${ev.id}`, { cookie: o.session })).json()).event.status).toBe("published");
    expect((await call(`/api/v1/panel/events/${ev.id}/unpublish`, { method: "POST", cookie: o.session, json: {} })).status).toBe(200);
    expect((await errorOf(await request(o, ev.id))).code).toBe("points_required");
  });
});

describe("Admin approve needs a Point", () => {
  it("an organizer who deletes every Point while In review makes the approve 409 points_required", async () => {
    const o = await newUser("organizer");
    const admin = await newUser("admin");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item()] })).status).toBe(200);
    expect((await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, json: {} })).status).toBe(200);

    const inReview = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: inReview.eventUpdatedAt, points: [] })).status).toBe(200);

    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: admin.session })).json());
    expect(rv.points).toHaveLength(0);
    const res = await call(`/api/v1/admin/events/${ev.id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: rv.review.updatedAt } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("points_required");
  });
});

describe("where Points show up", () => {
  it("the public bundle shows saved Points only while published, with null names, and its ETag changes on a save", async () => {
    const o = await newUser("organizer");
    const admin = await newUser("admin");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    const saved = savePointsResponseSchema.parse(
      await (await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "Main" }), item({ category: "toilets", name: null, x: 0.2 })] })).json(),
    );
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(404); // draft: invisible

    expect((await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, json: {} })).status).toBe(200);
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(404); // in review: still invisible
    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: admin.session })).json());
    expect((await call(`/api/v1/admin/events/${ev.id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: rv.review.updatedAt } })).status).toBe(200);
    clearEventPreviewCache();
    clearListEventsCache();

    const res = await call(`/api/v1/events/${ev.slug}/map-bundle`);
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    const bundle = mapBundleSchema.parse(await res.json());
    expect(bundle.points.map((p) => [p.name, p.category])).toEqual([["Main", "stage"], [null, "toilets"]]);
    expect(bundle.points.map((p) => p.id).sort()).toEqual(saved.points.map((p) => p.id).sort());

    // A save on a published event goes live without review and changes the ETag
    const now = await getPoints(o, ev.id);
    expect((await put(o, ev.id, { baseUpdatedAt: now.eventUpdatedAt, points: [{ ...now.points[0] }, { ...now.points[1], name: "Renamed" }] })).status).toBe(200);
    const after = await call(`/api/v1/events/${ev.slug}/map-bundle`);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect(mapBundleSchema.parse(await after.json()).points.map((p) => p.name)).toEqual(["Main", "Renamed"]);
    // Unpublished again: gone
    expect((await call(`/api/v1/panel/events/${ev.id}/unpublish`, { method: "POST", cookie: o.session, json: {} })).status).toBe(200);
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(404);
  });

  it("the owner preview and the Admin review include the Points; deleting the event removes its rows", async () => {
    const o = await newUser("organizer");
    const admin = await newUser("admin");
    const ev = await readyEvent(o);
    const start = await getPoints(o, ev.id);
    await put(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: [item({ name: "Main" }), item({ category: "info", name: null })] });

    const preview = eventPreviewResponseSchema.parse(await (await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session })).json());
    expect(preview.points.map((p) => p.name)).toEqual(["Main", null]);
    expect(preview.sessions).toEqual([]);
    // The Admin sees an event once it is In review
    expect((await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, json: {} })).status).toBe(200);
    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: admin.session })).json());
    expect(rv.points.map((p) => p.name)).toEqual(["Main", null]);

    expect((await call(`/api/v1/panel/events/${ev.id}`, { method: "DELETE", cookie: o.session })).status).toBe(204);
    expect(await dbPoints(ev.id)).toEqual([]);
  });
});
