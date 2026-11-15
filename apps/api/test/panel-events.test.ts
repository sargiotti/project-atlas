import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  eventListSchema,
  eventPreviewResponseSchema,
  panelEventListResponseSchema,
  panelEventResponseSchema,
  errorResponseSchema,
} from "@atlas/contract";
import shellSource from "../../web/index.html?raw";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { clearListEventsCache } from "../src/application/list-events";
import { randomToken, sha256Hex } from "../src/adapters/crypto";

const ORIGIN = "http://atlas.test";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", "https://atlas.test").replaceAll("__BRAND_CARD_URL__", "https://atlas.test/og/b.0badcafe.jpg");
const ASSETS = { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } }) };
const testEnv = { ...env, ASSETS, PUBLIC_ORIGIN: "https://atlas.test" } as unknown as typeof env;

let ipCounter = 0;
const call = (path: string, init: RequestInit & { cookie?: string; origin?: string | null; json?: unknown } = {}) => {
  const { cookie, origin = ORIGIN, json, headers, ...rest } = init;
  const h: Record<string, string> = { "cf-connecting-ip": `198.51.100.${(ipCounter++ % 250) + 1}`, ...(headers as Record<string, string>) };
  if (cookie) h.cookie = `__Host-atlas_session=${cookie}`;
  if (origin) h.origin = origin;
  let body = rest.body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers: h, body }), testEnv);
};

interface Org {
  id: string;
  session: string;
}
let orgSeq = 0;
async function newOrganizer(): Promise<Org> {
  const n = ++orgSeq;
  const id = `org_test${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, 'organizer', 0)").bind(id, `sub${n}`, `o${n}@example.com`, `Org ${n}`),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

const valid = {
  name: "Fiesta de mi Barrio",
  startDate: "2026-07-10",
  endDate: "2026-07-12",
  timeZone: "Europe/Dublin",
  city: "Galway",
  country: "IE",
  language: "es",
  description: "Ven a ver https://example.org y disfruta.",
  website: "https://example.com",
};

const create = async (o: Org, over: Record<string, unknown> = {}) => {
  const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, ...over } });
  expect(res.status).toBe(201);
  return panelEventResponseSchema.parse(await res.json()).event;
};

const countEvents = async (where = "1=1") => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${where}`).first<{ n: number }>())!.n;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  clearEventPreviewCache();
  clearListEventsCache();
});

describe("create", () => {
  it("saves a draft with a generated slug, owned by the caller, never published", async () => {
    const o = await newOrganizer();
    const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: valid });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("etag")).toBeNull();
    const { event } = panelEventResponseSchema.parse(await res.json());
    expect(event.status).toBe("draft");
    expect(event.slug).toMatch(/^fiesta-de-mi-barrio-[a-z0-9]{6}$/);
    expect(event.website).toBe("https://example.com/");
    expect(event.description).toBe(valid.description);

    const row = await env.DB.prepare("SELECT status, owner_id, day_start FROM events WHERE id = ?1").bind(event.id).first();
    expect(row).toEqual({ status: "draft", owner_id: o.id, day_start: "06:00" });

    const list = panelEventListResponseSchema.parse(await (await call("/api/v1/panel/events", { cookie: o.session })).json());
    expect(list.events.map((e) => e.id)).toEqual([event.id]);
  });

  it("rejects invalid input with field codes only and saves nothing", async () => {
    const o = await newOrganizer();
    const res = await call("/api/v1/panel/events", {
      method: "POST",
      cookie: o.session,
      json: { ...valid, name: "ab", website: "http://secret-value.example", endDate: "2026-07-01", status: "published" },
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    const body = errorResponseSchema.parse(JSON.parse(text));
    expect(body.error.code).toBe("validation_error");
    expect(body.error.fields).toEqual(
      expect.arrayContaining([
        { path: "name", code: "too_short" },
        { path: "website", code: "website_not_https" },
        { path: "body", code: "unknown_field" },
      ]),
    );
    expect(text).not.toContain("secret-value");
    expect(await countEvents("owner_id IS NOT NULL")).toBe(0);
  });

  it("refuses the 11th event; two parallel creates at 9 of 10 leave exactly one winner", async () => {
    const o = await newOrganizer();
    const other = await newOrganizer();
    const stmt = env.DB.prepare(
      "INSERT INTO events (id, slug, name, start_date, end_date, city, country, language, status, publish_state, owner_id, created_at, updated_at) VALUES (?1, ?2, 'Seed', '2026-07-10', '2026-07-10', 'X', 'IE', 'en', ?3, ?3, ?4, ?5, ?5)",
    );
    // Nine events of mixed status: the count covers all of them.
    await env.DB.batch(Array.from({ length: 9 }, (_, i) => stmt.bind(`seed-${i}`, `seed-${i}-abcdef`, i % 2 ? "published" : "draft", o.id, i)));

    const [a, b] = await Promise.all([
      call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: valid }),
      call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, name: "Second one" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    const err = errorResponseSchema.parse(await loser.json());
    expect(err.error.code).toBe("event_limit_reached");
    expect(await countEvents(`owner_id = '${o.id}'`)).toBe(10);

    const again = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: valid });
    expect(again.status).toBe(409);
    expect(await countEvents(`owner_id = '${o.id}'`)).toBe(10);
    // The cap is per organizer.
    await create(other);
  });
});

