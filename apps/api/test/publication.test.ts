import { env } from "cloudflare:workers";
import app from "../src/index";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminDecisionResponseSchema,
  adminPendingListResponseSchema,
  adminPublishedListResponseSchema,
  adminReviewResponseSchema,
  errorResponseSchema,
  eventListSchema,
  eventPreviewResponseSchema,
  mapBundleSchema,
  meResponseSchema,
  panelEventResponseSchema,
  panelMapResponseSchema,
} from "@atlas/contract";
import shellSource from "../../web/index.html?raw";
import { clearEventPreviewCache } from "../src/application/get-event-preview";
import { clearListEventsCache } from "../src/application/list-events";
import { pruneModeration } from "../src/application/prune";
import { randomToken, sha256Hex } from "../src/adapters/crypto";
import { fakeWebp } from "./map-fixtures";

const ORIGIN = "http://atlas.test";
const SHELL = shellSource.replaceAll("__PUBLIC_ORIGIN__", "https://atlas.test").replaceAll("__BRAND_CARD_URL__", "https://atlas.test/og/b.0badcafe.jpg");
const ASSETS = { fetch: async () => new Response(SHELL, { headers: { "Content-Type": "text/html; charset=utf-8" } }) };
const baseEnv = { ...env, ASSETS, PUBLIC_ORIGIN: "https://atlas.test" };

let ip = 0;
type Init = RequestInit & { cookie?: string; origin?: string | null; json?: unknown; form?: FormData; over?: Record<string, unknown> };
const call = (path: string, init: Init = {}) => {
  const { cookie, origin = ORIGIN, json, form, over, headers, ...rest } = init;
  const h: Record<string, string> = { "cf-connecting-ip": `192.0.2.${(ip++ % 250) + 1}`, ...(headers as Record<string, string>) };
  if (cookie) h.cookie = `__Host-atlas_session=${cookie}`;
  if (origin) h.origin = origin;
  let body = rest.body;
  if (json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
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
  const id = `org_pub${n}`;
  const session = randomToken();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizers (id, google_sub, email, display_name, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0)").bind(id, `pubsub${n}`, `pub${n}@example.com`, `Person ${n}`, role),
    env.DB.prepare("INSERT INTO sessions (token_hash, organizer_id, created_at, expires_at) VALUES (?1, ?2, 0, ?3)").bind(await sha256Hex(session), id, Date.now() + 3_600_000),
  ]);
  return { id, session };
}

const valid = { name: "Publish Fest", startDate: "2026-07-10", endDate: "2026-07-12", timeZone: "Europe/Dublin", city: "Galway", country: "IE", language: "en", description: "Come along." };
const create = async (o: User, over: Record<string, unknown> = {}) => {
  const res = await call("/api/v1/panel/events", { method: "POST", cookie: o.session, json: { ...valid, ...over } });
  expect(res.status).toBe(201);
  return panelEventResponseSchema.parse(await res.json()).event;
};

const blob = (b: Uint8Array) => new Blob([b as unknown as ArrayBuffer], { type: "image/webp" });
const uploadForm = (theme = "light", w = 2400) => {
  const f = new FormData();
  f.append("full", blob(fakeWebp(w, (w * 3) / 4))); // 4:3, like the small variant
  f.append("small", blob(fakeWebp(1200, 900)));
  f.append("theme", theme);
  return f;
};
const uploadMap = async (o: User, id: string, theme = "light", w = 2400) => {
  const res = await call(`/api/v1/panel/events/${id}/map`, { method: "POST", cookie: o.session, form: uploadForm(theme, w) });
  expect(res.status).toBe(200);
  // Slice 08c: publishing needs at least one Point. Direct insert, so the event version is untouched.
  await env.DB.prepare("INSERT OR IGNORE INTO event_points (event_id, id, category, name, description, x, y, created_at, updated_at) VALUES (?1, 'seed-point', 'stage', 'Main stage', '', 0.5, 0.5, 0, 0)").bind(id).run();
  return panelMapResponseSchema.parse(await res.json()).map;
};

const org = (o: User, id: string, action: "publish-request" | "withdraw" | "unpublish") =>
  call(`/api/v1/panel/events/${id}/${action}`, { method: "POST", cookie: o.session, json: {} });
