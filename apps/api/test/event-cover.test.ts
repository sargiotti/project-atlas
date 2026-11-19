import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it } from "vitest";
import {
  COVER_FOCAL_BODY_LIMIT,
  COVER_UPLOAD_BODY_LIMIT,
  adminReviewResponseSchema,
  errorResponseSchema,
  eventListSchema,
  eventPreviewResponseSchema,
  mapBundleSchema,
  panelCoverResponseSchema,
  panelEventResponseSchema,
  toneOf,
} from "@atlas/contract";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { D1CoverRepository } from "../src/adapters/d1-cover-repository";
import { DAILY_UPLOAD_LIMIT } from "../src/adapters/d1-map-image-repository";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { clearListEventsCache } from "../src/application/list-events";
import { buildSeedStatements, planSeedCover } from "../scripts/seed-lib";
import { EXIF_GPS_PAYLOAD, fakeJpeg, fakeWebp } from "./map-fixtures";
import shellSource from "../../web/index.html?raw";

const ORIGIN = "http://atlas.test";
const PUBLIC = "https://atlas.test.example";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", PUBLIC).replaceAll("__BRAND_CARD_URL__", `${PUBLIC}/og/brand-card.0badcafe.jpg`);
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
  // The per-minute UPLOAD_LIMITER (5 / 60 s per organizer) is switched off here so that tests can make many calls with one
  // organizer; it has its own test below with a stand-in limiter.
  return app.fetch(new Request(`${ORIGIN}${path}`, { ...rest, headers: h, body }), { ...env, UPLOAD_LIMITER: limiter } as unknown as typeof env);
};
let limiter: { limit(o: { key: string }): Promise<{ success: boolean }> } | undefined;