describe("edit and delete", () => {
  it("PUT replaces the fields and keeps slug, status and owner", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    const res = await call(`/api/v1/panel/events/${ev.id}`, {
      method: "PUT",
      cookie: o.session,
      json: { ...valid, name: "Renamed Fest", description: "", website: null, city: "Dublin" },
    });
    expect(res.status).toBe(200);
    const { event } = panelEventResponseSchema.parse(await res.json());
    expect(event).toMatchObject({ id: ev.id, slug: ev.slug, status: "draft", name: "Renamed Fest", city: "Dublin", description: null, website: null });
    expect(await countEvents(`owner_id = '${o.id}'`)).toBe(1);
  });

  it("DELETE removes the event for good; a second delete is a 404; the public page is gone", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    expect((await call(`/api/v1/panel/events/${ev.id}`, { method: "DELETE", cookie: o.session })).status).toBe(204);
    expect(await countEvents(`id = '${ev.id}'`)).toBe(0);
    expect((await call(`/api/v1/panel/events/${ev.id}`, { method: "DELETE", cookie: o.session })).status).toBe(404);
    expect((await call(`/api/v1/panel/events/${ev.id}`, { cookie: o.session })).status).toBe(404);
    expect((await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session })).status).toBe(404);
  });

  it("owner preview: public-shaped payload, no map yet, no ids or status, no-store", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    const res = await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const body = eventPreviewResponseSchema.parse(JSON.parse(text));
    expect(body.map).toBeNull();
    expect(body.event).toMatchObject({ slug: ev.slug, name: valid.name, city: "Galway", country: "IE", timeZone: "Europe/Dublin", dayStart: "06:00", description: valid.description });
    expect(text).not.toContain(ev.id);
    expect(text).not.toContain(o.id);
    expect(text).not.toContain("draft");
  });
});

describe("ownership (IDOR)", () => {
  it("another organizer gets 404 on get, put, delete and preview, and the event is untouched", async () => {
    const a = await newOrganizer();
    const b = await newOrganizer();
    const ev = await create(a);
    const base = `/api/v1/panel/events/${ev.id}`;

    expect((await call(base, { cookie: b.session })).status).toBe(404);
    expect((await call(`${base}/preview`, { cookie: b.session })).status).toBe(404);
    const put = await call(base, { method: "PUT", cookie: b.session, json: { ...valid, name: "Hijacked" } });
    expect(put.status).toBe(404);
    expect(errorResponseSchema.parse(await put.json()).error.code).toBe("event_not_found");
    expect((await call(base, { method: "DELETE", cookie: b.session })).status).toBe(404);

    const bList = panelEventListResponseSchema.parse(await (await call("/api/v1/panel/events", { cookie: b.session })).json());
    expect(bList.events).toEqual([]);
    const row = await env.DB.prepare("SELECT name, owner_id FROM events WHERE id = ?1").bind(ev.id).first();
    expect(row).toEqual({ name: valid.name, owner_id: a.id });
    // A malformed id costs no lookup and gives the same answer.
    expect((await call("/api/v1/panel/events/NOT_AN_ID!", { cookie: a.session })).status).toBe(404);
  });

  it("a demo event (no owner) is not reachable through the panel", async () => {
    const a = await newOrganizer();
    const demo = (await env.DB.prepare("SELECT id FROM events WHERE slug = 'tiny-fest'").first<{ id: string }>())!;
    expect((await call(`/api/v1/panel/events/${demo.id}`, { cookie: a.session })).status).toBe(404);
    expect((await call(`/api/v1/panel/events/${demo.id}`, { method: "DELETE", cookie: a.session })).status).toBe(404);
    expect(await countEvents("slug = 'tiny-fest'")).toBe(1);
  });

  it("needs a session on every route", async () => {
    const res = await call("/api/v1/panel/events");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await call("/api/v1/panel/events", { method: "POST", json: valid })).status).toBe(401);
  });
});