const getEvent = async (o: User, id: string) => panelEventResponseSchema.parse(await (await call(`/api/v1/panel/events/${id}`, { cookie: o.session })).json()).event;
const review = async (a: User, id: string) => adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${id}/review`, { cookie: a.session })).json());
const approve = (a: User, id: string, updatedAt: string) => call(`/api/v1/admin/events/${id}/approve`, { method: "POST", cookie: a.session, json: { updatedAt } });
const reject = (a: User, id: string, reason?: unknown) => call(`/api/v1/admin/events/${id}/reject`, { method: "POST", cookie: a.session, json: reason === undefined ? {} : { reason } });
const adminUnpublish = (a: User, id: string, reason?: unknown) => call(`/api/v1/admin/events/${id}/unpublish`, { method: "POST", cookie: a.session, json: reason === undefined ? {} : { reason } });
const errorOf = async (res: Response) => errorResponseSchema.parse(await res.json()).error;
const publicReset = () => {
  clearEventPreviewCache();
  clearListEventsCache();
};

/** A draft with a map, ready to request. */
async function readyEvent(o: User, over: Record<string, unknown> = {}) {
  const ev = await create(o, over);
  const map = await uploadMap(o, ev.id);
  return { ev, map };
}
/** Requests publish and has the Admin approve it. */
async function publish(o: User, a: User, over: Record<string, unknown> = {}) {
  const { ev, map } = await readyEvent(o, over);
  expect((await org(o, ev.id, "publish-request")).status).toBe(200);
  const rv = await review(a, ev.id);
  const res = await approve(a, ev.id, rv.review.updatedAt);
  expect(res.status).toBe(200);
  publicReset();
  return { ev, map };
}
const audit = async (eventId: string) =>
  (await env.DB.prepare("SELECT actor_id, actor_role, action, from_state, to_state, reason FROM moderation_audit WHERE event_id = ?1 ORDER BY id").bind(eventId).all()).results;
const rows = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).all()).results;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM events WHERE slug != 'tiny-fest'").run();
  await env.DB.prepare("DELETE FROM moderation_audit").run();
  await env.DB.prepare("DELETE FROM transition_quota").run();
  publicReset();
});

describe("request -> approve -> public", () => {
  it("an approved event shows on the home, at /e/, in the bundle and in its media; nothing before approval", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev, map } = await readyEvent(o);

    // Request: In review, still not public anywhere
    const reqRes = await org(o, ev.id, "publish-request");
    expect(reqRes.status).toBe(200);
    expect(reqRes.headers.get("cache-control")).toBe("private, no-store");
    const requested = panelEventResponseSchema.parse(await reqRes.json()).event;
    expect(requested).toMatchObject({ status: "in_review", statusReason: null, approvedAt: null });
    expect(requested.requestedAt).not.toBeNull();
    publicReset();
    expect(eventListSchema.parse(await (await call("/api/v1/events")).json()).map((e) => e.slug)).not.toContain(ev.slug);
    expect((await call(`/e/${ev.slug}`)).status).toBe(404);
    expect((await call(`/api/v1/events/${ev.slug}/map-bundle`)).status).toBe(404);
    expect((await call(map.full.url)).status).toBe(404);

    // The Admin reviews and approves the exact version they saw
    const rv = await review(a, ev.id);
    expect(rv.review).toMatchObject({ id: ev.id, status: "in_review", editedSinceApproval: false, organizer: { displayName: expect.stringMatching(/^Person /), email: expect.stringMatching(/@example\.com$/) } });
    expect(rv.map?.image.variants.map((v) => v.width)).toEqual([1200, 2400]);
    const ok = await approve(a, ev.id, rv.review.updatedAt);
    expect(ok.status).toBe(200);
    const decision = adminDecisionResponseSchema.parse(await ok.json());
    expect(decision.event).toMatchObject({ id: ev.id, status: "published" });
    expect(decision.event.approvedAt).not.toBeNull();
    expect(decision.pendingCount).toBe(0);
    publicReset();

    // Now public
    const list = eventListSchema.parse(await (await call("/api/v1/events")).json());
    expect(list.map((e) => e.slug)).toContain(ev.slug);
    const page = await call(`/e/${ev.slug}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Publish Fest</title>");
    const bundleRes = await call(`/api/v1/events/${ev.slug}/map-bundle`);
    expect(bundleRes.status).toBe(200);
    const bundle = mapBundleSchema.parse(await bundleRes.json());
    expect(bundle.map).toMatchObject({ id: ev.id, theme: "light", width: 2400, image: { format: "webp" } });
    expect(bundle.map.image.variants.map((v) => v.url)).toEqual([map.small.url, map.full.url]);
    const img = await call(map.full.url);
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    // No organizer data anywhere public (AC 23)
    const publicText = JSON.stringify(list) + (await (await call(`/api/v1/events/${ev.slug}/map-bundle`)).text()) + (await (await call(`/e/${ev.slug}`)).text());
    expect(publicText).not.toContain("example.com");
    expect(publicText).not.toContain("Person ");
    expect(publicText).not.toContain(o.id);

    // The organizer sees Published
    expect(await getEvent(o, ev.id)).toMatchObject({ status: "published", statusReason: null });
    expect((await getEvent(o, ev.id)).approvedAt).not.toBeNull();
    expect(await audit(ev.id)).toEqual([
      { actor_id: o.id, actor_role: "organizer", action: "request", from_state: "draft", to_state: "in_review", reason: null },
      { actor_id: a.id, actor_role: "admin", action: "approve", from_state: "in_review", to_state: "published", reason: null },
    ]);
  });

  it("request needs a map, and re-validates the stored fields", async () => {
    const o = await newUser("organizer");
    const ev = await create(o);
    const noMap = await org(o, ev.id, "publish-request");
    expect(noMap.status).toBe(409);
    expect((await errorOf(noMap)).code).toBe("map_required");
    await uploadMap(o, ev.id);

    // Stored text that no longer passes (a soft hyphen smuggled past an older version) is refused with field codes only
    await env.DB.prepare("UPDATE events SET name = ?2 WHERE id = ?1").bind(ev.id, "Publish­Fest").run();
    const bad = await org(o, ev.id, "publish-request");
    expect(bad.status).toBe(400);
    const err = await errorOf(bad);
    expect(err.code).toBe("validation_error");
    expect(err.fields).toContainEqual({ path: "name", code: "control_chars" });
    expect((await getEvent(o, ev.id)).status).toBe("draft");
    expect(await audit(ev.id)).toEqual([]);
  });

  it("approve refuses an event whose map vanished (map_required) and an unchanged-state replay (invalid_transition)", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const rv = await review(a, ev.id);
    await env.DB.prepare("DELETE FROM event_map_images WHERE event_id = ?1").bind(ev.id).run();
    expect((await errorOf(await approve(a, ev.id, rv.review.updatedAt))).code).toBe("map_required");
    expect((await getEvent(o, ev.id)).status).toBe("in_review");
  });
});