interface User {
  id: string;
  session: string;
}
let seq = 0;
async function newUser(role: "organizer" | "admin" = "organizer"): Promise<User> {
  const n = ++seq;
  const id = `org_cov${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0)").bind(id, `covsub${n}`, `c${n}@example.com`, `Person ${n}`, role),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

const eventBody = { name: "Cover Fest", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en" };
async function newEvent(o: User): Promise<{ id: string; slug: string }> {
  const res = await send("/api/v1/panel/events", { method: "POST", cookie: o.session, json: eventBody });
  expect(res.status).toBe(201);
  const { event } = panelEventResponseSchema.parse(await res.json());
  return { id: event.id, slug: event.slug };
}
const setState = (id: string, state: string) => env.DB.prepare("UPDATE events SET publish_state = ?2, requested_at = 1 WHERE id = ?1").bind(id, state).run();
const updatedAt = async (id: string) => (await env.DB.prepare("SELECT updated_at AS u FROM events WHERE id = ?1").bind(id).first<{ u: number }>())!.u;

const blob = (bytes: Uint8Array, type = "application/octet-stream") => new Blob([bytes as unknown as ArrayBuffer], { type });
interface SetOpts {
  full?: Uint8Array;
  small?: Uint8Array;
  og?: Uint8Array;
  fx?: string;
  fy?: string;
  extra?: [string, string];
  omit?: string;
}
/** A valid set (1200x800 + 800x533 + 1200x630). Filenames and client content types are deliberately wrong: they are ignored. */
function coverForm(o: SetOpts = {}): FormData {
  const f = new FormData();
  const parts: [string, File | Blob | string][] = [
    ["full", blob(o.full ?? fakeWebp(1200, 800), "image/svg+xml")],
    ["small", blob(o.small ?? fakeWebp(800, 533), "text/html")],
    ["og", blob(o.og ?? fakeJpeg(1200, 630), "image/png")],
    ["fx", o.fx ?? "0.5"],
    ["fy", o.fy ?? "0.5"],
  ];
  for (const [k, v] of parts) {
    if (k === o.omit) continue;
    if (typeof v === "string") f.append(k, v);
    else f.append(k, v, "evil.svg");
  }
  if (o.extra) f.append(...o.extra);
  return f;
}
function focalForm(version: string, o: { og?: Uint8Array; fx?: string; fy?: string; extra?: [string, string]; omit?: string } = {}): FormData {
  const f = new FormData();
  const parts: [string, File | Blob | string][] = [
    ["og", blob(o.og ?? fakeJpeg(1200, 630, { pad: 20 }), "image/png")],
    ["fx", o.fx ?? "0.25"],
    ["fy", o.fy ?? "0.75"],
    ["baseVersion", version],
  ];
  for (const [k, v] of parts) if (k !== o.omit) f.append(k, v);
  if (o.extra) f.append(...o.extra);
  return f;
}

const put = (id: string, o: User | null, form: FormData, extra: { origin?: string | null } = {}) => send(`/api/v1/panel/events/${id}/cover`, { method: "PUT", cookie: o?.session, form, ...extra });
const patch = (id: string, o: User | null, form: FormData, extra: { origin?: string | null } = {}) => send(`/api/v1/panel/events/${id}/cover/focal`, { method: "PATCH", cookie: o?.session, form, ...extra });
const del = (id: string, o: User | null, extra: { origin?: string | null } = {}) => send(`/api/v1/panel/events/${id}/cover`, { method: "DELETE", cookie: o?.session, ...extra });
const uploadOk = async (id: string, o: User, form = coverForm()) => {
  const res = await put(id, o, form);
  expect(res.status).toBe(200);
  return panelCoverResponseSchema.parse(await res.json()).cover;
};

const r2Keys = async (id: string) => (await env.MAPS.list({ prefix: `covers/${id}/` })).objects.map((x) => x.key).sort();
const errorOf = async (res: Response) => errorResponseSchema.parse(await res.json()).error;
const coverRows = async (id: string) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM event_covers WHERE event_id = ?1").bind(id).first<{ n: number }>())!.n;
const quotaRows = async (o: User) => (await env.DB.prepare("SELECT COALESCE(SUM(count), 0) AS n FROM upload_quota WHERE organizer_id = ?1").bind(o.id).first<{ n: number }>())!.n;

beforeEach(async () => {
  limiter = undefined;
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  await env.DB.prepare("DELETE FROM upload_quota").run();
  clearEventPreviewCache();
  clearListEventsCache();
});

describe("upload, serve, replace, change focal, remove", () => {
  it("stores the three objects with server keys, serves them gated with the right headers, and bumps the event version", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { id } = await newEvent(owner);
    const before = await updatedAt(id);

    const res = await put(id, owner, coverForm({ fx: "0.1234", fy: "1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const cover = panelCoverResponseSchema.parse(await res.json()).cover;
    expect(cover).toMatchObject({ width: 1200, height: 800, focal: { x: 0.12, y: 1 } });
    expect(cover.url).toMatch(new RegExp(`^/media/covers/${id}/[0-9a-f]{32}-full\\.webp$`));
    expect(cover.url800).toMatch(new RegExp(`^/media/covers/${id}/[0-9a-f]{32}-800\\.webp$`));
    expect(cover.version).toBe(cover.url.split("/")[4]!.slice(0, 32));
    expect(await updatedAt(id)).toBeGreaterThan(before);

    // Three objects, server-generated names, content type from the sniffed bytes (not from the client part)
    const keys = await r2Keys(id);
    expect(keys).toHaveLength(3);
    expect(keys.map((k) => k.replace(/[0-9a-f]{32}/, "T")).sort()).toEqual([`covers/${id}/T-800.webp`, `covers/${id}/T-full.webp`, `covers/${id}/T-og.jpg`]);
    expect(new Set(keys.map((k) => k.split("/")[2]!.slice(0, 32))).size).toBe(3); // three independent tokens
    for (const k of keys) {
      const head = await env.MAPS.head(k);
      expect(head?.httpMetadata?.contentType).toBe(k.endsWith(".jpg") ? "image/jpeg" : "image/webp");
    }

    // The owner sees it on every owner surface
    const ev = panelEventResponseSchema.parse(await (await send(`/api/v1/panel/events/${id}`, { cookie: owner.session })).json()).event;
    expect(ev.cover).toEqual(cover);
    const prev = eventPreviewResponseSchema.parse(await (await send(`/api/v1/panel/events/${id}/preview`, { cookie: owner.session })).json());
    expect(prev.event.cover).toMatchObject({ url: cover.url, url800: cover.url800, focal: { x: 0.12, y: 1 } });
    expect(prev.event.tone).toBe(toneOf(id));

    // Draft: the owner gets the files with safe headers; anonymous and another organizer a plain 404 (never 401/403)
    const served = await send(cover.url, { cookie: owner.session });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("content-disposition")).toBe('inline; filename="cover.webp"');
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(served.headers.get("cross-origin-resource-policy")).toBe("same-site");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(served.headers.get("content-length")).toBe(String(fakeWebp(1200, 800).length));
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(fakeWebp(1200, 800));
    const small = await send(cover.url800, { cookie: owner.session });
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(fakeWebp(800, 533));
    const ogPath = `/media/${keys.find((k) => k.endsWith("-og.jpg"))}`;
    const og = await send(ogPath, { cookie: owner.session });
    expect(og.headers.get("content-type")).toBe("image/jpeg");
    expect(og.headers.get("content-disposition")).toBe('inline; filename="cover-og.jpg"');
    expect(og.headers.get("cross-origin-resource-policy")).toBe("cross-origin"); // link-preview crawlers embed it
    expect(og.headers.get("x-content-type-options")).toBe("nosniff");
    for (const who of [undefined, other.session]) {
      for (const path of [cover.url, cover.url800, ogPath]) {
        const denied = await send(path, { cookie: who });
        expect(denied.status).toBe(404);
        expect(denied.headers.get("cache-control")).toBe("no-store");
      }
    }

    // The type comes from what was stored at upload, never from an unexpected stored value
    await env.MAPS.put(cover.url.replace("/media/", ""), fakeWebp(1200, 800), { httpMetadata: { contentType: "text/html" } });
    expect((await send(cover.url, { cookie: owner.session })).headers.get("content-type")).toBe("image/webp");
  });

  it("accepts a JPEG pair: .jpg keys, image/jpeg stored and served, URLs pass the contract", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const jpegs = { full: fakeJpeg(1200, 800), small: fakeJpeg(800, 533) };

    const res = await put(id, owner, coverForm(jpegs));
    expect(res.status).toBe(200);
    const cover = panelCoverResponseSchema.parse(await res.json()).cover;
    expect(cover.url).toMatch(new RegExp(`^/media/covers/${id}/[0-9a-f]{32}-full\.jpg$`));
    expect(cover.url800).toMatch(new RegExp(`^/media/covers/${id}/[0-9a-f]{32}-800\.jpg$`));
    for (const k of await r2Keys(id)) expect((await env.MAPS.head(k))?.httpMetadata?.contentType).toBe(k.endsWith(".webp") ? "image/webp" : "image/jpeg");
    for (const url of [cover.url, cover.url800]) {
      const served = await send(url, { cookie: owner.session });
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toBe("image/jpeg");
    }

  });

  it("replaces the cover: the old objects are deleted only after the new row is live; identical bytes still get a new key", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const first = await uploadOk(id, owner);
    const firstKeys = await r2Keys(id);
    const second = await uploadOk(id, owner); // the very same bytes
    expect(second.url).not.toBe(first.url);
    expect(second.version).not.toBe(first.version);
    const secondKeys = await r2Keys(id);
    expect(secondKeys).toHaveLength(3);
    expect(secondKeys.filter((k) => firstKeys.includes(k))).toEqual([]); // nothing of the old set remains
    expect((await send(first.url, { cookie: owner.session })).status).toBe(404);
    expect((await send(second.url, { cookie: owner.session })).status).toBe(200);
    expect(await coverRows(id)).toBe(1);
  });

  it("changes only the focal point: new link-preview file, same WebP files, old JPEG deleted", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const before = await r2Keys(id);
    const t0 = await updatedAt(id);

    const res = await patch(id, owner, focalForm(cover.version, { fx: "0.256", fy: "0.75" }));
    expect(res.status).toBe(200);
    const next = panelCoverResponseSchema.parse(await res.json()).cover;
    expect(next).toMatchObject({ url: cover.url, url800: cover.url800, version: cover.version, focal: { x: 0.26, y: 0.75 } });
    const after = await r2Keys(id);
    expect(after).toHaveLength(3);
    const oldOg = before.find((k) => k.endsWith("-og.jpg"))!;
    expect(after).not.toContain(oldOg);
    expect(after.filter((k) => !k.endsWith("-og.jpg"))).toEqual(before.filter((k) => !k.endsWith("-og.jpg")));
    expect(await updatedAt(id)).toBeGreaterThan(t0);
    expect((await send(cover.url, { cookie: owner.session })).status).toBe(200);
  });

  it("a stale baseVersion is 409 cover_changed and writes nothing (no object, no row change, no quota)", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const keys = await r2Keys(id);
    const used = await quotaRows(owner);
    const t0 = await updatedAt(id);

    const res = await patch(id, owner, focalForm("0".repeat(32)));
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("cover_changed");
    expect(await r2Keys(id)).toEqual(keys);
    expect(await quotaRows(owner)).toBe(used);
    expect(await updatedAt(id)).toBe(t0);
    expect(panelCoverResponseSchema.parse(await (await patch(id, owner, focalForm(cover.version))).json()).cover.focal).toEqual({ x: 0.25, y: 0.75 });
  });

  it("the focal route needs an existing cover (404 cover_not_found)", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const res = await patch(id, owner, focalForm("a".repeat(32)));
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("cover_not_found");
    expect(await quotaRows(owner)).toBe(0);
  });

  it("removes the cover: row and objects gone, version bumped, 204 again when there is none", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const t0 = await updatedAt(id);
    const used = await quotaRows(owner);

    const res = await del(id, owner);
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await coverRows(id)).toBe(0);
    expect(await r2Keys(id)).toEqual([]);
    expect(await updatedAt(id)).toBeGreaterThan(t0);
    expect((await send(cover.url, { cookie: owner.session })).status).toBe(404);
    expect(panelEventResponseSchema.parse(await (await send(`/api/v1/panel/events/${id}`, { cookie: owner.session })).json()).event.cover).toBeNull();
    expect(await quotaRows(owner)).toBe(used); // removing costs no upload

    const t1 = await updatedAt(id);
    expect((await del(id, owner)).status).toBe(204); // idempotent
    expect(await updatedAt(id)).toBe(t1); // nothing changed, nothing bumped
  });

  it("works in every status (published edits need no re-review)", async () => {
    const owner = await newUser();
    for (const state of ["draft", "in_review", "published", "rejected", "unpublished_admin"]) {
      const { id } = await newEvent(owner);
      await setState(id, state);
      expect((await put(id, owner, coverForm())).status).toBe(200);
      expect(await coverRows(id)).toBe(1);
    }
  });
});

describe("who may touch the cover", () => {
  it("401 anonymous, 404 another organizer, a missing id and a demo event, 403 cross-site; nothing is written", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const keys = await r2Keys(id);

    for (const call of [
      (o: User | null, e = id) => put(e, o, coverForm()),
      (o: User | null, e = id) => patch(e, o, focalForm(cover.version)),
      (o: User | null, e = id) => del(e, o),
    ]) {
      expect((await call(null)).status).toBe(401);
      expect((await call(other)).status).toBe(404);
      expect((await errorOf(await call(other))).code).toBe("event_not_found");
      expect((await errorOf(await call(owner, "no-such-event"))).code).toBe("event_not_found");
      expect((await errorOf(await call(owner, "BAD_ID!"))).code).toBe("event_not_found");
      expect((await errorOf(await call(owner, "evt_tiny-fest"))).code).toBe("event_not_found"); // seeded demo event, no owner
    }
    for (const call of [
      (origin: string | null) => put(id, owner, coverForm(), { origin }),
      (origin: string | null) => patch(id, owner, focalForm(cover.version), { origin }),
      (origin: string | null) => del(id, owner, { origin }),
    ]) {
      expect((await errorOf(await call("https://evil.example"))).code).toBe("invalid_origin");
      expect((await call(null)).status).toBe(403);
    }
    expect(await r2Keys(id)).toEqual(keys);
    expect(await coverRows(id)).toBe(1);
    expect(await coverRows("evt_tiny-fest")).toBe(0);
  });

  it("the other organizer cannot delete or replace by guessing: still 404 after the owner's cover exists", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { id } = await newEvent(owner);
    await uploadOk(id, owner);
    const mine = await newEvent(other);
    expect((await put(id, other, coverForm())).status).toBe(404);
    expect((await del(id, other)).status).toBe(404);
    expect(await coverRows(id)).toBe(1);
    expect(await coverRows(mine.id)).toBe(0);
  });
});

describe("refusals store nothing and cost no quota", () => {
  const refuse = async (form: FormData, status: number, code: string, reason?: string) => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const res = await put(id, owner, form);
    expect(res.status).toBe(status);
    const err = await errorOf(res);
    expect(err.code).toBe(code);
    if (reason) expect(err.reason).toBe(reason);
    expect(await r2Keys(id)).toEqual([]);
    expect(await coverRows(id)).toBe(0);
    expect(await quotaRows(owner)).toBe(0);
  };

  it("the part allowlist and focal values: unknown, duplicate and missing parts, bad fx/fy", async () => {
    await refuse(coverForm({ extra: ["key", "covers/x"] }), 400, "invalid_upload", "unknown_part");
    await refuse(coverForm({ extra: ["fx", "0.1"] }), 400, "invalid_upload", "unknown_part"); // duplicate
    await refuse(coverForm({ extra: ["baseVersion", "a".repeat(32)] }), 400, "invalid_upload", "unknown_part"); // a PATCH part on PUT
    await refuse(coverForm({ omit: "full" }), 400, "invalid_upload", "missing_part");
    await refuse(coverForm({ omit: "small" }), 400, "invalid_upload", "missing_part");
    await refuse(coverForm({ omit: "og" }), 400, "invalid_upload", "missing_part");
    const asText = coverForm({ omit: "full" });
    asText.append("full", "not a file");
    await refuse(asText, 400, "invalid_upload", "missing_part");
    await refuse(coverForm({ omit: "fx" }), 400, "invalid_upload", "bad_focal");
    await refuse(coverForm({ fx: "1.5" }), 400, "invalid_upload", "bad_focal");
    await refuse(coverForm({ fy: "-0.1" }), 400, "invalid_upload", "bad_focal");
    await refuse(coverForm({ fx: "NaN" }), 400, "invalid_upload", "bad_focal");
    await refuse(coverForm({ fy: "0.12345" }), 400, "invalid_upload", "bad_focal");
  });

  it("content refusals at the route (type, metadata, dimensions) store nothing and cost no quota", async () => {
    await refuse(coverForm({ full: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>") }), 415, "unsupported_image_type");
    await refuse(coverForm({ full: fakeJpeg(1200, 800, { segments: [{ marker: 0xe1, payload: EXIF_GPS_PAYLOAD }] }), small: fakeJpeg(800, 533) }), 400, "invalid_upload", "metadata_present");
    await refuse(coverForm({ full: fakeWebp(1700, 1000) }), 400, "invalid_upload", "full_size_out_of_range");
  });

  it("per-file caps (600 / 200 / 300 KB) and the 1.25 MiB body limit are 413", async () => {
    await refuse(coverForm({ full: fakeWebp(1200, 800, { pad: 600 * 1024 }) }), 413, "payload_too_large");
    await refuse(coverForm({ small: fakeWebp(800, 533, { pad: 200 * 1024 }) }), 413, "payload_too_large");
    await refuse(coverForm({ og: fakeJpeg(1200, 630, { pad: 300 * 1024 }) }), 413, "payload_too_large");
    await refuse(coverForm({ full: fakeWebp(1200, 800, { pad: COVER_UPLOAD_BODY_LIMIT }) }), 413, "payload_too_large");
  });

  it("a non-multipart body is 415, and the carve-out does not widen the JSON routes", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    expect((await send(`/api/v1/panel/events/${id}/cover`, { method: "PUT", cookie: owner.session, json: { fx: 0.5 } })).status).toBe(415);
    // A multipart body on another panel route is still refused by the JSON-only rule, and big JSON keeps the 8 KB limit
    expect((await send(`/api/v1/panel/events/${id}`, { method: "PUT", cookie: owner.session, form: coverForm() })).status).toBe(415);
    const big = await send(`/api/v1/panel/events/${id}`, { method: "PUT", cookie: owner.session, json: { ...eventBody, description: "x".repeat(20_000) } });
    expect(big.status).toBe(413);
    // The focal route's smaller limit
    const cover = await uploadOk(id, owner);
    const tooBig = await patch(id, owner, focalForm(cover.version, { og: fakeJpeg(1200, 630, { pad: COVER_FOCAL_BODY_LIMIT }) }));
    expect(tooBig.status).toBe(413);
  });

  it("the focal route has its own allowlist and bad baseVersion shapes are bad_focal", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const used = await quotaRows(owner);
    const keys = await r2Keys(id);
    const check = async (form: FormData, status: number, reason: string) => {
      const res = await patch(id, owner, form);
      expect(res.status).toBe(status);
      expect((await errorOf(res)).reason).toBe(reason);
    };
    await check(focalForm(cover.version, { extra: ["full", "x"] }), 400, "unknown_part");
    await check(focalForm(cover.version, { extra: ["fx", "0.1"] }), 400, "unknown_part");
    await check(focalForm(cover.version, { omit: "og" }), 400, "missing_part");
    await check(focalForm(cover.version, { omit: "baseVersion" }), 400, "bad_focal");
    await check(focalForm("not-hex"), 400, "bad_focal");
    await check(focalForm(cover.version, { fx: "2" }), 400, "bad_focal");
    await check(focalForm(cover.version, { og: fakeJpeg(1200, 630, { progressive: true }) }), 400, "og_not_baseline");
    await check(focalForm(cover.version, { og: fakeJpeg(1200, 630, { segments: [{ marker: 0xfe, payload: [1, 2] }] }) }), 400, "metadata_present");
    expect((await patch(id, owner, focalForm(cover.version, { og: fakeWebp(1200, 630) }))).status).toBe(415);
    expect(await r2Keys(id)).toEqual(keys);
    expect(await quotaRows(owner)).toBe(used);
  });
});

describe("daily quota, shared with map uploads", () => {
  it("PUT and PATCH each claim one; DELETE claims none; at the cap they answer 429 with Retry-After and store nothing", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    expect(await quotaRows(owner)).toBe(1);
    expect((await patch(id, owner, focalForm(cover.version))).status).toBe(200);
    expect(await quotaRows(owner)).toBe(2);
    expect((await del(id, owner)).status).toBe(204);
    expect(await quotaRows(owner)).toBe(2);

    await env.DB.prepare("UPDATE upload_quota SET count = ?2 WHERE organizer_id = ?1").bind(owner.id, DAILY_UPLOAD_LIMIT).run();
    const res = await put(id, owner, coverForm());
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe("rate_limited");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(86_400);
    expect(await r2Keys(id)).toEqual([]);
    expect(await coverRows(id)).toBe(0);

    // The cap is the same counter the map upload uses: after a map upload used it up, a cover is refused too.
    expect((await del(id, owner)).status).toBe(204); // removing is still allowed
    const again = await newEvent(owner);
    expect((await put(again.id, owner, coverForm())).status).toBe(429);
  });

  it("a focal change at the cap is 429 and the stored cover is untouched", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const keys = await r2Keys(id);
    await env.DB.prepare("UPDATE upload_quota SET count = ?2 WHERE organizer_id = ?1").bind(owner.id, DAILY_UPLOAD_LIMIT).run();
    const res = await patch(id, owner, focalForm(cover.version));
    expect(res.status).toBe(429);
    expect(await r2Keys(id)).toEqual(keys);
  });
});

describe("per-minute limiter", () => {
  it("PUT and PATCH answer 429 with Retry-After 60 before touching anything; DELETE is not an upload", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const keys = await r2Keys(id);
    const used = await quotaRows(owner);
    const seen: string[] = [];
    limiter = { limit: async ({ key }) => (seen.push(key), { success: false }) };
    for (const res of [await put(id, owner, coverForm()), await patch(id, owner, focalForm(cover.version))]) {
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("60");
      expect((await errorOf(res)).code).toBe("rate_limited");
    }
    expect(seen).toEqual([owner.id, owner.id]); // keyed by the organizer, not the IP
    expect(await r2Keys(id)).toEqual(keys);
    expect(await quotaRows(owner)).toBe(used);
    expect((await del(id, owner)).status).toBe(204);
    limiter = { limit: async () => { throw new Error("limiter down"); } }; // fails open
    expect((await put(id, owner, coverForm())).status).toBe(200);
  });
});

describe("compare-and-swap", () => {
  const next = (id: string, n: string) => ({
    fullKey: `covers/${id}/${n}-full.webp`,
    fullWidth: 1200,
    fullHeight: 800,
    smallKey: `covers/${id}/${n}-800.webp`,
    smallWidth: 800,
    smallHeight: 533,
    ogKey: `covers/${id}/${n}-og.jpg`,
    focalX: 0.5,
    focalY: 0.5,
  });

  it("a switch succeeds only from the key it read; a racing or stale one changes nothing", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { id } = await newEvent(owner);
    const repo = new D1CoverRepository(env.DB);
    const a = next(id, "a".repeat(32));
    const b = next(id, "b".repeat(32));
    const c = next(id, "c".repeat(32));
    expect(await repo.switchTo(id, other.id, a, 1, null)).toBe(false); // not the owner
    expect(await repo.get(id)).toBeNull();
    expect(await repo.switchTo(id, owner.id, a, 1, null)).toBe(true); // first upload
    expect(await repo.switchTo(id, owner.id, b, 2, null)).toBe(false); // a row appeared meanwhile
    expect(await repo.switchTo(id, owner.id, b, 3, { fullKey: a.fullKey, ogKey: a.ogKey })).toBe(true);
    expect(await repo.switchTo(id, owner.id, c, 4, { fullKey: a.fullKey, ogKey: a.ogKey })).toBe(false); // lost the race
    expect((await repo.get(id))?.fullKey).toBe(b.fullKey);

    // The focal swap needs the current full key AND og key
    const ok = { fullKey: b.fullKey, previousOgKey: b.ogKey, ogKey: `covers/${id}/${"d".repeat(32)}-og.jpg`, focalX: 0.2, focalY: 0.3 };
    expect(await repo.refocus(id, owner.id, { ...ok, fullKey: a.fullKey }, 5)).toBe(false);
    expect(await repo.refocus(id, owner.id, { ...ok, previousOgKey: a.ogKey }, 5)).toBe(false);
    expect(await repo.refocus(id, other.id, ok, 5)).toBe(false);
    expect(await repo.refocus(id, owner.id, ok, 5)).toBe(true);
    expect(await repo.refocus(id, owner.id, ok, 6)).toBe(false); // og key moved on
  });

  it("a lost swap in the route deletes the new objects and answers 409 cover_changed", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    await uploadOk(id, owner);
    // Another request replaces the cover between this request's read and its switch: simulate by making `get` stale.
    const real = D1CoverRepository.prototype.get;
    const keysBefore = await r2Keys(id);
    D1CoverRepository.prototype.get = async function () {
      D1CoverRepository.prototype.get = real;
      const row = await real.call(this, id);
      return row && { ...row, fullKey: `covers/${id}/${"9".repeat(32)}-full.webp` }; // what an earlier snapshot would have said
    };
    try {
      const res = await put(id, owner, coverForm());
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("cover_changed");
    } finally {
      D1CoverRepository.prototype.get = real;
    }
    expect(await r2Keys(id)).toEqual(keysBefore); // the new objects were deleted, the live ones kept
    expect(await coverRows(id)).toBe(1);
  });
});

describe("media gating by status", () => {
  it("draft and unpublished: owner only; in review: owner and Admin; published: everyone, public cache", async () => {
    const owner = await newUser();
    const other = await newUser();
    const admin = await newUser("admin");
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    const urls = [cover.url, cover.url800, `/media/${(await r2Keys(id)).find((k) => k.endsWith("-og.jpg"))}`];
    const status = async (who: User | null, url = cover.url) => (await send(url, { cookie: who?.session })).status;

    for (const state of ["draft", "rejected", "unpublished_admin"]) {
      await setState(id, state);
      expect([await status(owner), await status(null), await status(other), await status(admin)]).toEqual([200, 404, 404, 404]);
    }
    await setState(id, "in_review");
    expect([await status(owner), await status(null), await status(other), await status(admin)]).toEqual([200, 404, 404, 200]);
    const reviewed = await send(cover.url, { cookie: admin.session });
    expect(reviewed.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");

    await setState(id, "published");
    for (const url of urls) {
      for (const who of [null, other, owner, admin]) expect(await status(who, url)).toBe(200);
      const anon = await send(url);
      expect(anon.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(anon.headers.get("set-cookie")).toBeNull();
    }
  });

  it("only the three keys of the row resolve, with a strict file name", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    await setState(id, "published");
    const hex = cover.version;
    const bad = [
      `/media/covers/${id}/${"0".repeat(32)}-full.webp`, // well formed but not referenced
      `/media/covers/${id}/${hex}-full.jpg`,
      `/media/covers/${id}/${hex}-800.jpg`,
      `/media/covers/${id}/${hex}-og.webp`,
      `/media/covers/${id}/${hex}-small.webp`,
      `/media/covers/${id}/${hex.toUpperCase()}-full.webp`,
      `/media/covers/${id}/${hex}-full.webp/x`,
      `/media/covers/${id}/${hex.slice(0, 31)}-full.webp`,
      `/media/covers/${id}/..%2F${hex}-full.webp`,
      `/media/covers/${id.toUpperCase()}/${hex}-full.webp`,
      `/media/covers/no-such-event/${hex}-full.webp`,
      `/media/maps/${id}/${hex}-full.webp`,
    ];
    for (const url of bad) {
      const res = await send(url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    // The same token under another event's id does not resolve either
    const other = await newUser();
    const mine = await newEvent(other);
    await setState(mine.id, "published");
    expect((await send(`/media/covers/${mine.id}/${hex}-full.webp`)).status).toBe(404);
    expect((await send(cover.url)).status).toBe(200);
  });
});

describe("public surfaces", () => {
  const preview = async (slug: string) => {
    const res = await app.fetch(new Request(`http://elsewhere.test/e/${slug}`), { DB: env.DB, ASSETS: { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } }) }, PUBLIC_ORIGIN: PUBLIC } as never);
    return res.text();
  };
  const metaContent = (html: string, selector: string) => new RegExp(`<meta ${selector} content="([^"]*)"`).exec(html)?.[1];

  it("a published event shows its cover in the Home list and the bundle, and the link preview uses the cover's og file, then the tone image after removal", async () => {
    const owner = await newUser();
    const { id, slug } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    await env.DB.batch([
      env.DB.prepare("UPDATE events SET publish_state = 'published' WHERE id = ?1").bind(id),
      env.DB.prepare(
        `INSERT INTO event_map_images (event_id, theme, format, full_key, full_width, full_height, small_key, small_width, small_height, created_at, updated_at)
         VALUES (?1, 'light', 'webp', ?2, 2400, 1800, ?3, 1200, 900, 0, 0)`,
      ).bind(id, `maps/${id}/${"1".repeat(32)}-full.webp`, `maps/${id}/${"1".repeat(32)}-small.webp`),
    ]);
    clearListEventsCache();
    clearEventPreviewCache();

    const list = eventListSchema.parse(await (await send("/api/v1/events")).json());
    const card = list.find((e) => e.slug === slug)!;
    expect(card.tone).toBe(toneOf(id));
    expect(card.cover).toEqual({ url: cover.url, url800: cover.url800, width: 1200, height: 800, focal: { x: 0.5, y: 0.5 } });
    expect(JSON.stringify(card)).not.toContain("-og.jpg");

    const bundle = mapBundleSchema.parse(await (await send(`/api/v1/events/${slug}/map-bundle`)).json());
    expect(bundle.event.cover?.url).toBe(cover.url);
    expect(bundle.event.tone).toBe(toneOf(id));

    const ogKey = (await r2Keys(id)).find((k) => k.endsWith("-og.jpg"))!;
    const html = await preview(slug);
    expect(metaContent(html, 'property="og:image"')).toBe(`${PUBLIC}/media/${ogKey}`);
    expect(metaContent(html, 'name="twitter:image"')).toBe(`${PUBLIC}/media/${ogKey}`);
    expect(metaContent(html, 'property="og:image:alt"')).toBe("Cover image for Cover Fest");
    expect(metaContent(html, 'property="og:url"')).toBe(`${PUBLIC}/e/${slug}`);

    // Removing the cover: the preview switches to the tone image (after the isolate cache, here cleared), the card to the tone cover
    expect((await del(id, owner)).status).toBe(204);
    clearEventPreviewCache();
    clearListEventsCache();
    expect(metaContent(await preview(slug), 'property="og:image"')).toBe(`${PUBLIC}/tone-og/${toneOf(id)}.jpg`);
    expect(eventListSchema.parse(await (await send("/api/v1/events")).json()).find((e) => e.slug === slug)!.cover).toBeNull();
  });

  it("an unpublished event's cover is not exposed by any public read", async () => {
    const owner = await newUser();
    const { id, slug } = await newEvent(owner);
    await uploadOk(id, owner);
    clearListEventsCache();
    expect(eventListSchema.parse(await (await send("/api/v1/events")).json()).map((e) => e.slug)).not.toContain(slug);
    expect((await send(`/api/v1/events/${slug}/map-bundle`)).status).toBe(404);
  });
});