describe("drafts are never public", () => {
  it("are absent from the list (and so from search), the map bundle and /e/{slug}, with the same answer as a missing event", async () => {
    const a = await newOrganizer();
    const draft = await create(a, { name: "Secret Draft" });
    // Give the draft a map, a point and a session: even then it must stay invisible.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES ('m-draft', ?1, 1, 100, 100, 'light', 'x.svg', 'svg', 0, 0)").bind(draft.id),
      env.DB.prepare("INSERT INTO points (id, map_id, category, name, description, x, y, created_at, updated_at) VALUES ('p-draft', 'm-draft', 'stage', 'Stage', '', 0.5, 0.5, 0, 0)"),
      env.DB.prepare("INSERT INTO point_sessions (id, event_id, point_id, title, description, start_utc, end_utc, created_at, updated_at) VALUES ('s-draft', ?1, 'p-draft', 'Set', NULL, '2026-07-10T17:00:00Z', '2026-07-10T18:00:00Z', 0, 0)").bind(draft.id),
    ]);

    const list = eventListSchema.parse(await (await call("/api/v1/events")).json());
    expect(list.map((e) => e.slug)).toEqual(["tiny-fest"]);
    expect(JSON.stringify(list)).not.toContain("Secret Draft");

    const missing = await call("/api/v1/events/no-such-event-zzzzzz/map-bundle");
    const bundle = await call(`/api/v1/events/${draft.slug}/map-bundle`);
    expect(bundle.status).toBe(404);
    expect(bundle.headers.get("cache-control")).toBe(missing.headers.get("cache-control"));
    const norm = async (r: Response) => JSON.stringify(((await r.json()) as { error: { code: string } }).error.code);
    expect(await norm(bundle)).toBe(await norm(missing));

    for (const cookie of [undefined, a.session]) {
      const gone = await call("/e/no-such-event-zzzzzz", { cookie });
      const page = await call(`/e/${draft.slug}`, { cookie });
      expect(page.status).toBe(404);
      expect(page.status).toBe(gone.status);
      expect(page.headers.get("cache-control")).toBe(gone.headers.get("cache-control"));
      const html = await page.text();
      expect(html).toBe(await gone.text());
      expect(html).not.toContain("Secret Draft");
    }
  });

  it("a published event with an owner is public, so the filter is not just hiding everything", async () => {
    const a = await newOrganizer();
    const ev = await create(a, { name: "Going Public" });
    await env.DB.prepare("UPDATE events SET publish_state = 'published' WHERE id = ?1").bind(ev.id).run();
    const list = eventListSchema.parse(await (await call("/api/v1/events")).json());
    expect(list.map((e) => e.slug)).toContain(ev.slug);
    expect((await call(`/e/${ev.slug}`)).status).toBe(200);
  });
});

describe("CSRF guard on every non-safe method", () => {
  it("PUT and DELETE without Origin or with a foreign Origin are 403 and change nothing", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    const base = `/api/v1/panel/events/${ev.id}`;
    for (const origin of [null, "https://evil.example", "http://atlas.test.evil.example"]) {
      const put = await call(base, { method: "PUT", cookie: o.session, origin, json: { ...valid, name: "Hacked" } });
      expect(put.status).toBe(403);
      expect(errorResponseSchema.parse(await put.json()).error.code).toBe("invalid_origin");
      expect((await call(base, { method: "DELETE", cookie: o.session, origin })).status).toBe(403);
      expect((await call(base, { method: "PATCH", cookie: o.session, origin, json: { name: "Hacked" } })).status).toBe(403);
      expect((await call("/api/v1/panel/events", { method: "POST", cookie: o.session, origin, json: valid })).status).toBe(403);
    }
    // Same-origin but a cross-site fetch metadata header is refused too.
    const site = await call(base, { method: "DELETE", cookie: o.session, headers: { "sec-fetch-site": "cross-site" } });
    expect(site.status).toBe(403);
    const row = await env.DB.prepare("SELECT name FROM events WHERE id = ?1").bind(ev.id).first();
    expect(row).toEqual({ name: valid.name });
    expect(await countEvents(`owner_id = '${o.id}'`)).toBe(1);
  });

  it("PUT needs a JSON content type", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    const res = await call(`/api/v1/panel/events/${ev.id}`, {
      method: "PUT",
      cookie: o.session,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(valid),
    });
    expect(res.status).toBe(415);
  });

  it("bodies over 8 KB are refused", async () => {
    const o = await newOrganizer();
    const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, description: "x".repeat(9000) } });
    expect(res.status).toBe(413);
  });
});