describe("reject, withdraw, unpublish and request again", () => {
  it("reject keeps a cleaned reason for the owner, who can edit and request again", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const res = await reject(a, ev.id, "  Needs   a <real> description\n ");
    expect(res.status).toBe(200);
    expect(adminDecisionResponseSchema.parse(await res.json())).toMatchObject({ event: { status: "rejected", approvedAt: null }, pendingCount: 0 });
    expect(await getEvent(o, ev.id)).toMatchObject({ status: "rejected", statusReason: "Needs a real description" });
    expect((await call(`/e/${ev.slug}`)).status).toBe(404);

    // Edit, then ask again: In review, the old reason is cleared
    const put = await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, description: "A proper description." } });
    expect(put.status).toBe(200);
    const again = await org(o, ev.id, "publish-request");
    expect(panelEventResponseSchema.parse(await again.json()).event).toMatchObject({ status: "in_review", statusReason: null });
    expect((await audit(ev.id)).map((r) => `${r.action}:${r.reason ?? "-"}`)).toEqual(["request:-", "reject:Needs a real description", "request:-"]);
  });

  it("reject without a reason, and a reason over 200 code points is a 400 that changes nothing", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const long = await reject(a, ev.id, "x".repeat(201));
    expect(long.status).toBe(400);
    expect((await errorOf(long)).fields).toEqual([{ path: "reason", code: "too_long" }]);
    expect((await getEvent(o, ev.id)).status).toBe("in_review");
    expect((await reject(a, ev.id)).status).toBe(200);
    expect((await getEvent(o, ev.id)).statusReason).toBeNull();
  });

  it("withdraw goes back to draft and leaves the Pending list; withdraw from draft is a 409", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const pending = adminPendingListResponseSchema.parse(await (await call("/api/v1/admin/events/pending", { cookie: a.session })).json());
    expect(pending.events.map((e) => e.id)).toContain(ev.id);
    expect(pending.total).toBeGreaterThanOrEqual(1);
    const w = await org(o, ev.id, "withdraw");
    expect(panelEventResponseSchema.parse(await w.json()).event).toMatchObject({ status: "draft", requestedAt: null });
    const after = adminPendingListResponseSchema.parse(await (await call("/api/v1/admin/events/pending", { cookie: a.session })).json());
    expect(after.events.map((e) => e.id)).not.toContain(ev.id);
    const again = await org(o, ev.id, "withdraw");
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe("invalid_transition");
  });

  it("the organizer unpublishes to draft; the Admin unpublishes with a reason; both leave the home and need approval again", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const first = await publish(o, a, { name: "Own Unpublish" });
    expect((await org(o, first.ev.id, "unpublish")).status).toBe(200);
    expect(await getEvent(o, first.ev.id)).toMatchObject({ status: "draft", approvedAt: null, requestedAt: null });
    publicReset();
    expect((await call(`/e/${first.ev.slug}`)).status).toBe(404);
    expect(eventListSchema.parse(await (await call("/api/v1/events")).json()).map((e) => e.slug)).not.toContain(first.ev.slug);

    const second = await publish(o, a, { name: "Admin Unpublish" });
    const res = await adminUnpublish(a, second.ev.id, "Reported by a visitor");
    expect(adminDecisionResponseSchema.parse(await res.json()).event.status).toBe("unpublished_admin");
    publicReset();
    expect(await getEvent(o, second.ev.id)).toMatchObject({ status: "unpublished_admin", statusReason: "Reported by a visitor", approvedAt: null });
    expect((await call(`/e/${second.ev.slug}`)).status).toBe(404);
    expect((await call(second.map.full.url)).status).toBe(404);

    // No direct republish: both go to In review
    expect(panelEventResponseSchema.parse(await (await org(o, second.ev.id, "publish-request")).json()).event.status).toBe("in_review");
    expect(panelEventResponseSchema.parse(await (await org(o, first.ev.id, "publish-request")).json()).event.status).toBe("in_review");
    expect((await call(`/e/${second.ev.slug}`)).status).toBe(404);
  });
});

