import type { Hono, MiddlewareHandler } from "hono";
import {
  eventInputSchema,
  toFieldErrors,
  type EventPreviewResponse,
  type PanelEventListResponse,
  type PanelEventResponse,
} from "@atlas/contract";
import { D1PanelEventRepository, type OwnedEvent } from "../adapters/d1-panel-event-repository";
import { generateSlug } from "../domain/slug";
import { errorResponse } from "./errors";
import { guardMutations, limitBody, requireAuth } from "./auth-routes";
import type { AppContext, AppEnv } from "./types";

const EVENT_ID = /^[a-z0-9-]{1,64}$/;
const SLUG_ATTEMPTS = 3;

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

const toPanelEvent = ({ dayStart: _dayStart, ...e }: OwnedEvent) => e;

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
  app.use("/api/v1/panel/*", guardMutations, limitBody, requireAuth, panelWriteLimiter);

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
    logPanel(c, "event_deleted", "ok", id);
    return c.body(null, 204);
  });

  // The event as visitors will see it after publishing (slice 08): public-shaped fields, no map yet.
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
      map: null,
      points: [],
      sessions: [],
    };
    return c.json(body);
  });
}