describe("venue address (slice 08d)", () => {
  const publish = async (id: string) => {
    await env.DB.batch([
      env.DB.prepare("UPDATE events SET publish_state = 'published' WHERE id = ?1").bind(id),
      env.DB.prepare("INSERT INTO event_maps (id, event_id, position, width, height, theme, image_key, image_format, created_at, updated_at) VALUES (?1, ?2, 1, 100, 100, 'light', 'x.svg', 'svg', 0, 0)").bind(`m-${id}`, id),
    ]);
  };
  const bundleOf = async (slug: string) => (await call(`/api/v1/events/${slug}/map-bundle`)).json() as Promise<{ event: Record<string, unknown> }>;
  const dbAddress = async (id: string) => (await env.DB.prepare("SELECT venue_address AS v FROM events WHERE id = ?1").bind(id).first<{ v: string | null }>())!.v;

  it("create, edit and clear; panel, preview and logs", async () => {
    const o = await newOrganizer();
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    const ev = await create(o, { venueAddress: "  Strandvejen 1 " });
    expect(ev.venueAddress).toBe("Strandvejen 1");
    const putJson = (venueAddress?: unknown) =>
      call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, ...(venueAddress === undefined ? {} : { venueAddress }) } });

    const prev = eventPreviewResponseSchema.parse(await (await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session })).json());
    expect(prev.event.venueAddress).toBe("Strandvejen 1");
    expect(panelEventResponseSchema.parse(await (await putJson("Quay 2")).json()).event.venueAddress).toBe("Quay 2");
    spy.mockRestore();
    expect(logs.join("\n")).not.toContain("Strandvejen");
    expect(logs.join("\n")).not.toContain("Quay 2");

    for (const clear of [null, "", "   ", undefined]) {
      await putJson("Quay 2");
      const { event } = panelEventResponseSchema.parse(await (await putJson(clear)).json());
      expect(event.venueAddress, String(clear)).toBeNull();
      expect(await dbAddress(ev.id)).toBeNull();
    }
    const prev2 = await (await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session })).text();
    expect(prev2).not.toContain("venueAddress");
  });

  it("refuses a URL as address with address_has_url and saves nothing", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    for (const bad of ["www.example.com", "visit https://spam.example"]) {
      const res = await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, venueAddress: bad } });
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(errorResponseSchema.parse(JSON.parse(text)).error.fields).toEqual([{ path: "venueAddress", code: "address_has_url" }]);
      expect(text).not.toContain("spam.example");
    }
    expect((await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, venueAddress: "x".repeat(121) } })).status).toBe(400);
    expect(await dbAddress(ev.id)).toBeNull();
  });

  it("public bundle: a published event exposes the About fields, a draft is a 404; an edit goes live and bumps updated_at", async () => {
    const o = await newOrganizer();
    const ev = await create(o, { venueAddress: "Strandvejen 1" });
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(404);
    await publish(ev.id);
    const { event } = await bundleOf(ev.slug);
    expect(event).toMatchObject({ city: "Galway", country: "IE", description: valid.description, website: "https://example.com/", venueAddress: "Strandvejen 1" });
    expect(Object.keys(event).sort()).toEqual(["city", "country", "dayStart", "description", "endDate", "language", "name", "slug", "startDate", "timeZone", "venueAddress", "website"]);

    const before = (await env.DB.prepare("SELECT updated_at AS u FROM events WHERE id = ?1").bind(ev.id).first<{ u: number }>())!.u;
    await new Promise((r) => setTimeout(r, 5));
    const put = await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, venueAddress: null, website: null } });
    expect(put.status).toBe(200);
    expect((await env.DB.prepare("SELECT updated_at AS u FROM events WHERE id = ?1").bind(ev.id).first<{ u: number }>())!.u).toBeGreaterThan(before);
    const after = (await bundleOf(ev.slug)).event;
    expect(after).not.toHaveProperty("venueAddress");
    expect(after).not.toHaveProperty("website");
  });

  it("a poisoned stored address never reaches visitors (output check)", async () => {
    const o = await newOrganizer();
    const ev = await create(o);
    await publish(ev.id);
    await env.DB.prepare("UPDATE events SET venue_address = ?2 WHERE id = ?1").bind(ev.id, "a‮b").run();
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(500);
  });

  it("the link preview page does not carry the address", async () => {
    const o = await newOrganizer();
    const ev = await create(o, { venueAddress: "Secretstreet 99" });
    await publish(ev.id);
    clearEventPreviewCache();
    const html = await (await call(`/e/${ev.slug}`)).text();
    expect(html).not.toContain("Secretstreet");
  });
});
