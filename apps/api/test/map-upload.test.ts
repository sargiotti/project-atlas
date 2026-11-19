import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import { errorResponseSchema, eventPreviewResponseSchema, panelEventResponseSchema, panelMapResponseSchema } from "@atlas/contract";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { D1MapImageRepository, DAILY_UPLOAD_LIMIT } from "../src/adapters/d1-map-image-repository";
import { fakeJpeg, fakeWebp } from "./map-fixtures";

const ORIGIN = "http://atlas.test";
let ip = 0;
const send = (path: string, init: RequestInit & { cookie?: string; origin?: string | null; json?: unknown; form?: FormData } = {}) => {
  const { cookie, origin = ORIGIN, json, form, headers, ...rest } = init;
  const h: Record<string, string> = { "cf-connecting-ip": `203.0.113.${(ip++ % 250) + 1}`, ...(headers as Record<string, string>) };
  if (cookie) h.cookie = `__Host-atlas_session=${cookie}`;
  if (origin) h.origin = origin;
  let body = rest.body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  if (form) body = form;
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers: h, body }), env as unknown as typeof env);
};

interface Org {
  id: string;
  session: string;
}
let seq = 0;
async function newOrganizer(): Promise<Org> {
  const n = ++seq;
  const id = `org_map${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, 'organizer', 0)").bind(id, `mapsub${n}`, `m${n}@example.com`, `Org ${n}`),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

const eventBody = { name: "Map Upload Fest", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en" };
async function newEvent(o: Org): Promise<string> {
  const res = await send("/api/v1/panel/events", { method: "POST", cookie: o.session, json: eventBody });
  expect(res.status).toBe(201);
  return panelEventResponseSchema.parse(await res.json()).event.id;
}

const blob = (bytes: Uint8Array, type = "image/webp") => new Blob([bytes as unknown as ArrayBuffer], { type });
function upload(opts: { full?: Uint8Array; small?: Uint8Array; theme?: string; extra?: [string, string] } = {}): FormData {
  const f = new FormData();
  f.append("full", blob(opts.full ?? fakeWebp(2400, 1800)), "whatever.svg"); // filename and client type are ignored
  f.append("small", blob(opts.small ?? fakeWebp(1200, 900)), "x.png");
  f.append("theme", opts.theme ?? "light");
  if (opts.extra) f.append(...opts.extra);
  return f;
}

const post = (id: string, o: Org | null, form: FormData, extra: { origin?: string | null } = {}) =>
  send(`/api/v1/panel/events/${id}/map`, { method: "POST", cookie: o?.session, form, ...extra });

const r2Keys = async (id: string) => (await env.MAPS.list({ prefix: `maps/${id}/` })).objects.map((o) => o.key);
const errorOf = async (res: Response) => errorResponseSchema.parse(await res.json()).error;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  await env.DB.prepare("DELETE FROM upload_quota").run();
});

describe("upload, replace, delete and draft-gated serving", () => {
  it("stores a map, shows it to the owner only, replaces it, and removes everything on delete", async () => {
    const owner = await newOrganizer();
    const other = await newOrganizer();
    const id = await newEvent(owner);

    // Upload
    const res = await post(id, owner, upload({ theme: "dark" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const first = panelMapResponseSchema.parse(await res.json()).map;
    expect(first).toMatchObject({ theme: "dark", format: "webp", full: { width: 2400, height: 1800 }, small: { width: 1200, height: 900 } });
    expect(first.full.url).toMatch(new RegExp(`^/media/maps/${id}/[0-9a-f]{32}-full\\.webp$`));
    expect(await r2Keys(id)).toHaveLength(2);

    // The event and the owner preview carry the map
    const ev = panelEventResponseSchema.parse(await (await send(`/api/v1/panel/events/${id}`, { cookie: owner.session })).json()).event;
    expect(ev.map?.full.url).toBe(first.full.url);
    const prev = eventPreviewResponseSchema.parse(await (await send(`/api/v1/panel/events/${id}/preview`, { cookie: owner.session })).json());
    expect(prev.map).toMatchObject({ id, theme: "dark", width: 2400, height: 1800, image: { format: "webp" } });
    expect(prev.map?.image.variants.map((v) => v.width)).toEqual([1200, 2400]);

    // Draft serving: the owner sees it with safe headers; anonymous and another organizer get a plain 404
    const served = await send(first.full.url, { cookie: owner.session });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("content-disposition")).toBe('inline; filename="map.webp"');
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(served.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(fakeWebp(2400, 1800));
    for (const who of [undefined, other.session]) {
      const denied = await send(first.full.url, { cookie: who });
      expect(denied.status).toBe(404);
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
    expect((await send(`/media/maps/${id}/${"0".repeat(32)}-full.webp`, { cookie: owner.session })).status).toBe(404);

    // Replace: new URLs, old objects gone from R2 and no longer resolve
    const res2 = await post(id, owner, upload({ full: fakeJpeg(1800, 1350), small: fakeJpeg(1200, 900), theme: "light" }));
    expect(res2.status).toBe(200);
    const second = panelMapResponseSchema.parse(await res2.json()).map;
    expect(second.format).toBe("jpeg");
    expect(second.full.url).not.toBe(first.full.url);
    expect(second.full.url.endsWith("-full.jpg")).toBe(true);
    expect(await r2Keys(id)).toHaveLength(2);
    expect((await send(first.full.url, { cookie: owner.session })).status).toBe(404);
    const servedJpg = await send(second.small.url, { cookie: owner.session });
    expect(servedJpg.headers.get("content-type")).toBe("image/jpeg");
    expect(servedJpg.headers.get("content-disposition")).toBe('inline; filename="map.jpg"');

    // Theme override
    const patch = await send(`/api/v1/panel/events/${id}/map/theme`, { method: "PATCH", cookie: owner.session, json: { theme: "dark" } });
    expect(patch.status).toBe(200);
    expect(panelMapResponseSchema.parse(await patch.json()).map.theme).toBe("dark");

    // Hard delete removes the row, every object (including an orphan) and the URLs stop resolving
    await env.MAPS.put(`maps/${id}/${"a".repeat(32)}-full.webp`, new Uint8Array([1]));
    const del = await send(`/api/v1/panel/events/${id}`, { method: "DELETE", cookie: owner.session });
    expect(del.status).toBe(204);
    expect(await r2Keys(id)).toEqual([]);
    expect((await send(second.full.url, { cookie: owner.session })).status).toBe(404);
  });

  it("serves a published event's map to anyone with a public cache header", async () => {
    const owner = await newOrganizer();
    const id = await newEvent(owner);
    const map = panelMapResponseSchema.parse(await (await post(id, owner, upload())).json()).map;
    await env.DB.prepare("UPDATE events SET publish_state = 'published' WHERE id = ?1").bind(id).run();
    const res = await send(map.small.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("concurrent replace", () => {
  it("switches only from the key it read: a stale or racing switch changes nothing", async () => {
    const owner = await newOrganizer();
    const id = await newEvent(owner);
    const repo = new D1MapImageRepository(env.DB);
    const m = (n: string) => ({ theme: "light" as const, format: "webp" as const, fullKey: `maps/${id}/${n}-full.webp`, fullWidth: 2400, fullHeight: 1800, smallKey: `maps/${id}/${n}-small.webp`, smallWidth: 1200, smallHeight: 900 });
    const a = m("a".repeat(32));
    const b = m("b".repeat(32));
    const c = m("c".repeat(32));
    expect(await repo.switchTo(id, owner.id, a, 1, null)).toBe(true); // first upload
    expect(await repo.switchTo(id, owner.id, b, 2, null)).toBe(false); // a row appeared meanwhile
    expect(await repo.switchTo(id, owner.id, b, 3, a.fullKey)).toBe(true); // replace from what was read
    expect(await repo.switchTo(id, owner.id, c, 4, a.fullKey)).toBe(false); // lost the race: a is no longer current
    expect((await repo.get(id))?.fullKey).toBe(b.fullKey);
  });
});

describe("who may touch the map", () => {
  it("401 anonymous, 404 another organizer, 403 cross-site", async () => {
    const owner = await newOrganizer();
    const other = await newOrganizer();
    const id = await newEvent(owner);
    expect((await post(id, null, upload())).status).toBe(401);
    expect((await post(id, other, upload())).status).toBe(404);
    expect((await errorOf(await post("no-such-event", owner, upload()))).code).toBe("event_not_found");
    expect((await errorOf(await post(id, owner, upload(), { origin: "https://evil.example" }))).code).toBe("invalid_origin");
    expect((await post(id, owner, upload(), { origin: null })).status).toBe(403);
    const patchOther = await send(`/api/v1/panel/events/${id}/map/theme`, { method: "PATCH", cookie: other.session, json: { theme: "dark" } });
    expect(patchOther.status).toBe(404);
    expect((await errorOf(await send(`/api/v1/panel/events/${id}/map/theme`, { method: "PATCH", cookie: owner.session, json: { theme: "dark" } }))).code).toBe("map_not_found");
    expect(await r2Keys(id)).toEqual([]);
  });
});

describe("refusals store nothing", () => {
  const refuse = async (form: FormData, status: number, code: string, reason?: string) => {
    const owner = await newOrganizer();
    const id = await newEvent(owner);
    const res = await post(id, owner, form);
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    if (reason) expect(err.reason).toBe(reason);
    expect(await r2Keys(id)).toEqual([]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_map_images WHERE event_id = ?1").bind(id).first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_quota WHERE organizer_id = ?1").bind(owner.id).first<{ n: number }>())!.n).toBe(0);
  };

  it("an SVG sent as image/webp is 415", () => refuse(upload({ full: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>") }), 415, "unsupported_image_type"));
  it("a full variant over 1.5 MB and a small one over 400 KB are 413", async () => {
    await refuse(upload({ full: fakeWebp(2400, 1800, { pad: 1_500_000 }) }), 413, "payload_too_large");
    await refuse(upload({ small: fakeWebp(1200, 900, { pad: 400_000 }) }), 413, "payload_too_large");
  });
  it("a body over 2 MiB is 413", () => refuse(upload({ full: fakeWebp(2400, 1800, { pad: 3 * 1024 * 1024 }) }), 413, "payload_too_large"));
  it("unknown parts, a bad theme and a missing part are 400", async () => {
    await refuse(upload({ extra: ["key", "maps/x"] }), 400, "invalid_upload", "unknown_part");
    await refuse(upload({ theme: "purple" }), 400, "invalid_upload", "bad_theme");
    const f = new FormData();
    f.append("full", blob(fakeWebp(2400, 1800)));
    f.append("theme", "light");
    await refuse(f, 400, "invalid_upload", "missing_part");
  });
  it("a non-multipart body is 415", async () => {
    const owner = await newOrganizer();
    const id = await newEvent(owner);
    const res = await send(`/api/v1/panel/events/${id}/map`, { method: "POST", cookie: owner.session, json: { theme: "light" } });
    expect(res.status).toBe(415);
  });
});

describe("daily quota", () => {
  it("claims atomically up to the cap, then refuses, per organizer and per UTC day", async () => {
    const a = await newOrganizer();
    const b = await newOrganizer();
    const repo = new D1MapImageRepository(env.DB);
    const now = Date.UTC(2026, 10, 14, 12);
    for (let i = 0; i < DAILY_UPLOAD_LIMIT; i++) expect(await repo.claimUpload(a.id, now)).toBe(true);
    expect(await repo.claimUpload(a.id, now)).toBe(false);
    expect(await repo.claimUpload(a.id, now + 3_600_000)).toBe(false); // same UTC day
    expect(await repo.claimUpload(b.id, now)).toBe(true); // another organizer is unaffected
    expect(await repo.claimUpload(a.id, Date.UTC(2026, 10, 15, 0, 0, 1))).toBe(true); // next UTC day
    const days = await env.DB.prepare("SELECT day FROM upload_quota WHERE organizer_id = ?1").bind(a.id).all<{ day: string }>();
    expect(days.results.map((r) => r.day)).toEqual(["2026-11-14", "2026-11-15"]);
    expect(await repo.claimUpload(a.id, Date.UTC(2026, 10, 20))).toBe(true);
    const pruned = await env.DB.prepare("SELECT day FROM upload_quota WHERE organizer_id = ?1").bind(a.id).all<{ day: string }>();
    expect(pruned.results.map((r) => r.day)).toEqual(["2026-11-20"]); // rows older than 2 days are gone
  });

  it("answers 429 with Retry-After once the cap is used, and stores nothing", async () => {
    const owner = await newOrganizer();
    const id = await newEvent(owner);
    await env.DB.prepare("INSERT INTO upload_quota (organizer_id, day, count) VALUES (?1, ?2, ?3)")
      .bind(owner.id, new Date().toISOString().slice(0, 10), DAILY_UPLOAD_LIMIT)
      .run();
    const res = await post(id, owner, upload());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(86_400);
    expect(await r2Keys(id)).toEqual([]);
  });
});
