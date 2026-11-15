import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  POINTS_SAVE_BODY_LIMIT,
  eventInputSchema,
  publishActionRequestSchema,
  savePointsRequestSchema,
  toFieldErrors,
  toPointFieldErrors,
  type PanelEventListResponse,
  type PanelEventResponse,
  type PanelPointsResponse,
  type SavePointsResponse,
} from "@atlas/contract";
import { ChangesMismatchError, D1EventPointsRepository } from "../adapters/d1-event-points-repository";
import { diffPoints, isEmptyDiff } from "../domain/points-diff";
import { sortPoints } from "../domain/map-bundle";
import { D1PanelEventRepository, type OwnedEvent } from "../adapters/d1-panel-event-repository";
import { D1PublicationRepository } from "../adapters/d1-publication-repository";
import { runTransition } from "../application/publication";
import type { PublishAction } from "../domain/publication";
import { logPublication, refusalResponse } from "./publication-http";
import { toPreviewBody } from "./preview-body";
import { generateSlug } from "../domain/slug";
import { errorResponse } from "./errors";
import { guardMutations, guardOrigin, limitBody, requireAuth } from "./auth-routes";
import { deleteEventMapObjects, registerMapRoutes } from "./map-routes";
import type { AppContext, AppEnv } from "./types";

const EVENT_ID = /^[a-z0-9-]{1,64}$/;
const SLUG_ATTEMPTS = 3;
const MAP_UPLOAD_PATH = /^\/api\/v1\/panel\/events\/[^/]+\/map$/;
/** The ONLY route with the 512 KB body limit: PUT, anchored, no trailing slash, event id in its own charset. */
const POINTS_SAVE_PATH = /^\/api\/v1\/panel\/events\/[a-z0-9-]{1,64}\/points$/;
const limitPointsBody = bodyLimit({
  maxSize: POINTS_SAVE_BODY_LIMIT,
  onError: (c) => errorResponse(c as AppContext, 413, "payload_too_large", "private, no-store"),
});

/** One privacy-safe line per write: request id, action, outcome, internal ids. Never user text, IP or body. */
function logPanel(c: AppContext, action: string, outcome: string, eventId?: string, codes?: string[]): void {
  console.log(
    `[panel] requestId=${c.get("requestId")} action=${action} outcome=${outcome} organizer=${c.get("user").id}` +
      `${eventId ? ` event=${eventId}` : ""}${codes?.length ? ` fields=${codes.join(",")}` : ""}`,
  );
}

const LOGGED_AS_INFO = new Set(["ok", "no_change", "validation_error", "event_changed", "map_required", "not_found", "unknown_point_id"]);

/** One privacy-safe line per points save: ids and counts only. Never names, descriptions, coordinates or the body. */
function logPoints(c: AppContext, outcome: string, eventId: string, counts?: { created: number; updated: number; deleted: number }): void {
  const line =
    `[points] requestId=${c.get("requestId")} action=points_saved outcome=${outcome} organizer=${c.get("user").id} event=${eventId}` +
    (counts ? ` created=${counts.created} updated=${counts.updated} deleted=${counts.deleted}` : "");
  if (LOGGED_AS_INFO.has(outcome)) console.log(line);
  else console.error(line);
}

/** Per-organizer write limit (after requireAuth, so the key is the organizer id). Fails open. */
const panelWriteLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  const limiter = c.env.PANEL_WRITE_LIMITER;
  if (limiter && m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.get("user").id })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) return errorResponse(c, 429, "rate_limited", "no-store", { "Retry-After": "60" });
  }
  await next();
};

const toPanelEvent = ({ dayStart: _dayStart, storedMap: _storedMap, ownerId: _ownerId, ...e }: OwnedEvent) => e;