describe("a cover change while In review", () => {
  it("bumps the event version, so a pending approval of the old version fails and the Admin sees the new image", async () => {
    const owner = await newUser();
    const admin = await newUser("admin");
    const { id } = await newEvent(owner);
    await setState(id, "in_review");
    const seen = adminReviewResponseSchema.parse(await (await send(`/api/v1/admin/events/${id}/review`, { cookie: admin.session })).json());
    expect(seen.event.cover).toBeNull();

    const cover = await uploadOk(id, owner);
    const stale = await send(`/api/v1/admin/events/${id}/approve`, { method: "POST", cookie: admin.session, json: { updatedAt: seen.review.updatedAt } });
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe("event_changed");

    const again = adminReviewResponseSchema.parse(await (await send(`/api/v1/admin/events/${id}/review`, { cookie: admin.session })).json());
    expect(again.event.cover?.url).toBe(cover.url);
    expect(again.review.updatedAt > seen.review.updatedAt).toBe(true);
    // Every cover write moves the version forward, even within the same millisecond
    const v1 = await updatedAt(id);
    expect((await patch(id, owner, focalForm(cover.version))).status).toBe(200);
    expect(await updatedAt(id)).toBeGreaterThan(v1);
  });
});

describe("hard delete", () => {
  it("removes the event, the cover row, every object under covers/{id}/ including orphans, and the URLs stop resolving", async () => {
    const owner = await newUser();
    const { id } = await newEvent(owner);
    const cover = await uploadOk(id, owner);
    await env.MAPS.put(`covers/${id}/${"a".repeat(32)}-full.webp`, new Uint8Array([1])); // an orphan
    await env.MAPS.put(`maps/${id}/${"b".repeat(32)}-full.webp`, new Uint8Array([1])); // the map prefix is still swept
    expect((await r2Keys(id)).length).toBe(4);

    expect((await send(`/api/v1/panel/events/${id}`, { method: "DELETE", cookie: owner.session })).status).toBe(204);
    expect(await r2Keys(id)).toEqual([]);
    expect((await env.MAPS.list({ prefix: `maps/${id}/` })).objects).toEqual([]);
    expect(await coverRows(id)).toBe(0);
    expect((await send(cover.url, { cookie: owner.session })).status).toBe(404);
  });
});

