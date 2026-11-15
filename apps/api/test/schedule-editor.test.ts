import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminReviewResponseSchema,
  errorResponseSchema,
  eventPreviewResponseSchema,
  formatUtcInstant,
  localToUtc,
  mapBundleSchema,
  panelEventResponseSchema,
  panelMapResponseSchema,
  panelPointsResponseSchema,
  panelSessionsResponseSchema,
  savePointsResponseSchema,
  saveSessionsResponseSchema,
} from "@atlas/contract";
import shellSource from "../../web/index.html?raw";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { clearListEventsCache } from "../src/application/list-events";
import { D1EventSessionsRepository } from "../src/adapters/d1-event-sessions-repository";
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
  const id = `org_ses${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0)").bind(id, `sessub${n}`, `ses${n}@example.com`, `Person ${n}`, role),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

// Dublin in July is UTC+1: 06:00 local is 05:00Z. Dates 2026-07-10..12, dayStart 06:00 (the default of organizer events).
const valid = { name: "Schedule Fest", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en", description: "Come along." };
const loc = (date: string, time: string) => formatUtcInstant(localToUtc(date, time, "Europe/Dublin"));
/** A session draft from local times. */
const sess = (pointId: string, date: string, from: string, to: string, over: Record<string, unknown> = {}) => ({
  pointId,
  title: "Band",
  start: loc(date, from),
  end: loc(date, to),
  ...over,
});

const create = async (o: User, over: Record<string, unknown> = {}) => {
  const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, ...over } });
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
const getPoints = async (o: User, id: string) => {
  const res = await call(`/api/v1/panel/events/${id}/points`, { cookie: o.session });
  expect(res.status).toBe(200);
  return panelPointsResponseSchema.parse(await res.json());
};
const putPoints = (o: User, id: string, json: unknown) => call(`/api/v1/panel/events/${id}/points`, { method: "PUT", cookie: o.session, json });
const pt = (over: Record<string, unknown> = {}) => ({ category: "stage", name: "Main stage", description: "", x: 0.5, y: 0.5, ...over });

/** An event with a map and one point per kind: stage, second stage, landmark, toilets. */
interface Fixture {
  o: User;
  ev: { id: string; slug: string };
  stage: string;
  stage2: string;
  landmark: string;
  toilets: string;
}
const fixture = async (o?: User): Promise<Fixture> => {
  const owner = o ?? (await newUser("organizer"));
  const ev = await create(owner);
  await uploadMap(owner, ev.id);
  const start = await getPoints(owner, ev.id);
  const saved = savePointsResponseSchema.parse(
    await (
      await putPoints(owner, ev.id, {
        baseUpdatedAt: start.eventUpdatedAt,
        points: [pt({ name: "Main" }), pt({ name: "Second", x: 0.2 }), pt({ category: "landmark", name: "Church", x: 0.8 }), pt({ category: "toilets", name: null, x: 0.1 })],
      })
    ).json(),
  );
  const idOf = (n: string | null) => saved.points.find((p) => p.name === n)!.id;
  return { o: owner, ev, stage: idOf("Main"), stage2: idOf("Second"), landmark: idOf("Church"), toilets: idOf(null) };
};

const getSessions = async (o: User, id: string) => {
  const res = await call(`/api/v1/panel/events/${id}/sessions`, { cookie: o.session });
  expect(res.status).toBe(200);
  return panelSessionsResponseSchema.parse(await res.json());
};
const putSessions = (o: User, id: string, json: unknown, extra: Init = {}) => call(`/api/v1/panel/events/${id}/sessions`, { method: "PUT", cookie: o.session, json, ...extra });
/** Saves a set on top of the current version and returns the parsed 200 response. */
const saveSet = async (o: User, id: string, sessions: unknown[]) => {
  const cur = await getSessions(o, id);
  const res = await putSessions(o, id, { baseUpdatedAt: cur.eventUpdatedAt, sessions });
  expect(res.status, await res.clone().text()).toBe(200);
  return saveSessionsResponseSchema.parse(await res.json());
};
const errorOf = async (res: Response) => errorResponseSchema.parse(await res.json()).error;
const shape = async (res: Response) => {
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), body: text.replace(/"requestId":"[^"]*"/, '"requestId":"-"') };
};
const dbSessions = async (eventId: string) =>
  (await env.DB.prepare("SELECT id, point_id, title, description, start_utc, end_utc FROM event_point_sessions WHERE event_id = ?1 ORDER BY id").bind(eventId).all()).results;
const updatedAt = async (eventId: string) => (await env.DB.prepare("SELECT updated_at AS u FROM events WHERE id = ?1").bind(eventId).first<{ u: number }>())!.u;
const fieldsOf = async (res: Response) => (await errorOf(res)).fields;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearEventPreviewCache();
  clearListEventsCache();
});

describe("save and read the whole set", () => {
  it("creates, updates and deletes in one request; GET returns the same set sorted; text is normalized", async () => {
    const f = await fixture();
    const empty = await getSessions(f.o, f.ev.id);
    expect(empty.sessions).toEqual([]);
    expect(empty.points.map((p) => p.id).sort()).toEqual([f.stage, f.stage2, f.landmark].sort()); // no toilets
    expect(empty.dayStart).toBe("06:00");
    expect(empty.window).toEqual({ from: loc("2026-07-10", "06:00"), until: loc("2026-07-13", "06:00") });

    const res = await putSessions(f.o, f.ev.id, {
      baseUpdatedAt: empty.eventUpdatedAt,
      sessions: [
        sess(f.stage, "2026-07-10", "21:00", "22:00", { title: "  Band B  ", description: "   " }),
        sess(f.stage, "2026-07-10", "20:00", "21:00", { title: "Café", description: "Line one\r\nLine two  " }),
        sess(f.landmark, "2026-07-11", "10:00", "10:30", { title: "Tour" }),
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const saved = saveSessionsResponseSchema.parse(await res.json());
    expect(saved.counts).toEqual({ created: 3, updated: 0, deleted: 0 });
    expect(saved.created.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(saved.created.every((c) => /^[0-9a-f-]{36}$/.test(c.id))).toBe(true);
    expect(saved.sessions.map((s) => s.title)).toEqual(["Café", "Band B", "Tour"]); // NFC, trimmed, sorted by start
    expect(saved.sessions[0]!.description).toBe("Line one\nLine two");
    expect(saved.sessions[1]!.description).toBeUndefined(); // blank -> absent
    expect(Date.parse(saved.eventUpdatedAt)).toBeGreaterThan(Date.parse(empty.eventUpdatedAt));
    expect(await getSessions(f.o, f.ev.id)).toEqual({ ...empty, sessions: saved.sessions, eventUpdatedAt: saved.eventUpdatedAt });
    expect((await dbSessions(f.ev.id)).find((r) => r.title === "Band B")!.description).toBeNull();

    // Second save: change one, delete one, keep one, add one; moving a session to another point is allowed
    const [cafe, band, tour] = saved.sessions as [(typeof saved.sessions)[number], (typeof saved.sessions)[number], (typeof saved.sessions)[number]];
    const res2 = await putSessions(f.o, f.ev.id, {
      baseUpdatedAt: saved.eventUpdatedAt,
      sessions: [{ ...cafe, pointId: f.stage2, title: "Cafe 2" }, { ...tour }, sess(f.landmark, "2026-07-12", "10:00", "11:00", { title: "New" })],
    });
    expect(res2.status).toBe(200);
    const saved2 = saveSessionsResponseSchema.parse(await res2.json());
    expect(saved2.counts).toEqual({ created: 1, updated: 1, deleted: 1 });
    expect(saved2.created).toEqual([{ index: 2, id: expect.any(String) }]);
    expect(saved2.sessions.map((s) => [s.title, s.pointId === f.stage2])).toEqual([["Cafe 2", true], ["Tour", false], ["New", false]]);
    expect((await dbSessions(f.ev.id)).map((r) => r.id)).not.toContain(band.id);
    expect(await getSessions(f.o, f.ev.id)).toEqual({ ...empty, sessions: saved2.sessions, eventUpdatedAt: saved2.eventUpdatedAt });
  });

  it("a no-op save writes nothing and keeps updated_at; a real change moves it strictly forward", async () => {
    const f = await fixture();
    const saved = await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00")]);
    const afterCreate = await updatedAt(f.ev.id);
    const rowBefore = await dbSessions(f.ev.id);
    const noop = await putSessions(f.o, f.ev.id, { baseUpdatedAt: saved.eventUpdatedAt, sessions: saved.sessions });
    expect(noop.status).toBe(200);
    const body = saveSessionsResponseSchema.parse(await noop.json());
    expect(body.counts).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(body.eventUpdatedAt).toBe(saved.eventUpdatedAt);
    expect(await updatedAt(f.ev.id)).toBe(afterCreate);
    expect(await dbSessions(f.ev.id)).toEqual(rowBefore);

    const a = saveSessionsResponseSchema.parse(await (await putSessions(f.o, f.ev.id, { baseUpdatedAt: body.eventUpdatedAt, sessions: [{ ...saved.sessions[0], title: "A" }] })).json());
    const b = saveSessionsResponseSchema.parse(await (await putSessions(f.o, f.ev.id, { baseUpdatedAt: a.eventUpdatedAt, sessions: [{ ...saved.sessions[0], title: "B" }] })).json());
    expect(Date.parse(a.eventUpdatedAt)).toBeGreaterThan(afterCreate);
    expect(Date.parse(b.eventUpdatedAt)).toBeGreaterThan(Date.parse(a.eventUpdatedAt));
  });

  it("an empty set deletes everything and is valid (partial progress)", async () => {
    const f = await fixture();
    await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00")]);
    const cleared = await saveSet(f.o, f.ev.id, []);
    expect(cleared.counts).toEqual({ created: 0, updated: 0, deleted: 1 });
    expect(await dbSessions(f.ev.id)).toEqual([]);
  });
});

describe("the time window (shared sessionWindow)", () => {
  it("first day: 05:59 is refused, 06:00 accepted; last night: 01:30 and 05:59 accepted, 06:00 refused", async () => {
    const f = await fixture();
    const tries: Array<[string, string, string, boolean]> = [
      ["2026-07-10", "05:59", "07:00", false],
      ["2026-07-10", "06:00", "07:00", true],
      ["2026-07-13", "01:30", "02:30", true], // the day after endDate, still the last night
      ["2026-07-13", "05:59", "07:00", true], // end may run past the window
      ["2026-07-13", "06:00", "07:00", false],
      ["2026-07-09", "23:30", "23:45", false],
    ];
    for (const [d, a, b, ok] of tries) {
      const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
      const res = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [sess(f.stage, d, a, b)] });
      expect(res.status === 200, `${d} ${a}`).toBe(ok);
      if (!ok) expect(await fieldsOf(res)).toEqual([{ path: "sessions.0.start", code: "outside_dates" }]);
      if (ok) await saveSet(f.o, f.ev.id, []); // back to the base state
    }
  });

  it("a pre-existing session outside the window fails the save with outside_dates until fixed or deleted", async () => {
    const f = await fixture();
    const saved = await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-12", "20:00", "21:00")]);
    // Bypass the event-edit guard (as legacy or a race would): shorten the event directly.
    await env.DB.prepare("UPDATE events SET end_date = '2026-07-11', updated_at = updated_at + 1 WHERE id = ?1").bind(f.ev.id).run();
    const cur = await getSessions(f.o, f.ev.id);
    const stuck = await putSessions(f.o, f.ev.id, { baseUpdatedAt: cur.eventUpdatedAt, sessions: saved.sessions });
    expect(stuck.status).toBe(400);
    expect(await fieldsOf(stuck)).toEqual([{ path: "sessions.0.start", code: "outside_dates" }]);
    const fixed = await putSessions(f.o, f.ev.id, { baseUpdatedAt: cur.eventUpdatedAt, sessions: [] });
    expect(fixed.status).toBe(200);
  });
});

describe("overlap, caps and per-item rules", () => {
  it("overlap on the same point is refused on the later item; touching and other points are fine", async () => {
    const f = await fixture();
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    const touching = [sess(f.stage, "2026-07-10", "20:00", "21:00"), sess(f.stage, "2026-07-10", "21:00", "22:00"), sess(f.stage2, "2026-07-10", "20:30", "21:30")];
    const ok = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: touching });
    expect(ok.status).toBe(200);
    const saved = saveSessionsResponseSchema.parse(await ok.json());

    // 20:30-21:30 overlaps both neighbours; listed first, but the later start is the one flagged
    const res = await putSessions(f.o, f.ev.id, {
      baseUpdatedAt: saved.eventUpdatedAt,
      sessions: [sess(f.stage, "2026-07-10", "20:30", "21:30", { title: "Clash" }), sess(f.stage, "2026-07-10", "20:00", "21:00")],
    });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toEqual([{ path: "sessions.0.start", code: "overlap" }]);
    // A whole-set check: an existing session moved onto another one overlaps too
    const move = await putSessions(f.o, f.ev.id, {
      baseUpdatedAt: saved.eventUpdatedAt,
      sessions: [saved.sessions[0], { ...saved.sessions[1], pointId: f.stage }, saved.sessions[2]].map((s, i) => (i === 1 ? { ...s, start: loc("2026-07-10", "20:59"), end: loc("2026-07-10", "21:30") } : s)),
    });
    expect(move.status).toBe(400);
    expect((await fieldsOf(move))!.some((e) => e.code === "overlap")).toBe(true);
    expect(await dbSessions(f.ev.id)).toHaveLength(3);
  });

  it("at most 150 per point and 1000 per event, counted on the resulting set", async () => {
    const f = await fixture();
    const slot = (point: string, i: number) => {
      // 20-minute slots from the first possible start
      const from = localToUtc("2026-07-10", "06:00", "Europe/Dublin") + i * 20 * 60_000;
      return { pointId: point, title: `S${i}`, start: formatUtcInstant(from), end: formatUtcInstant(from + 20 * 60_000) };
    };
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    const many = (point: string, n: number) => Array.from({ length: n }, (_, i) => slot(point, i));
    const over = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: many(f.stage, 151) });
    expect(over.status).toBe(400);
    expect(await fieldsOf(over)).toEqual([{ path: "sessions.150.pointId", code: "too_long" }]);
    expect(await dbSessions(f.ev.id)).toEqual([]);
    const ok = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: many(f.stage, 150) });
    expect(ok.status).toBe(200);

    const tooMany = await putSessions(f.o, f.ev.id, { baseUpdatedAt: (await getSessions(f.o, f.ev.id)).eventUpdatedAt, sessions: Array.from({ length: 1001 }, (_, i) => slot(f.stage, i)) });
    expect(tooMany.status).toBe(400);
    expect(await fieldsOf(tooMany)).toEqual([{ path: "sessions", code: "too_long" }]);
  });

  it("a bad item rejects the whole save with an indexed path, writes nothing and never echoes values", async () => {
    const f = await fixture();
    const saved = await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00", { title: "Keep" })]);
    const before = await dbSessions(f.ev.id);
    const day = "2026-07-11";
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [sess(f.stage, day, "10:00", "11:00", { title: "S".repeat(121) }), "sessions.1.title", "too_long"],
      [sess(f.stage, day, "10:00", "11:00", { title: "  " }), "sessions.1.title", "too_short"],
      [sess(f.stage, day, "10:00", "11:00", { title: "a\nb" }), "sessions.1.title", "control_chars"],
      [sess(f.stage, day, "10:00", "11:00", { title: "a‮b" }), "sessions.1.title", "control_chars"],
      [sess(f.stage, day, "10:00", "11:00", { description: "d".repeat(301) }), "sessions.1.description", "too_long"],
      [sess(f.stage, day, "10:00", "11:00", { description: "a\u0000b" }), "sessions.1.description", "control_chars"],
      [{ ...sess(f.stage, day, "10:00", "11:00"), end: loc(day, "10:00") }, "sessions.1.end", "invalid"],
      [{ ...sess(f.stage, day, "10:00", "11:00"), end: loc("2026-07-12", "10:01") }, "sessions.1.end", "too_long"],
      [{ ...sess(f.stage, day, "10:00", "11:00"), start: "2026-07-11 10:00" }, "sessions.1.start", "invalid"],
      [{ ...sess(f.stage, day, "10:00", "11:00"), start: "2026-02-30T10:00:00Z" }, "sessions.1.start", "invalid"],
      [{ ...sess(f.stage, day, "10:00", "11:00"), extra: 1 }, "sessions.1", "unknown_field"],
    ];
    for (const [bad, path, code] of cases) {
      const res = await putSessions(f.o, f.ev.id, { baseUpdatedAt: saved.eventUpdatedAt, sessions: [saved.sessions[0], bad] });
      expect(res.status, path + code).toBe(400);
      const err = await errorOf(res);
      expect(err.fields![0]!.code, JSON.stringify(err.fields)).toBe(code);
      if (code !== "unknown_field") expect(err.fields![0]!.path).toBe(path);
      expect(JSON.stringify(err)).not.toMatch(/SSSS|dddd/);
    }
    // 24 h exactly is fine, 24 h + 1 s is too long (checked above)
    expect(await dbSessions(f.ev.id)).toEqual(before);
    expect(await updatedAt(f.ev.id)).toBe(Date.parse(saved.eventUpdatedAt));
    // Duplicate ids and a missing base version
    const dup = await putSessions(f.o, f.ev.id, { baseUpdatedAt: saved.eventUpdatedAt, sessions: [saved.sessions[0], saved.sessions[0]] });
    expect(await fieldsOf(dup)).toEqual([{ path: "sessions", code: "invalid" }]);
    const noBase = await putSessions(f.o, f.ev.id, { sessions: [] });
    expect(await fieldsOf(noBase)).toEqual([{ path: "baseUpdatedAt", code: "invalid" }]);
  });
});

describe("points and categories", () => {
  it("a Point that is not stage or landmark is 400 at pointId; nothing is written", async () => {
    const f = await fixture();
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    const res = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [sess(f.stage, "2026-07-10", "20:00", "21:00"), sess(f.toilets, "2026-07-10", "20:00", "21:00")] });
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toEqual([{ path: "sessions.1.pointId", code: "invalid" }]);
    expect(await dbSessions(f.ev.id)).toEqual([]);
  });

  it("another event's point (own or someone else's), a seeded point, an unknown point and a foreign session id are the same 404", async () => {
    const a = await fixture();
    const a2 = await fixture(a.o);
    const b = await fixture();
    const sB = await saveSet(b.o, b.ev.id, [sess(b.stage, "2026-07-10", "20:00", "21:00")]);
    const sA2 = await saveSet(a2.o, a2.ev.id, [sess(a2.stage, "2026-07-10", "20:00", "21:00")]);
    const missing = await shape(await call(`/api/v1/panel/events/${"z".repeat(30)}/sessions`, { cookie: a.o.session }));
    expect(missing.status).toBe(404);
    const base = (await getSessions(a.o, a.ev.id)).eventUpdatedAt;
    const beforeA = await dbSessions(a.ev.id);
    const beforeB = await dbSessions(b.ev.id);

    for (const pointId of [b.stage, a2.stage, "tiny-fest-stage", "no-such-point"]) {
      const res = await putSessions(a.o, a.ev.id, { baseUpdatedAt: base, sessions: [sess(pointId, "2026-07-10", "20:00", "21:00")] });
      expect(await shape(res)).toEqual(missing);
    }
    // An id of another event's session, even as a "keep"
    for (const sid of [sB.sessions[0]!.id, sA2.sessions[0]!.id, "no-such-session"]) {
      const res = await putSessions(a.o, a.ev.id, { baseUpdatedAt: base, sessions: [{ ...sess(a.stage, "2026-07-10", "20:00", "21:00"), id: sid }] });
      expect(await shape(res)).toEqual(missing);
    }
    expect(await dbSessions(a.ev.id)).toEqual(beforeA);
    expect(await dbSessions(b.ev.id)).toEqual(beforeB);
    expect(await updatedAt(a.ev.id)).toBe(Date.parse(base));
  });

  it("the database refuses a cross-event point_id, a non-stage point and a recategorization with sessions", async () => {
    const a = await fixture();
    const b = await fixture();
    const ins = (event: string, point: string, id = crypto.randomUUID()) =>
      env.DB.prepare(
        "INSERT INTO event_point_sessions (id, event_id, point_id, title, start_utc, end_utc, created_at, updated_at) VALUES (?1, ?2, ?3, 't', '2026-07-10T20:00:00Z', '2026-07-10T21:00:00Z', 0, 0)",
      )
        .bind(id, event, point)
        .run();
    await expect(ins(a.ev.id, b.stage)).rejects.toThrow(/FOREIGN KEY/i); // composite FK
    await expect(ins(a.ev.id, a.toilets)).rejects.toThrow(/stage or landmark/); // trigger backstop
    await ins(a.ev.id, a.stage, "ok-row");
    await expect(env.DB.prepare("UPDATE event_points SET category = 'food' WHERE event_id = ?1 AND id = ?2").bind(a.ev.id, a.stage).run()).rejects.toThrow(/point has sessions/);
    await expect(env.DB.prepare("UPDATE event_point_sessions SET point_id = ?2 WHERE id = 'ok-row'").bind(a.ev.id, a.toilets).run()).rejects.toThrow();
    // stage <-> landmark is allowed
    await env.DB.prepare("UPDATE event_points SET category = 'landmark' WHERE event_id = ?1 AND id = ?2").bind(a.ev.id, a.stage).run();
    // Time columns: 25 h is refused by the CHECK (unixepoch works locally), end <= start too, and a malformed instant
    const bad = (s: string, e: string) =>
      env.DB.prepare("INSERT INTO event_point_sessions (id, event_id, point_id, title, start_utc, end_utc, created_at, updated_at) VALUES (?1, ?2, ?3, 't', ?4, ?5, 0, 0)")
        .bind(crypto.randomUUID(), a.ev.id, a.stage, s, e)
        .run();
    await expect(bad("2026-07-10T20:00:00Z", "2026-07-11T21:00:00Z")).rejects.toThrow(/CHECK/i);
    await expect(bad("2026-07-10T20:00:00Z", "2026-07-10T20:00:00Z")).rejects.toThrow(/CHECK/i);
    await expect(bad("2026-07-10 20:00:00Z", "2026-07-10T21:00:00Z")).rejects.toThrow(/CHECK/i);
    await bad("2026-07-10T21:00:00Z", "2026-07-11T21:00:00Z"); // exactly 24 h
  });

  it("the write SQL refuses a non-stage point and an overlap by itself, and rolls back the whole batch", async () => {
    const f = await fixture();
    const saved = await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00", { title: "Keep" })]);
    const before = await dbSessions(f.ev.id);
    const base = await updatedAt(f.ev.id);
    const repo = new D1EventSessionsRepository(env.DB);
    const mk = (id: string, pointId: string, from: string, to: string) => ({ id, pointId, title: "X", start: loc("2026-07-10", from), end: loc("2026-07-10", to) });
    const plan = (creates: ReturnType<typeof mk>[]) => ({
      toCreate: creates.map((s, index) => ({ index, session: s })),
      toUpdate: [],
      toDelete: [saved.sessions[0]!.id],
      finalCount: creates.length,
      result: creates,
    });
    // category: the JOIN drops the row, the final count is short and the assert rolls everything back (the delete included)
    await expect(repo.save({ eventId: f.ev.id, ownerId: f.o.id, base, now: base + 1, currentCount: 1, plan: plan([mk("n1", f.toilets, "10:00", "11:00")]) })).rejects.toThrow();
    // overlap in the stored set: caught by the self-join in the assert
    await expect(
      repo.save({ eventId: f.ev.id, ownerId: f.o.id, base, now: base + 1, currentCount: 1, plan: plan([mk("n2", f.stage, "10:00", "11:00"), mk("n3", f.stage, "10:30", "11:30")]) }),
    ).rejects.toThrow();
    expect(await dbSessions(f.ev.id)).toEqual(before);
    expect(await updatedAt(f.ev.id)).toBe(base);
    // touching ends are fine at this level too
    expect(await repo.save({ eventId: f.ev.id, ownerId: f.o.id, base, now: base + 1, currentCount: 1, plan: plan([mk("n4", f.stage, "10:00", "11:00"), mk("n5", f.stage, "11:00", "12:00")]) })).toEqual({ ok: true });
  });
});

describe("concurrency", () => {
  it("a stale baseUpdatedAt is 409 event_changed BEFORE any id check, and nothing is written; two saves at once: exactly one wins", async () => {
    const f = await fixture();
    const start = await getSessions(f.o, f.ev.id);
    await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00")]);
    const before = await dbSessions(f.ev.id);

    // Stale AND naming an unknown session and a foreign point: still 409 (a stale tab keeps its draft)
    const stale = await putSessions(f.o, f.ev.id, {
      baseUpdatedAt: start.eventUpdatedAt,
      sessions: [{ ...sess("no-such-point", "2026-07-10", "20:00", "21:00"), id: "no-such-session" }],
    });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe("event_changed");
    expect(await dbSessions(f.ev.id)).toEqual(before);

    const fresh = await getSessions(f.o, f.ev.id);
    const [r1, r2] = await Promise.all([
      putSessions(f.o, f.ev.id, { baseUpdatedAt: fresh.eventUpdatedAt, sessions: [...fresh.sessions, sess(f.stage, "2026-07-11", "10:00", "11:00", { title: "One" })] }),
      putSessions(f.o, f.ev.id, { baseUpdatedAt: fresh.eventUpdatedAt, sessions: [...fresh.sessions, sess(f.stage, "2026-07-11", "10:00", "11:00", { title: "Two" })] }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await dbSessions(f.ev.id)).toHaveLength(2);
  });

  it("another editor (a Points save, an event edit) makes an old Schedule editor stale", async () => {
    const f = await fixture();
    const start = await getSessions(f.o, f.ev.id);
    const pts = await getPoints(f.o, f.ev.id);
    expect((await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: pts.points.map((p) => ({ ...p, x: 0.9 })) })).status).toBe(200);
    expect((await errorOf(await putSessions(f.o, f.ev.id, { baseUpdatedAt: start.eventUpdatedAt, sessions: [sess(f.stage, "2026-07-10", "20:00", "21:00")] }))).code).toBe("event_changed");

    const mid = await getSessions(f.o, f.ev.id);
    expect((await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, city: "Cork" } })).status).toBe(200);
    expect((await errorOf(await putSessions(f.o, f.ev.id, { baseUpdatedAt: mid.eventUpdatedAt, sessions: [] }))).code).toBe("event_changed");
    expect(await dbSessions(f.ev.id)).toEqual([]);
  });

  it("a Sessions save makes an old Points editor stale", async () => {
    const f = await fixture();
    const pts = await getPoints(f.o, f.ev.id);
    await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00")]);
    expect((await errorOf(await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: pts.points }))).code).toBe("event_changed");
  });
});

describe("access control: every refusal looks like a missing event", () => {
  it("another organizer, a demo event and a bad id get the same 404 on GET and PUT; no Admin bypass; anonymous is 401", async () => {
    const f = await fixture();
    const intruder = await newUser("organizer");
    const admin = await newUser("admin");
    const saved = await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-10", "20:00", "21:00")]);
    const demo = (await env.DB.prepare("SELECT id FROM events WHERE owner_id IS NULL LIMIT 1").first<{ id: string }>())!.id;
    const missing = await shape(await call(`/api/v1/panel/events/${"z".repeat(30)}/sessions`, { cookie: intruder.session }));
    expect(missing.status).toBe(404);
    for (const [who, id] of [[intruder, f.ev.id], [admin, f.ev.id], [intruder, demo], [intruder, "BAD ID!"], [intruder, "a".repeat(65)]] as const) {
      expect(await shape(await call(`/api/v1/panel/events/${id}/sessions`, { cookie: who.session }))).toEqual(missing);
      expect(await shape(await putSessions(who, id, { baseUpdatedAt: saved.eventUpdatedAt, sessions: [] }))).toEqual(missing);
    }
    expect(await dbSessions(f.ev.id)).toHaveLength(1);
    expect((await call(`/api/v1/panel/events/${f.ev.id}/sessions`)).status).toBe(401);
    expect((await call(`/api/v1/panel/events/${f.ev.id}/sessions`, { method: "PUT", json: {} })).status).toBe(401);
  });

  it("cross-site and non-JSON requests are refused first; PUT counts against the write limiter, GET does not", async () => {
    const f = await fixture();
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    expect((await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [] }, { headers: { origin: "http://evil.test" } })).status).toBe(403);
    expect((await call(`/api/v1/panel/events/${f.ev.id}/sessions`, { method: "PUT", cookie: f.o.session, body: "x", headers: { "content-type": "text/plain" } })).status).toBe(415);
    const limited = { PANEL_WRITE_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [sess(f.stage, "2026-07-10", "20:00", "21:00")] }, { over: limited });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await call(`/api/v1/panel/events/${f.ev.id}/sessions`, { cookie: f.o.session, over: limited })).status).toBe(200);
    expect(await dbSessions(f.ev.id)).toEqual([]);
  });

  it("an invalid body for another organizer's event is the plain 404 (the body is never parsed)", async () => {
    const f = await fixture();
    const intruder = await newUser("organizer");
    const res = await call(`/api/v1/panel/events/${f.ev.id}/sessions`, { method: "PUT", cookie: intruder.session, rawBody: "{not json" });
    expect(res.status).toBe(404);
  });
});

describe("deleting or recategorizing a Point that has Sessions (Points PUT)", () => {
  const withSessions = async () => {
    const f = await fixture();
    const saved = await saveSet(f.o, f.ev.id, [
      sess(f.stage, "2026-07-10", "20:00", "21:00"),
      sess(f.stage, "2026-07-10", "21:00", "22:00"),
      sess(f.landmark, "2026-07-10", "10:00", "11:00"),
    ]);
    return { f, saved };
  };

  it("GET /points reports sessionCounts per point", async () => {
    const { f } = await withSessions();
    expect((await getPoints(f.o, f.ev.id)).sessionCounts).toEqual({ [f.stage]: 2, [f.landmark]: 1 });
  });

  it("a delete without the acknowledgement is 409 point_has_sessions with ids and counts, and nothing is written", async () => {
    const { f } = await withSessions();
    const pts = await getPoints(f.o, f.ev.id);
    const without = pts.points.filter((p) => p.id !== f.stage);
    const rowsBefore = (await env.DB.prepare("SELECT count(*) AS n FROM event_points WHERE event_id = ?1").bind(f.ev.id).first<{ n: number }>())!.n;
    const sessionsBefore = await dbSessions(f.ev.id);
    const base = await updatedAt(f.ev.id);

    const res = await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: without });
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const err = await errorOf(res);
    expect(err.code).toBe("point_has_sessions");
    expect(err.affected).toEqual([{ pointId: f.stage, sessions: 2 }]);
    // An acknowledgement for another point does not cover it, and neither does an empty one
    for (const ack of [[], [f.landmark], ["no-such-point"]]) {
      const r = await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: without, deleteSessionsOf: ack });
      expect((await errorOf(r)).code).toBe("point_has_sessions");
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM event_points WHERE event_id = ?1").bind(f.ev.id).first<{ n: number }>())!.n).toBe(rowsBefore);
    expect(await dbSessions(f.ev.id)).toEqual(sessionsBefore);
    expect(await updatedAt(f.ev.id)).toBe(base);
  });

  it("with the acknowledgement the Point and its Sessions go atomically, and the response counts them", async () => {
    const { f } = await withSessions();
    const pts = await getPoints(f.o, f.ev.id);
    const res = await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: pts.points.filter((p) => p.id !== f.stage), deleteSessionsOf: [f.stage, f.landmark, "unrelated"] });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = savePointsResponseSchema.parse(await res.json());
    expect(saved.counts).toEqual({ created: 0, updated: 0, deleted: 1, sessionsDeleted: 2 });
    expect(saved.sessionCounts).toEqual({ [f.landmark]: 1 });
    expect((await dbSessions(f.ev.id)).map((r) => r.point_id)).toEqual([f.landmark]);
    expect((await getSessions(f.o, f.ev.id)).sessions).toHaveLength(1);
    // Deleting a Point without Sessions needs no acknowledgement
    const now = await getPoints(f.o, f.ev.id);
    expect((await putPoints(f.o, f.ev.id, { baseUpdatedAt: now.eventUpdatedAt, points: now.points.filter((p) => p.id !== f.toilets) })).status).toBe(200);
  });

  it("D1 meta.changes versus FK-cascaded rows: a delete of a Point with Sessions never trips the changes check", async () => {
    // Probe what this D1 reports, then show the route copes with it either way.
    const { f } = await withSessions();
    const probe = await env.DB.prepare("DELETE FROM event_points WHERE event_id = ?1 AND id = ?2").bind(f.ev.id, f.stage).run();
    expect([1, 3]).toContain(probe.meta.changes); // local D1 reports 3: cascaded rows ARE counted, hence the tolerant check in the repository
    const { f: g } = await withSessions();
    const pts = await getPoints(g.o, g.ev.id);
    const res = await putPoints(g.o, g.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: pts.points.filter((p) => p.id !== g.stage), deleteSessionsOf: [g.stage] });
    expect(res.status).toBe(200);
  });

  it("a category change away from stage or landmark is 409 point_has_sessions; stage to landmark is fine", async () => {
    const { f } = await withSessions();
    const pts = await getPoints(f.o, f.ev.id);
    const as = (id: string, category: string) => pts.points.map((p) => (p.id === id ? { ...p, category } : p));
    const bad = await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: as(f.stage, "food"), deleteSessionsOf: [f.stage] });
    expect(bad.status).toBe(409);
    const err = await errorOf(bad);
    expect(err.code).toBe("point_has_sessions");
    expect(err.affected).toEqual([{ pointId: f.stage, sessions: 2 }]);
    expect((await getPoints(f.o, f.ev.id)).points.find((p) => p.id === f.stage)!.category).toBe("stage");

    const ok = await putPoints(f.o, f.ev.id, { baseUpdatedAt: pts.eventUpdatedAt, points: as(f.stage, "landmark") });
    expect(ok.status).toBe(200);
    expect((await getSessions(f.o, f.ev.id)).points.find((p) => p.id === f.stage)!.category).toBe("landmark");
    // A Point WITHOUT sessions can still change category
    const now = await getPoints(f.o, f.ev.id);
    expect((await putPoints(f.o, f.ev.id, { baseUpdatedAt: now.eventUpdatedAt, points: now.points.map((p) => (p.id === f.stage2 ? { ...p, category: "food" } : p)) })).status).toBe(200);
  });

  it("deleting the event removes its Sessions", async () => {
    const { f } = await withSessions();
    expect((await call(`/api/v1/panel/events/${f.ev.id}`, { method: "DELETE", cookie: f.o.session })).status).toBe(204);
    expect(await dbSessions(f.ev.id)).toEqual([]);
  });
});

describe("editing the event dates or zone (PUT /panel/events/:id)", () => {
  it("is refused with 409 sessions_outside_dates and the count when stored Sessions would fall outside; nothing is written", async () => {
    const f = await fixture();
    await saveSet(f.o, f.ev.id, [
      sess(f.stage, "2026-07-12", "20:00", "21:00"),
      sess(f.stage, "2026-07-13", "01:30", "02:30", { title: "Last night DJ" }),
      sess(f.stage, "2026-07-10", "20:00", "21:00"),
    ]);
    const before = await updatedAt(f.ev.id);
    const evBefore = panelEventResponseSchema.parse(await (await call(`/api/v1/panel/events/${f.ev.id}`, { cookie: f.o.session })).json()).event;

    // One day shorter: the 12th and the 01:30 of the 13th (the 12th's night) are out
    const res = await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, endDate: "2026-07-11", city: "Cork" } });
    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const err = await errorOf(res);
    expect(err.code).toBe("sessions_outside_dates");
    expect(err.count).toBe(2);
    expect(await updatedAt(f.ev.id)).toBe(before);
    expect(panelEventResponseSchema.parse(await (await call(`/api/v1/panel/events/${f.ev.id}`, { cookie: f.o.session })).json()).event).toEqual(evBefore);

    // Starting later: the first day's session is out
    const later = await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, startDate: "2026-07-11" } });
    expect((await errorOf(later)).count).toBe(1);
    // A zone change that moves a Session out of the window: 01:30 IST on the 13th is 12:30 on the 13th in Auckland, past 06:00 there
    const zone = await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, timeZone: "Pacific/Auckland" } });
    expect(zone.status).toBe(409);

    // Extending, or an edit that keeps every Session inside, is fine
    expect((await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, endDate: "2026-07-14", city: "Cork" } })).status).toBe(200);
    expect((await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, endDate: "2026-07-12" } })).status).toBe(200);
  });

  it("an event without Sessions edits as before; another organizer's event is still the plain 404", async () => {
    const f = await fixture();
    const other = await newUser("organizer");
    expect((await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, endDate: "2026-07-10" } })).status).toBe(200);
    expect((await errorOf(await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: other.session, json: valid }))).code).toBe("event_not_found");
  });
});

describe("where Sessions show up", () => {
  const publish = async (f: Fixture) => {
    const admin = await newUser("admin");
    expect((await call(`/api/v1/panel/events/${f.ev.id}/publish-request`, { method: "POST", cookie: f.o.session, json: {} })).status).toBe(200);
    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${f.ev.id}/review`, { cookie: admin.session })).json());
    expect((await call(`/api/v1/admin/events/${f.ev.id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: rv.review.updatedAt } })).status).toBe(200);
    clearEventPreviewCache();
    clearListEventsCache();
    return admin;
  };

  it("owner preview and Admin review include Sessions, uncached; the public bundle only while published, ETag changes on a save", async () => {
    const f = await fixture();
    const admin = await newUser("admin");
    const saved = await saveSet(f.o, f.ev.id, [
      sess(f.stage, "2026-07-10", "21:00", "22:00", { title: "Second", description: "Two\nlines" }),
      sess(f.landmark, "2026-07-10", "10:00", "11:00", { title: "First" }),
    ]);
    const pv = await call(`/api/v1/panel/events/${f.ev.id}/preview`, { cookie: f.o.session });
    expect(pv.headers.get("cache-control")).toBe("private, no-store");
    const preview = eventPreviewResponseSchema.parse(await pv.json());
    expect(preview.sessions.map((s) => s.title)).toEqual(["First", "Second"]);
    expect(preview.sessions).toEqual([...saved.sessions].sort((a, b) => (a.start < b.start ? -1 : 1)));

    expect((await call(`/api/v1/events/${f.ev.slug}/map-bundle`)).status).toBe(404); // draft
    expect((await call(`/api/v1/panel/events/${f.ev.id}/publish-request`, { method: "POST", cookie: f.o.session, json: {} })).status).toBe(200);
    const rvRes = await call(`/api/v1/admin/events/${f.ev.id}/review`, { cookie: admin.session });
    expect(rvRes.headers.get("cache-control")).toBe("no-store"); // Admin routes: uncached, as before
    const rv = adminReviewResponseSchema.parse(await rvRes.json());
    expect(rv.sessions.map((s) => s.title)).toEqual(["First", "Second"]);
    expect((await call(`/api/v1/admin/events/${f.ev.id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: rv.review.updatedAt } })).status).toBe(200);

    const res = await call(`/api/v1/events/${f.ev.slug}/map-bundle`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const etag = res.headers.get("etag");
    const bundle = mapBundleSchema.parse(await res.json());
    expect(bundle.sessions.map((s) => [s.title, s.description])).toEqual([["First", undefined], ["Second", "Two\nlines"]]);
    expect(bundle.sessions[0]!.pointId).toBe(f.landmark);

    // A save on a published event goes live without review
    const now = await getSessions(f.o, f.ev.id);
    expect((await putSessions(f.o, f.ev.id, { baseUpdatedAt: now.eventUpdatedAt, sessions: [{ ...now.sessions[0], title: "Renamed" }, now.sessions[1]] })).status).toBe(200);
    const after = await call(`/api/v1/events/${f.ev.slug}/map-bundle`);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect(mapBundleSchema.parse(await after.json()).sessions.map((s) => s.title)).toEqual(["Renamed", "Second"]);
  });

  it("publish, add a last-night session, shorten the dates: the API refuses, and if it happens anyway the bundle is still 200 without it", async () => {
    const f = await fixture();
    await saveSet(f.o, f.ev.id, [sess(f.stage, "2026-07-12", "21:00", "22:00", { title: "Fri" }), sess(f.stage, "2026-07-13", "01:30", "03:00", { title: "Last night DJ" })]);
    await publish(f);
    const full = mapBundleSchema.parse(await (await call(`/api/v1/events/${f.ev.slug}/map-bundle`)).json());
    expect(full.sessions.map((s) => s.title)).toEqual(["Fri", "Last night DJ"]);

    const refused = await call(`/api/v1/panel/events/${f.ev.id}`, { method: "PUT", cookie: f.o.session, json: { ...valid, endDate: "2026-07-11" } });
    expect(refused.status).toBe(409);
    expect(mapBundleSchema.safeParse(await (await call(`/api/v1/events/${f.ev.slug}/map-bundle`)).json()).success).toBe(true);

    // Defence in depth: dates changed behind the API's back (a legacy row, a future bug)
    await env.DB.prepare("UPDATE events SET end_date = '2026-07-11', updated_at = updated_at + 1 WHERE id = ?1").bind(f.ev.id).run();
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    let res: Response;
    try {
      res = await call(`/api/v1/events/${f.ev.slug}/map-bundle`);
    } finally {
      console.error = orig;
    }
    expect(res.status).toBe(200);
    const bundle = mapBundleSchema.parse(await res.json());
    expect(bundle.sessions).toEqual([]); // both the 12th and the 01:30 of the 13th are now outside 10..11
    expect(errors.join("\n")).toMatch(/\[bundle\] dropped 2 session\(s\) outside the event window slug=/);
  });
});