async function readJson(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function registerPanelRoutes(app: Hono<AppEnv>): void {
  // Owner data is never cached, errors included.
  app.use("/api/v1/panel/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "private, no-store");
  });
  // Deny by default: every route under the prefix needs a session. Any role may use it (own events only).
  // The map upload is multipart with its own 2 MiB limit (set in map-routes after the owner check): it keeps the
  // Origin / Sec-Fetch-Site check but skips the JSON-only rule and the 8 KB limit.
  const isMapUpload = (c: AppContext) => c.req.method === "POST" && MAP_UPLOAD_PATH.test(c.req.path);
  const isPointsSave = (c: AppContext) => c.req.method === "PUT" && POINTS_SAVE_PATH.test(c.req.path);
  app.use(
    "/api/v1/panel/*",
    (c, next) => (isMapUpload(c) ? guardOrigin(c, next) : guardMutations(c, next)),
    (c, next) => (isMapUpload(c) ? next() : isPointsSave(c) ? limitPointsBody(c, next) : limitBody(c, next)),
    requireAuth,
    panelWriteLimiter,
  );

  const notFound = (c: AppContext) => errorResponse(c, 404, "event_not_found", "private, no-store");

  app.get("/api/v1/panel/events", async (c) => {
    const events = await new D1PanelEventRepository(c.env.DB).list(c.get("user").id);
    const body: PanelEventListResponse = { events: events.map(toPanelEvent) };
    return c.json(body);
  });

  app.post("/api/v1/panel/events", async (c) => {
    const parsed = eventInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      const fields = toFieldErrors(parsed.error);
      logPanel(c, "event_validation_failed", "validation_error", undefined, fields.map((f) => `${f.path}:${f.code}`));
      return errorResponse(c, 400, "validation_error", "private, no-store", {}, fields);
    }
    const repo = new D1PanelEventRepository(c.env.DB);
    const ownerId = c.get("user").id;
    const id = crypto.randomUUID();
    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
      const outcome = await repo.insertDraft({
        id,
        slug: generateSlug(parsed.data.name),
        ownerId,
        input: parsed.data,
        now: Date.now(),
      });
      if (outcome === "limit_reached") {
        logPanel(c, "event_limit_reached", "event_limit_reached");
        return errorResponse(c, 409, "event_limit_reached", "private, no-store");
      }
      if (outcome === "inserted") {
        const created = await repo.get(id, ownerId);
        if (!created) throw new Error("created event not found");
        logPanel(c, "event_created", "ok", id);
        const body: PanelEventResponse = { event: toPanelEvent(created) };
        return c.json(body, 201);
      }
    }
    throw new Error("slug collision: attempts exhausted");
  });

  app.get("/api/v1/panel/events/:id", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    const event = await new D1PanelEventRepository(c.env.DB).get(id, c.get("user").id);
    if (!event) return notFound(c);
    const body: PanelEventResponse = { event: toPanelEvent(event) };
    return c.json(body);
  });

  app.put("/api/v1/panel/events/:id", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    const parsed = eventInputSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      const fields = toFieldErrors(parsed.error);
      logPanel(c, "event_validation_failed", "validation_error", id, fields.map((f) => `${f.path}:${f.code}`));
      return errorResponse(c, 400, "validation_error", "private, no-store", {}, fields);
    }
    const repo = new D1PanelEventRepository(c.env.DB);
    const ownerId = c.get("user").id;
    if (!(await repo.update(id, ownerId, parsed.data, Date.now()))) return notFound(c);
    const updated = await repo.get(id, ownerId);
    if (!updated) return notFound(c);
    logPanel(c, "event_updated", "ok", id);
    const body: PanelEventResponse = { event: toPanelEvent(updated) };
    return c.json(body);
  });

  app.delete("/api/v1/panel/events/:id", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    if (!(await new D1PanelEventRepository(c.env.DB).delete(id, c.get("user").id))) return notFound(c);
    // Event row (and its map row, by cascade) is gone: now remove every stored object under maps/{id}/.
    await deleteEventMapObjects(c, id);
    logPanel(c, "event_deleted", "ok", id);
    return c.body(null, 204);
  });

  // The event as visitors will see it after publishing: public-shaped fields, with the uploaded map when there is one.
  app.get("/api/v1/panel/events/:id/preview", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    const e = await new D1PanelEventRepository(c.env.DB).get(id, c.get("user").id);
    if (!e) return notFound(c);
    return c.json(toPreviewBody(e, await new D1EventPointsRepository(c.env.DB).listForEvent(id)));
  });

  // Points editor (slice 08c). GET loads the set, PUT saves the whole set atomically. See the slice spec, API contract.
  app.get("/api/v1/panel/events/:id/points", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    const read = await new D1EventPointsRepository(c.env.DB).readForEditor(id, c.get("user").id);
    if (!read) return notFound(c);
    if (!read.hasMap) return errorResponse(c, 409, "map_required", "private, no-store");
    const body: PanelPointsResponse = { points: read.points, eventUpdatedAt: new Date(read.updatedAt).toISOString() };
    return c.json(body);
  });

  app.put("/api/v1/panel/events/:id/points", async (c) => {
    const id = c.req.param("id");
    if (!EVENT_ID.test(id)) return notFound(c);
    const ownerId = c.get("user").id;
    const repo = new D1EventPointsRepository(c.env.DB);
    // Owner and map first: a body is only parsed for an event the caller owns (the limiter already ran).
    const read = await repo.readForEditor(id, ownerId);
    if (!read) {
      logPoints(c, "not_found", id);
      return notFound(c);
    }
    if (!read.hasMap) {
      logPoints(c, "map_required", id);
      return errorResponse(c, 409, "map_required", "private, no-store");
    }
    const parsed = savePointsRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      logPoints(c, "validation_error", id);
      return errorResponse(c, 400, "validation_error", "private, no-store", {}, toPointFieldErrors(parsed.error));
    }
    const { baseUpdatedAt, points: drafts } = parsed.data;
    if (Date.parse(baseUpdatedAt) !== read.updatedAt) {
      logPoints(c, "event_changed", id);
      return errorResponse(c, 409, "event_changed", "private, no-store");
    }
    const result = diffPoints(read.points, drafts, () => crypto.randomUUID());
    if (!result.ok) {
      if (result.reason === "unknown_point_id") {
        // Same answer as a missing event: ids of other events and ids of nothing look the same. Nothing is written.
        logPoints(c, "unknown_point_id", id);
        return notFound(c);
      }
      logPoints(c, "validation_error", id);
      return errorResponse(c, 400, "validation_error", "private, no-store", {}, [{ path: "points", code: "too_long" }]);
    }
    const { diff } = result;
    const counts = { created: diff.toCreate.length, updated: diff.toUpdate.length, deleted: diff.toDelete.length };
    let eventUpdatedAt = read.updatedAt;
    let points = read.points;
    if (!isEmptyDiff(diff)) {
      // Strictly forward, so two saves in the same millisecond cannot share a version.
      const now = Math.max(Date.now(), read.updatedAt + 1);
      let saved;
      try {
        saved = await repo.save({ eventId: id, ownerId, base: read.updatedAt, now, currentCount: read.points.length, diff });
      } catch (err) {
        logPoints(c, err instanceof ChangesMismatchError ? "changes_mismatch" : "internal_error", id, counts);
        throw err;
      }
      if (!saved.ok) {
        logPoints(c, saved.reason, id);
        return saved.reason === "not_found" ? notFound(c) : errorResponse(c, 409, "event_changed", "private, no-store");
      }
      eventUpdatedAt = now;
      const removed = new Set(diff.toDelete);
      const changed = new Map(diff.toUpdate.map((p) => [p.id, p] as const));
      points = sortPoints([
        ...read.points.filter((p) => !removed.has(p.id)).map((p) => changed.get(p.id) ?? p),
        ...diff.toCreate.map((x) => x.point),
      ]);
    }
    logPoints(c, isEmptyDiff(diff) ? "no_change" : "ok", id, counts);
    const body: SavePointsResponse = {
      points,
      eventUpdatedAt: new Date(eventUpdatedAt).toISOString(),
      counts,
      created: diff.toCreate.map((x) => ({ index: x.index, id: x.point.id })),
    };
    return c.json(body);
  });

  // Publish flow (slice 08b). The organizer can only ask (`publish-request`), take the request back (`withdraw`) or
  // take their own published event down (`unpublish`); no route here can produce `published`. Each call is one
  // conditional statement (see application/publication). Transitions count against PANEL_WRITE_LIMITER (prefix
  // chain) and a daily D1 cap.
  const organizerAction = (path: string, action: PublishAction) =>
    app.post(`/api/v1/panel/events/:id/${path}`, async (c) => {
      const id = c.req.param("id");
      if (!EVENT_ID.test(id)) return notFound(c);
      const parsed = publishActionRequestSchema.safeParse(await readJson(c));
      if (!parsed.success) return errorResponse(c, 400, "validation_error", "private, no-store", {}, toFieldErrors(parsed.error));
      const ownerId = c.get("user").id;
      const result = await runTransition(new D1PublicationRepository(c.env.DB), { action, eventId: id, actorId: ownerId, now: Date.now() });
      if (!result.ok) {
        logPublication(c, action, result.reason, id);
        return refusalResponse(c, result.reason, "fields" in result ? result.fields : undefined);
      }
      const updated = await new D1PanelEventRepository(c.env.DB).get(id, ownerId);
      if (!updated) return notFound(c);
      logPublication(c, action, "ok", id);
      const body: PanelEventResponse = { event: toPanelEvent(updated) };
      return c.json(body);
    });
  organizerAction("publish-request", "request");
  organizerAction("withdraw", "withdraw");
  organizerAction("unpublish", "unpublish");

  registerMapRoutes(app);
}