describe("races and the content version", () => {
  it("withdraw and approve at the same moment: exactly one wins, the other is a 409, nothing half-done", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    for (let i = 0; i < 4; i++) {
      const { ev } = await readyEvent(o, { name: `Race ${i}` });
      await org(o, ev.id, "publish-request");
      const rv = await review(a, ev.id);
      const [w, ap] = await Promise.all([org(o, ev.id, "withdraw"), approve(a, ev.id, rv.review.updatedAt)]);
      const statuses = [w.status, ap.status].sort();
      expect(statuses, `round ${i}`).toEqual([200, 409]);
      const final = (await getEvent(o, ev.id)).status;
      expect(final).toBe(w.status === 200 ? "draft" : "published");
      // The audit trail has the request plus exactly one outcome
      expect((await audit(ev.id)).map((r) => r.action)).toEqual(["request", w.status === 200 ? "withdraw" : "approve"]);
      const loser = w.status === 200 ? ap : w;
      expect((await errorOf(loser)).code).toBe("invalid_transition");
      await call(`/api/v1/panel/events/${ev.id}`, { method: "DELETE", cookie: o.session }); // keep under the 10-event cap
    }
  });

  it("approve after an edit is refused as event_changed; the Admin reloads and approves the new version", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const seen = await review(a, ev.id);

    await new Promise((r) => setTimeout(r, 5)); // a later millisecond for the new version
    await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, name: "Changed After Review" } });
    const stale = await approve(a, ev.id, seen.review.updatedAt);
    expect(stale.status).toBe(409);
    expect((await errorOf(stale)).code).toBe("event_changed");
    expect((await getEvent(o, ev.id)).status).toBe("in_review");

    const fresh = await review(a, ev.id);
    expect(fresh.event.name).toBe("Changed After Review");
    expect(fresh.review.updatedAt).not.toBe(seen.review.updatedAt);
    expect((await approve(a, ev.id, fresh.review.updatedAt)).status).toBe(200);
  });

  it("a map replace or a theme change while In review also counts as a new version", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const seen = await review(a, ev.id);
    await new Promise((r) => setTimeout(r, 5));
    const theme = await call(`/api/v1/panel/events/${ev.id}/map/theme`, { method: "PATCH", cookie: o.session, json: { theme: "dark" } });
    expect(theme.status).toBe(200);
    expect((await errorOf(await approve(a, ev.id, seen.review.updatedAt))).code).toBe("event_changed");
    const second = await review(a, ev.id);
    await new Promise((r) => setTimeout(r, 5));
    await uploadMap(o, ev.id, "dark", 2000);
    expect((await errorOf(await approve(a, ev.id, second.review.updatedAt))).code).toBe("event_changed");
    expect((await approve(a, ev.id, (await review(a, ev.id)).review.updatedAt)).status).toBe(200);
  });

  it("edits on a published event stay public with no re-review and raise the 'edited since approval' flag", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev, map } = await publish(o, a);
    const flag = async () => adminPublishedListResponseSchema.parse(await (await call("/api/v1/admin/events/published?limit=100", { cookie: a.session })).json()).events.find((e) => e.id === ev.id)!;
    expect(await flag()).toMatchObject({ status: "published", editedSinceApproval: false });

    await new Promise((r) => setTimeout(r, 5));
    expect((await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, name: "Edited While Live" } })).status).toBe(200);
    const next = await uploadMap(o, ev.id, "dark", 2200);
    expect(next.full.url).not.toBe(map.full.url);
    publicReset();

    expect((await getEvent(o, ev.id)).status).toBe("published");
    expect(await (await call(`/e/${ev.slug}`)).text()).toContain("<title>Edited While Live</title>");
    const bundle = mapBundleSchema.parse(await (await call(`/api/v1/events/${ev.slug}/map-bundle`)).json());
    expect(bundle.map.width).toBe(2200);
    expect(await flag()).toMatchObject({ editedSinceApproval: true });
    // The old image is gone, the new one is public
    expect((await call(map.full.url)).status).toBe(404);
    expect((await call(next.full.url)).status).toBe(200);
  });
});

