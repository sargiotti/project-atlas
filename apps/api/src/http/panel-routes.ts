import type { Hono, MiddlewareHandler } from "hono";
import {
  eventInputSchema,
  toFieldErrors,
  type EventPreviewResponse,
  type PanelEventListResponse,
  type PanelEventResponse,
} from "@atlas/contract";
import { D1PanelEventRepository, type OwnedEvent } from "../adapters/d1-panel-event-repository";
import { mediaUrl } from "../adapters/d1-map-image-repository";
import { generateSlug } from "../domain/slug";
import { errorResponse } from "./errors";
import { guardMutations, guardOrigin, limitBody, requireAuth } from "./auth-routes";
import { deleteEventMapObjects, registerMapRoutes } from "./map-routes";
import type { AppContext, AppEnv } from "./types";

const EVENT_ID = /^[a-z0-9-]{1,64}$/;
const SLUG_ATTEMPTS = 3;
const MAP_UPLOAD_PATH = /^\/api\/v1\/panel\/events\/[^/]+\/map$/;

/** One privacy-safe line per write: request id, action, outcome, internal ids. Never user text, IP or body. */
function logPanel(c: AppContext, action: string, outcome: string, eventId?: string, codes?: string[]): void {
  console.log(
    `[panel] requestId=${c.get("requestId")} action=${action} outcome=${outcome} organizer=${c.get("user").id}` +
      `${eventId ? ` event=${eventId}` : ""}${codes?.length ? ` fields=${codes.join(",")}` : ""}`,
  );
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

const toPanelEvent = ({ dayStart: _dayStart, storedMap: _storedMap, ...e }: OwnedEvent) => e;

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
  app.use(
    "/api/v1/panel/*",
    (c, next) => (isMapUpload(c) ? guardOrigin(c, next) : guardMutations(c, next)),
    (c, next) => (isMapUpload(c) ? next() : limitBody(c, next)),
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
    const body: EventPreviewResponse = {
      event: {
        slug: e.slug,
        name: e.name,
        startDate: e.startDate,
        endDate: e.endDate,
        language: e.language,
        timeZone: e.timeZone,
        dayStart: e.dayStart,
        city: e.city,
        country: e.country,
        ...(e.description ? { description: e.description } : {}),
        ...(e.website ? { website: e.website } : {}),
      },
      map: e.storedMap
        ? {
            id: e.id,
            theme: e.storedMap.theme,
            width: e.storedMap.fullWidth,
            height: e.storedMap.fullHeight,
            image: {
              format: e.storedMap.format,
              variants: [
                { url: mediaUrl(e.storedMap.smallKey), width: e.storedMap.smallWidth },
                { url: mediaUrl(e.storedMap.fullKey), width: e.storedMap.fullWidth },
              ].sort((a, b) => a.width - b.width),
            },
          }
        : null,
      points: [],
      sessions: [],
    };
    return c.json(body);
  });

  registerMapRoutes(app);
}