describe("limits", () => {
  const slot = (point: string, i: number, over: Record<string, unknown> = {}) => {
    const from = localToUtc("2026-07-10", "06:00", "Europe/Dublin") + i * 20 * 60_000;
    return { pointId: point, title: `S${i}`, start: formatUtcInstant(from), end: formatUtcInstant(from + 20 * 60_000), ...over };
  };

  it("1000 sessions across seven points (about 600 KB, over the Points limit) are accepted in few statements of bounded size", async () => {
    const o = await newUser("organizer");
    const ev = await create(o);
    await uploadMap(o, ev.id);
    const start = await getPoints(o, ev.id);
    const pts = savePointsResponseSchema.parse(
      await (await putPoints(o, ev.id, { baseUpdatedAt: start.eventUpdatedAt, points: Array.from({ length: 7 }, (_, i) => pt({ name: `Stage ${i}`, x: i / 10 })) })).json(),
    );
    const ids = pts.points.map((p) => p.id);
    const sessions = Array.from({ length: 1000 }, (_, i) => slot(ids[Math.floor(i / 150)]!, i % 150, { title: `T${i} ${"t".repeat(100)}`, description: "d".repeat(300) }));
    const body = JSON.stringify({ baseUpdatedAt: (await getSessions(o, ev.id)).eventUpdatedAt, sessions });
    expect(body.length).toBeGreaterThan(524_288);
    expect(body.length).toBeLessThan(1_048_576);

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
    const res = await call(`/api/v1/panel/events/${ev.id}/sessions`, { method: "PUT", cookie: o.session, rawBody: body, over: { DB: spyDb } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(saveSessionsResponseSchema.parse(await res.json()).counts.created).toBe(1000);
    expect(await dbSessions(ev.id)).toHaveLength(1000);
    expect(statements.length).toBeLessThan(50);
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(60_000);
    // Deleting all of them in one request is bounded too
    const clear = await putSessions(o, ev.id, { baseUpdatedAt: (await getSessions(o, ev.id)).eventUpdatedAt, sessions: [] });
    expect(saveSessionsResponseSchema.parse(await clear.json()).counts.deleted).toBe(1000);
  });

  it("three scoped body limits: Sessions PUT 1 MiB, Points PUT 512 KB, everything else 8 KB", async () => {
    const f = await fixture();
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    const pad = (n: number) => "x".repeat(n);
    const stream = (text: string, path: string, method = "PUT") => {
      const bytes = new TextEncoder().encode(text);
      const chunked = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < bytes.length; i += 16_384) c.enqueue(bytes.slice(i, i + 16_384));
          c.close();
        },
      });
      return app.fetch(
        new Request(`${ORIGIN}${path}`, {
          method,
          headers: { origin: ORIGIN, "content-type": "application/json", cookie: `__Host-atlas_session=${f.o.session}`, "cf-connecting-ip": "198.51.100.251" },
          body: chunked,
          // @ts-expect-error workerd needs duplex for streamed request bodies
          duplex: "half",
        }),
        baseEnv as unknown as typeof env,
      );
    };
    const path = `/api/v1/panel/events/${f.ev.id}/sessions`;

    // Over 1 MiB on the route: 413, with Content-Length and chunked
    const huge = JSON.stringify({ baseUpdatedAt: base, sessions: [], pad: pad(1_048_576) });
    const tooBig = await call(path, { method: "PUT", cookie: f.o.session, rawBody: huge });
    expect(tooBig.status).toBe(413);
    expect((await errorOf(tooBig)).code).toBe("payload_too_large");
    expect(tooBig.headers.get("cache-control")).toBe("private, no-store");
    expect((await stream(huge, path)).status).toBe(413);
    // Between 8 KB and 1 MiB: the body is read (unknown field -> 400, not 413), also when chunked
    const mid = JSON.stringify({ baseUpdatedAt: base, sessions: [], pad: pad(700_000) });
    expect((await call(path, { method: "PUT", cookie: f.o.session, rawBody: mid })).status).toBe(400);
    expect((await stream(mid, path)).status).toBe(400);

    // The 512 KB limit of the Points PUT holds: 700 KB is refused there although it would pass on Sessions
    const pts = await getPoints(f.o, f.ev.id);
    const ptsBody = JSON.stringify({ baseUpdatedAt: pts.eventUpdatedAt, points: [], pad: pad(600_000) });
    expect((await call(`/api/v1/panel/events/${f.ev.id}/points`, { method: "PUT", cookie: f.o.session, rawBody: ptsBody })).status).toBe(413);

    // Near misses keep the 8 KB limit
    const big = { baseUpdatedAt: base, sessions: [], pad: pad(9 * 1024) };
    const near: Array<[string, string]> = [
      [`${path}/`, "PUT"],
      [`${path}/x`, "PUT"],
      [`${path}/x/y`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id}/sessionsx`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id}/x/sessions`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id.toUpperCase()}/sessions`, "PUT"],
      [`/api/v1/panel/events/${"a".repeat(65)}/sessions`, "PUT"],
      [path, "POST"],
      [path, "PATCH"],
      [`/api/v1/panel/events/${f.ev.id}`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id}`, "PATCH"],
      [`/api/v1/panel/events/${f.ev.id}/points/x`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id}/points/`, "PUT"],
      [`/api/v1/panel/events/${f.ev.id}/publish-request`, "POST"],
      [`/api/v1/panel/events`, "POST"],
    ];
    for (const [p, method] of near) expect((await call(p, { method, cookie: f.o.session, json: big })).status, `${method} ${p}`).toBe(413);
    // A valid-size body on the real route still works
    expect((await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [] })).status).toBe(200);
  });
});

describe("logs", () => {
  it("one line per save with ids and counts only, never titles, descriptions or times", async () => {
    const f = await fixture();
    const base = (await getSessions(f.o, f.ev.id)).eventUpdatedAt;
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      await putSessions(f.o, f.ev.id, { baseUpdatedAt: base, sessions: [sess(f.stage, "2026-07-10", "20:00", "21:00", { title: "SecretTitle", description: "SecretDescription" })] });
    } finally {
      console.log = orig;
    }
    const line = lines.find((l) => l.startsWith("[sessions]"))!;
    expect(line).toMatch(/action=sessions_saved outcome=ok organizer=org_ses\d+ event=\S+ created=1 updated=0 deleted=0 total=1 rows_written=2$/);
    expect(lines.join("\n")).not.toMatch(/SecretTitle|SecretDescription|T20:00|19:00:00Z/);
  });
});