describe("legacy rows with empty city/country", () => {
  it("owner preview and Admin review still parse with the contract and omit city and country", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    await env.DB.prepare("UPDATE events SET city = '', country = '' WHERE id = ?1").bind(ev.id).run();

    const prev = eventPreviewResponseSchema.parse(await (await call(`/api/v1/panel/events/${ev.id}/preview`, { cookie: o.session })).json());
    const rv = adminReviewResponseSchema.parse(await (await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: a.session })).json());
    for (const e of [prev.event, rv.event]) {
      expect(e).not.toHaveProperty("city");
      expect(e).not.toHaveProperty("country");
    }
  });
});

describe("who may do what", () => {
  it("an organizer gets 403 on every Admin event route, anonymous gets 401, and nothing changes", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const rv = await review(a, ev.id);

    const attempts: [string, string, unknown?][] = [
      ["GET", "/api/v1/admin/events/pending"],
      ["GET", "/api/v1/admin/events/published"],
      ["GET", `/api/v1/admin/events/${ev.id}/review`],
      ["POST", `/api/v1/admin/events/${ev.id}/approve`, { updatedAt: rv.review.updatedAt }],
      ["POST", `/api/v1/admin/events/${ev.id}/reject`, {}],
      ["POST", `/api/v1/admin/events/${ev.id}/unpublish`, {}],
    ];
    for (const [method, path, json] of attempts) {
      const asOrganizer = await call(path, { method, cookie: o.session, json });
      expect(asOrganizer.status, `${method} ${path}`).toBe(403);
      expect((await errorOf(asOrganizer)).code).toBe("forbidden");
      expect((await call(path, { method, json })).status, `anon ${method} ${path}`).toBe(401);
    }
    expect((await getEvent(o, ev.id)).status).toBe("in_review"); // an organizer cannot approve their own event
    expect(await audit(ev.id)).toHaveLength(1);
  });

  it("an organizer cannot publish by any panel route, and transitions of someone else's event are the same 404 as a missing one", async () => {
    const o = await newUser("organizer");
    const other = await newUser("organizer");
    const { ev } = await readyEvent(o);
    // The PUT edit cannot smuggle a state
    const put = await call(`/api/v1/panel/events/${ev.id}`, { method: "PUT", cookie: o.session, json: { ...valid, status: "published", publishState: "published" } });
    expect(put.status).toBe(400);
    for (const action of ["publish-request", "withdraw", "unpublish"] as const) {
      const theirs = await org(other, ev.id, action);
      const missing = await org(other, "no-such-event", action);
      expect(theirs.status).toBe(404);
      expect(await theirs.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: "event_not_found" }) }));
      expect(missing.status).toBe(404);
    }
    expect((await getEvent(o, ev.id)).status).toBe("draft");
    const bad = await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, json: { status: "published" } });
    expect(bad.status).toBe(400);
    expect((await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, origin: "https://evil.example", json: {} })).status).toBe(403);
    expect((await call(`/api/v1/panel/events/${ev.id}/publish-request`, { method: "POST", cookie: o.session, headers: { "content-type": "text/plain" }, body: "{}" })).status).toBe(415);
  });

  it("the Admin cannot review a draft or rejected event, and a missing event is the same 404", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    expect((await call(`/api/v1/admin/events/${ev.id}/review`, { cookie: a.session })).status).toBe(404);
    expect((await call(`/api/v1/admin/events/nope/review`, { cookie: a.session })).status).toBe(404);
    expect((await errorOf(await reject(a, ev.id))).code).toBe("invalid_transition"); // exists but is a draft
    expect((await errorOf(await adminUnpublish(a, "nope"))).code).toBe("event_not_found");
  });

  it("pendingCount on /auth/me is for admins only", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    const adminMe = meResponseSchema.parse(await (await call("/api/v1/auth/me", { cookie: a.session })).json());
    expect(adminMe.pendingCount).toBe(1);
    const orgMe = meResponseSchema.parse(await (await call("/api/v1/auth/me", { cookie: o.session })).json());
    expect(orgMe.pendingCount).toBeUndefined();
    const pending = adminPendingListResponseSchema.parse(await (await call("/api/v1/admin/events/pending", { cookie: a.session })).json());
    expect(pending).toMatchObject({ total: 1, nextCursor: null });
    expect(pending.events[0]).toMatchObject({ id: ev.id, status: "in_review", organizer: { email: expect.stringContaining("@") } });
  });

  it("Pending is oldest request first and pages with a cursor", async () => {
    const a = await newUser("admin");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await newUser("organizer");
      const { ev } = await readyEvent(o, { name: `Queue ${i}` });
      await org(o, ev.id, "publish-request");
      await env.DB.prepare("UPDATE events SET requested_at = ?2 WHERE id = ?1").bind(ev.id, 1000 + (2 - i)).run(); // reversed: the last created is the oldest request
      ids.push(ev.id);
    }
    const first = adminPendingListResponseSchema.parse(await (await call("/api/v1/admin/events/pending?limit=2", { cookie: a.session })).json());
    expect(first.events.map((e) => e.id)).toEqual([ids[2]!, ids[1]!]);
    expect(first.total).toBe(3);
    expect(first.nextCursor).not.toBeNull();
    const second = adminPendingListResponseSchema.parse(await (await call(`/api/v1/admin/events/pending?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`, { cookie: a.session })).json());
    expect(second.events.map((e) => e.id)).toEqual([ids[0]!]);
    expect(second.nextCursor).toBeNull();
    for (const bad of ["limit=0", "limit=101", "limit=abc", "cursor=%27%3B--", "x=1"]) {
      expect((await call(`/api/v1/admin/events/pending?${bad}`, { cookie: a.session })).status, bad).toBe(400);
    }
  });
});