describe("seeded covers (R2 + event_covers, like an upload)", () => {
  it("the seed statements are idempotent and the demo event's cover is served publicly from R2 with focal (0.5, 0.5)", async () => {
    const seeds = [
      {
        source: "inline",
        format: "svg" as const,
        bytes: Buffer.from(""),
        hash8: "00000000",
        imageKey: "cover-demo.00000000.svg",
        cover: null,
        seed: {
          event: { slug: "cover-demo", name: "Cover Demo", dates: { start: "2026-07-10", end: "2026-07-12" }, city: "Testville", country: "IE", language: "en", mapTheme: "light" as const, timeZone: "Europe/Dublin", dayStart: "06:00" },
          map: { file: "x.svg", width: 200, height: 100 },
          points: [{ id: "wc", name: "Toilets", category: "toilets" as const, description: "", x: 0.1, y: 0.9 }],
          sessions: [],
        },
      },
    ];
    const webp = fakeWebp(960, 640);
    const plan = planSeedCover("cover-demo", { bytes: Buffer.from(webp), width: 960, height: 640, key: "unused" }, fakeJpeg(1200, 630));
    expect(plan.eventId).toBe("evt_cover-demo");
    await env.MAPS.put(plan.fullKey, webp, { httpMetadata: { contentType: "image/webp" } });
    await env.MAPS.put(plan.smallKey, webp, { httpMetadata: { contentType: "image/webp" } });
    await env.MAPS.put(plan.ogKey, fakeJpeg(1200, 630), { httpMetadata: { contentType: "image/jpeg" } });
    const run = () => env.DB.batch(buildSeedStatements(seeds, new Map([["cover-demo", plan]])).map((sql) => env.DB.prepare(sql)));
    await run();
    await run(); // re-seeding the same art changes nothing and does not fail
    clearListEventsCache();

    const tiny = eventListSchema.parse(await (await send("/api/v1/events")).json()).find((e) => e.slug === "cover-demo")!;
    expect(tiny.cover).toEqual({ url: `/media/${plan.fullKey}`, url800: `/media/${plan.smallKey}`, width: 960, height: 640, focal: { x: 0.5, y: 0.5 } });
    const res = await send(tiny.cover!.url800);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await coverRows("evt_cover-demo")).toBe(1);

    // Seeding without a cover removes the row again
    await env.DB.batch(buildSeedStatements(seeds).map((sql) => env.DB.prepare(sql)));
    expect(await coverRows("evt_cover-demo")).toBe(0);
    await env.MAPS.delete([plan.fullKey, plan.smallKey, plan.ogKey]);
  });
});