describe("the unavailable response is identical for every non-public slug", () => {
  it("never existed, draft, in review, rejected, unpublished and deleted all answer the same", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const mk = async (name: string, to: "draft" | "in_review" | "rejected" | "unpublished_admin" | "deleted") => {
      const { ev } = await readyEvent(o, { name });
      if (to === "draft") return ev;
      await org(o, ev.id, "publish-request");
      if (to === "rejected") await reject(a, ev.id, "no");
      if (to === "unpublished_admin") {
        await approve(a, ev.id, (await review(a, ev.id)).review.updatedAt);
        await adminUnpublish(a, ev.id, "no");
      }
      if (to === "deleted") await call(`/api/v1/panel/events/${ev.id}`, { method: "DELETE", cookie: o.session });
      return ev;
    };
    const slugs = [
      "never-existed-abc123",
      (await mk("State Draft", "draft")).slug,
      (await mk("State Review", "in_review")).slug,
      (await mk("State Rejected", "rejected")).slug,
      (await mk("State Unpub", "unpublished_admin")).slug,
      (await mk("State Deleted", "deleted")).slug,
    ];
    publicReset();
    const snap = async (res: Response) => ({ status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() });
    // Also with the owner's and the Admin's session: no branch on who asks
    const variants = [undefined, o.session, a.session];
    const baseline = await snap(await call(`/e/${slugs[0]}`));
    expect(baseline.status).toBe(404);
    const get = (h: [string, string][], k: string) => h.find(([n]) => n === k)?.[1];
    expect(get(baseline.headers, "cache-control")).toBe("public, max-age=30");
    expect(get(baseline.headers, "x-robots-tag")).toBe("noindex");
    expect(baseline.body).toContain('<meta name="robots" content="noindex">');
    for (const slug of slugs) {
      for (const cookie of variants) {
        const got = await snap(await call(`/e/${slug}`, { cookie }));
        expect(got, `${slug} ${cookie ? "with session" : "anonymous"}`).toEqual(baseline);
      }
    }
    // The bundle 404 is identical too
    const bundleBaseline = await snap(await call(`/api/v1/events/${slugs[0]}/map-bundle`));
    expect(bundleBaseline.status).toBe(404);
    for (const slug of slugs) {
      const got = await snap(await call(`/api/v1/events/${slug}/map-bundle`));
      // The error body carries a per-request id: compare without it
      expect({ ...got, body: got.body.replace(/"requestId":"[^"]*"/, "") }).toEqual({ ...bundleBaseline, body: bundleBaseline.body.replace(/"requestId":"[^"]*"/, "") });
    }
  });
});

describe("map images by status (/media)", () => {
  it("published: anyone, public cache. Otherwise: the owner always, the Admin only while In review, nobody else", async () => {
    const o = await newUser("organizer");
    const other = await newUser("organizer");
    const a = await newUser("admin");
    const { ev, map } = await readyEvent(o);
    const fetchAs = async (who: User | null) => call(map.full.url, { cookie: who?.session });
    const expectAccess = async (label: string, want: { anon: boolean; other: boolean; admin: boolean; owner: boolean }, cacheable: boolean) => {
      const results = { anon: await fetchAs(null), other: await fetchAs(other), admin: await fetchAs(a), owner: await fetchAs(o) };
      for (const [who, res] of Object.entries(results)) {
        expect(res.status, `${label}: ${who}`).toBe(want[who as keyof typeof want] ? 200 : 404);
        if (res.status === 200) {
          await res.arrayBuffer();
          expect(res.headers.get("cache-control"), `${label}: ${who}`).toBe(cacheable ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable");
        } else {
          expect(res.headers.get("cache-control")).toBe("no-store");
          await res.arrayBuffer();
        }
      }
    };

    await expectAccess("draft", { anon: false, other: false, admin: false, owner: true }, false);
    await org(o, ev.id, "publish-request");
    await expectAccess("in_review", { anon: false, other: false, admin: true, owner: true }, false);
    await reject(a, ev.id);
    await expectAccess("rejected", { anon: false, other: false, admin: false, owner: true }, false);
    await org(o, ev.id, "publish-request");
    await approve(a, ev.id, (await review(a, ev.id)).review.updatedAt);
    await expectAccess("published", { anon: true, other: true, admin: true, owner: true }, true);
    await adminUnpublish(a, ev.id);
    await expectAccess("unpublished_admin", { anon: false, other: false, admin: false, owner: true }, false);
  });

  it("the per-IP MEDIA_LIMITER answers 429 before any D1 read, and fails open", async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const prepare = vi.fn(() => {
      throw new Error("D1 must not be read");
    });
    const res = await call(`/media/maps/evt-x/${"a".repeat(32)}-full.webp`, { over: { MEDIA_LIMITER: limiter, DB: { prepare } }, headers: { "cf-connecting-ip": "198.51.100.77" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(prepare).not.toHaveBeenCalled();
    expect(limiter.limit).toHaveBeenCalledWith({ key: "198.51.100.77" });

    const broken = { limit: async () => { throw new Error("down"); } };
    expect((await call(`/media/maps/evt-x/${"a".repeat(32)}-full.webp`, { over: { MEDIA_LIMITER: broken } })).status).toBe(404);
  });

  it("ADMIN_LIMITER is keyed by the Admin user and does not apply to the invite routes' IP limiter", async () => {
    const a = await newUser("admin");
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const res = await call("/api/v1/admin/events/pending", { cookie: a.session, over: { ADMIN_LIMITER: limiter } });
    expect(res.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: a.id });
    // The IP limiter (10/min) is not on the moderation routes...
    const authLimiter = { limit: vi.fn(async () => ({ success: false })) };
    expect((await call("/api/v1/admin/events/pending", { cookie: a.session, over: { AUTH_LIMITER: authLimiter } })).status).toBe(200);
    expect(authLimiter.limit).not.toHaveBeenCalled();
    // ...but it stays on the invites
    expect((await call("/api/v1/admin/invites", { cookie: a.session, over: { AUTH_LIMITER: authLimiter } })).status).toBe(429);
  });
});

describe("daily transition cap", () => {
  it("refuses transitions once an organizer used 30 today, without changing the event or the audit log", async () => {
    const o = await newUser("organizer");
    const { ev } = await readyEvent(o);
    await env.DB.prepare("INSERT INTO transition_quota (organizer_id, day, count) VALUES (?1, ?2, 29)").bind(o.id, new Date().toISOString().slice(0, 10)).run();
    expect((await org(o, ev.id, "publish-request")).status).toBe(200); // the 30th
    const capped = await org(o, ev.id, "withdraw");
    expect(capped.status).toBe(429);
    expect((await errorOf(capped)).code).toBe("transition_cap_reached");
    expect(Number(capped.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await getEvent(o, ev.id)).status).toBe("in_review");
    expect((await audit(ev.id)).map((r) => r.action)).toEqual(["request"]);
    expect(await rows("SELECT count FROM transition_quota WHERE organizer_id = ?1", o.id)).toEqual([{ count: 30 }]);
  });

  it("counts successful organizer transitions only, per organizer; an Admin decision does not count", async () => {
    const o = await newUser("organizer");
    const p = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    await org(o, ev.id, "publish-request");
    await org(o, ev.id, "unpublish"); // refused (409): not counted
    await org(o, ev.id, "withdraw");
    await org(o, "nope", "withdraw"); // refused (404): not counted
    expect(await rows("SELECT organizer_id, count FROM transition_quota")).toEqual([{ organizer_id: o.id, count: 2 }]);
    await org(o, ev.id, "publish-request");
    await approve(a, ev.id, (await review(a, ev.id)).review.updatedAt);
    expect(await rows("SELECT count FROM transition_quota WHERE organizer_id = ?1", o.id)).toEqual([{ count: 3 }]);
    expect(await rows("SELECT 1 FROM transition_quota WHERE organizer_id = ?1", p.id)).toEqual([]);
  });
});

describe("audit log and prune", () => {
  it("records who, what, from and to, reason and time in the same batch as each transition", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await publish(o, a);
    await adminUnpublish(a, ev.id, "Spam");
    await org(o, ev.id, "publish-request");
    await org(o, ev.id, "withdraw");
    const log = await rows("SELECT actor_id, actor_role, action, from_state, to_state, reason, created_at FROM moderation_audit WHERE event_id = ?1 ORDER BY id", ev.id);
    expect(log.map((r) => [r.actor_role, r.action, `${r.from_state}>${r.to_state}`, r.reason])).toEqual([
      ["organizer", "request", "draft>in_review", null],
      ["admin", "approve", "in_review>published", null],
      ["admin", "admin_unpublish", "published>unpublished_admin", "Spam"],
      ["organizer", "request", "unpublished_admin>in_review", null],
      ["organizer", "withdraw", "in_review>draft", null],
    ]);
    expect(log.every((r) => typeof r.created_at === "number" && (r.created_at as number) > 1_700_000_000_000)).toBe(true);
    expect(log.map((r) => r.actor_id)).toEqual([o.id, a.id, a.id, o.id, o.id]);
    // No IP, no user agent: the table has no such column
    const cols = (await rows("SELECT name FROM pragma_table_info('moderation_audit')")).map((r) => r.name);
    expect(cols).not.toContain("ip");
    expect(cols.join(",")).not.toMatch(/agent|address/);
    // Failed attempts leave no trace
    await org(o, ev.id, "withdraw");
    expect(await audit(ev.id)).toHaveLength(5);
  });

  it("the daily prune deletes audit rows older than 365 days and old quota rows, and nothing else", async () => {
    const o = await newUser("organizer");
    const now = Date.UTC(2026, 10, 14, 3, 17);
    const day = 86_400_000;
    const ins = env.DB.prepare("INSERT INTO moderation_audit (event_id, actor_id, actor_role, action, from_state, to_state, reason, created_at) VALUES ('e', 'a', 'admin', 'approve', 'in_review', 'published', NULL, ?1)");
    await env.DB.batch([ins.bind(now - 366 * day), ins.bind(now - 365 * day - 1), ins.bind(now - 364 * day), ins.bind(now)]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO transition_quota (organizer_id, day, count) VALUES (?1, '2026-11-12', 3)").bind(o.id),
      env.DB.prepare("INSERT INTO transition_quota (organizer_id, day, count) VALUES (?1, '2026-11-14', 1)").bind(o.id),
    ]);
    expect(await pruneModeration(env.DB, now)).toEqual({ audit: 2, quota: 1 });
    expect((await rows("SELECT created_at FROM moderation_audit ORDER BY created_at")).map((r) => r.created_at)).toEqual([now - 364 * day, now]);
    expect(await rows("SELECT day FROM transition_quota")).toEqual([{ day: "2026-11-14" }]);
  });

  it("the Worker exports a scheduled handler that runs the prune", async () => {
    const mod = (await import("../src/index")).default;
    expect(typeof mod.scheduled).toBe("function");
    const old = Date.now() - 400 * 86_400_000;
    await env.DB.prepare("INSERT INTO moderation_audit (event_id, actor_id, actor_role, action, from_state, to_state, reason, created_at) VALUES ('e', 'a', 'admin', 'approve', 'in_review', 'published', NULL, ?1)").bind(old).run();
    const waits: Promise<unknown>[] = [];
    await mod.scheduled({} as ScheduledController, env as never, { waitUntil: (p: Promise<unknown>) => waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
    await Promise.all(waits);
    expect(await rows("SELECT 1 FROM moderation_audit WHERE created_at = ?1", old)).toEqual([]);
  });
});

describe("map and theme edits in every status", () => {
  it("replace and theme work while In review and Published, and bump the content version", async () => {
    const o = await newUser("organizer");
    const a = await newUser("admin");
    const { ev } = await readyEvent(o);
    const version = async () => (await env.DB.prepare("SELECT updated_at FROM events WHERE id = ?1").bind(ev.id).first<{ updated_at: number }>())!.updated_at;
    await org(o, ev.id, "publish-request");
    const v0 = await version();
    await new Promise((r) => setTimeout(r, 5));
    expect((await call(`/api/v1/panel/events/${ev.id}/map/theme`, { method: "PATCH", cookie: o.session, json: { theme: "dark" } })).status).toBe(200);
    const v1 = await version();
    expect(v1).toBeGreaterThan(v0);
    await approve(a, ev.id, (await review(a, ev.id)).review.updatedAt);
    await new Promise((r) => setTimeout(r, 5));
    await uploadMap(o, ev.id, "light", 2300);
    expect(await version()).toBeGreaterThan(v1);
    expect(await rows("SELECT publish_state FROM events WHERE id = ?1", ev.id)).toEqual([{ publish_state: "published" }]);
  });
});
