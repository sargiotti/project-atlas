import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import {
  MAP_FULL_MAX_BYTES,
  MAP_SMALL_MAX_BYTES,
  MAP_UPLOAD_BODY_LIMIT,
  mapThemeInputSchema,
  mapUploadThemeSchema,
  toFieldErrors,
  type InvalidUploadReason,
  type PanelMapResponse,
} from "@atlas/contract";
import { D1MapImageRepository, toPanelMap } from "../adapters/d1-map-image-repository";
import { sha256Hex } from "../adapters/crypto";
import { validateMapPair } from "../domain/map-image";
import { errorResponse } from "./errors";
import type { AppContext, AppEnv } from "./types";

const EVENT_ID = /^[a-z0-9-]{1,64}$/;
const MEDIA_FILE = /^[0-9a-f]{32}-(full|small)\.(webp|jpg)$/;
const SESSION_COOKIE = "__Host-atlas_session";
const TOKEN_43 = /^[A-Za-z0-9_-]{43}$/;
const PARTS = new Set(["full", "small", "theme"]);
const NO_STORE = "private, no-store";

/** One privacy-safe line per map action: request id, action, organizer, event, reason code. Never file names or bytes. */
function logMap(c: AppContext, action: string, eventId: string, reason?: string): void {
  console.log(
    `[map] requestId=${c.get("requestId")} action=${action} organizer=${c.get("user").id} event=${eventId}${reason ? ` reason=${reason}` : ""}`,
  );
}

/** Per-organizer upload limit (~5 / 60 s, binding in wrangler.toml). Fails open; the D1 daily counter is the real cap. */
const uploadLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.UPLOAD_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.get("user").id })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) {
      logMap(c, "map_rate_limited", c.req.param("id") ?? "-", "per_minute");
      return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": "60" });
    }
  }
  await next();
};

/**
 * Owner guard. Missing, someone else's and demo events are all 404. Since slice 08b the map and theme can change in
 * every status (edits on an In review or Published event need no re-review), so there is no status check.
 */
const ownerGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param("id") ?? "";
  if (!EVENT_ID.test(id) || !(await new D1MapImageRepository(c.env.DB).isOwner(id, c.get("user").id))) {
    return errorResponse(c, 404, "event_not_found", NO_STORE);
  }
  await next();
};

function rejected(c: AppContext, eventId: string, failure: { code: "unsupported_image_type" } | { code: "invalid_upload"; reason: InvalidUploadReason }): Response {
  if (failure.code === "unsupported_image_type") {
    logMap(c, "map_rejected", eventId, "unsupported_image_type");
    return errorResponse(c, 415, "unsupported_image_type", NO_STORE);
  }
  logMap(c, "map_rejected", eventId, failure.reason);
  return errorResponse(c, 400, "invalid_upload", NO_STORE, {}, undefined, failure.reason);
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

async function deleteKeys(c: AppContext, keys: string[], what: string): Promise<void> {
  if (keys.length === 0) return;
  try {
    await c.env.MAPS.delete(keys);
  } catch (err) {
    console.error(`[map] requestId=${c.get("requestId")} action=r2_delete_failed what=${what} name=${err instanceof Error ? err.name : "NonError"}`);
  }
}

/**
 * Hard delete support: removes every object under `maps/{eventId}/` (the keys referenced in D1 and any orphans).
 * Never throws: failures are logged and the caller still answers 204.
 */
export async function deleteEventMapObjects(c: AppContext, eventId: string): Promise<void> {
  try {
    const prefix = `maps/${eventId}/`;
    let cursor: string | undefined;
    do {
      const page = await c.env.MAPS.list({ prefix, cursor });
      if (page.objects.length > 0) await c.env.MAPS.delete(page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch (err) {
    console.error(`[map] requestId=${c.get("requestId")} action=r2_sweep_failed event=${eventId} name=${err instanceof Error ? err.name : "NonError"}`);
  }
}

export function registerMapRoutes(app: Hono<AppEnv>): void {
  // Upload or replace. Origin check, session and the generic write limiter already ran (panel prefix chain,
  // see panel-routes). Here: upload limiter -> owner guard -> 2 MiB body limit -> parse -> validate -> quota -> R2 -> D1.
  app.post(
    "/api/v1/panel/events/:id/map",
    uploadLimiter,
    ownerGuard,
    bodyLimit({ maxSize: MAP_UPLOAD_BODY_LIMIT, onError: (c) => errorResponse(c as AppContext, 413, "payload_too_large", NO_STORE) }),
    async (c) => {
      const eventId = c.req.param("id");
      const ownerId = c.get("user").id;
      if (!/^multipart\/form-data\s*;/i.test(c.req.header("content-type") ?? "")) {
        return errorResponse(c, 415, "unsupported_media_type", NO_STORE);
      }
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        return rejected(c, eventId, { code: "invalid_upload", reason: "missing_part" });
      }

      const seen = new Set<string>();
      for (const name of form.keys()) {
        if (!PARTS.has(name) || seen.has(name)) return rejected(c, eventId, { code: "invalid_upload", reason: "unknown_part" });
        seen.add(name);
      }
      const full = form.get("full");
      const small = form.get("small");
      const rawTheme = form.get("theme");
      if (typeof full === "string" || typeof small === "string" || full === null || small === null || rawTheme === null) {
        return rejected(c, eventId, { code: "invalid_upload", reason: "missing_part" });
      }
      const theme = mapUploadThemeSchema.safeParse(rawTheme);
      if (!theme.success) return rejected(c, eventId, { code: "invalid_upload", reason: "bad_theme" });
      if (full.size > MAP_FULL_MAX_BYTES || small.size > MAP_SMALL_MAX_BYTES) {
        logMap(c, "map_rejected", eventId, "payload_too_large");
        return errorResponse(c, 413, "payload_too_large", NO_STORE);
      }

      const fullBytes = new Uint8Array(await full.arrayBuffer());
      const smallBytes = new Uint8Array(await small.arrayBuffer());
      const pair = validateMapPair(fullBytes, smallBytes);
      if (!pair.ok) return rejected(c, eventId, pair);

      const repo = new D1MapImageRepository(c.env.DB);
      const now = Date.now();
      if (!(await repo.claimUpload(ownerId, now))) {
        logMap(c, "map_rate_limited", eventId, "daily_quota");
        const nextMidnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
        return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": String(seconds(nextMidnight - now)) });
      }

      // Server-generated keys only. A new key per upload makes the immutable cache header safe.
      const ext = pair.format === "webp" ? "webp" : "jpg";
      const contentType = pair.format === "webp" ? "image/webp" : "image/jpeg";
      const stem = `maps/${eventId}/${randomHex32()}`;
      const fullKeyFinal = `${stem}-full.${ext}`;
      const smallKeyFinal = `${stem}-small.${ext}`;

      try {
        await c.env.MAPS.put(fullKeyFinal, fullBytes, { httpMetadata: { contentType } });
        await c.env.MAPS.put(smallKeyFinal, smallBytes, { httpMetadata: { contentType } });
      } catch (err) {
        await deleteKeys(c, [fullKeyFinal, smallKeyFinal], "new_after_put_failure");
        throw err;
      }

      let previous: Awaited<ReturnType<D1MapImageRepository["get"]>>;
      let switched: boolean;
      try {
        previous = await repo.get(eventId);
        switched = await repo.switchTo(
          eventId,
          ownerId,
          {
            theme: theme.data,
            format: pair.format,
            fullKey: fullKeyFinal,
            fullWidth: pair.full.width,
            fullHeight: pair.full.height,
            smallKey: smallKeyFinal,
            smallWidth: pair.small.width,
            smallHeight: pair.small.height,
          },
          now,
          previous?.fullKey ?? null,
        );
      } catch (err) {
        await deleteKeys(c, [fullKeyFinal, smallKeyFinal], "new_after_d1_failure");
        throw err;
      }
      if (!switched) {
        // Either the event is gone (deleted meanwhile), or a concurrent upload won the compare-and-swap.
        await deleteKeys(c, [fullKeyFinal, smallKeyFinal], "new_after_switch_refused");
        if (!(await repo.isOwner(eventId, ownerId))) return errorResponse(c, 404, "event_not_found", NO_STORE);
        logMap(c, "map_rejected", eventId, "map_changed");
        return errorResponse(c, 409, "map_changed", NO_STORE);
      }

      if (previous) await deleteKeys(c, [previous.fullKey, previous.smallKey], "replaced");
      logMap(c, previous ? "map_replaced" : "map_uploaded", eventId);

      const stored = await repo.get(eventId);
      if (!stored) throw new Error("map row missing after switch");
      const body: PanelMapResponse = { map: toPanelMap(stored) };
      return c.json(body);
    },
  );

  // Theme override (ADR 0008). D1 only. The generic limiter already ran.
  app.patch("/api/v1/panel/events/:id/map/theme", ownerGuard, async (c) => {
    const eventId = c.req.param("id");
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    const parsed = mapThemeInputSchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(c, 400, "validation_error", NO_STORE, {}, toFieldErrors(parsed.error));
    }
    const repo = new D1MapImageRepository(c.env.DB);
    if (!(await repo.setTheme(eventId, c.get("user").id, parsed.data.theme, Date.now()))) {
      return errorResponse(c, 404, "map_not_found", NO_STORE);
    }
    const stored = await repo.get(eventId);
    if (!stored) return errorResponse(c, 404, "map_not_found", NO_STORE);
    const body: PanelMapResponse = { map: toPanelMap(stored) };
    return c.json(body);
  });
}

function randomHex32(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Per-IP limit on /media/* (slice 08b, 08a review finding 3): each hit costs a Worker request, a D1 read and an R2
 * Class B read. 300 / 60 s tolerates a venue behind one NAT; it is an approximate backstop. Runs BEFORE the D1 read.
 * Fails open (absent binding or limiter error). Visitors never get 429 in normal use: images are immutable-cached.
 */
const mediaLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.MEDIA_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) return errorResponse(c, 429, "rate_limited", "no-store", { "Retry-After": "60" });
  }
  await next();
};

/**
 * Serves map images through the Worker (the bucket is never public). One D1 read per request.
 * A published event's images are public. Otherwise only the owner (any status) and an Admin (only while In review)
 * may fetch them; everything else that does not resolve is a plain 404 (never 401/403).
 */
export function registerMediaRoutes(app: Hono<AppEnv>): void {
  app.get("/media/maps/:eventId/:file", mediaLimiter, async (c) => {
    const eventId = c.req.param("eventId");
    const file = c.req.param("file");
    const notFound = () => errorResponse(c, 404, "not_found", "no-store");
    if (!EVENT_ID.test(eventId) || !MEDIA_FILE.test(file)) return notFound();

    const token = getCookie(c, SESSION_COOKIE);
    const sessionHash = token && TOKEN_43.test(token) ? await sha256Hex(token) : null;
    const key = `maps/${eventId}/${file}`;
    const found = await new D1MapImageRepository(c.env.DB).lookupForMedia(eventId, sessionHash, Date.now());
    if (!found || !found.keys.includes(key)) return notFound();
    const isPublic = found.status === "published";
    if (!isPublic && !found.viewerIsOwner && !(found.viewerIsAdmin && found.status === "in_review")) return notFound();

    const object = await c.env.MAPS.get(key);
    if (!object) return notFound();

    const ext = file.endsWith(".webp") ? "webp" : "jpg";
    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": object.httpMetadata?.contentType ?? (ext === "webp" ? "image/webp" : "image/jpeg"),
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename="map.${ext}"`,
        // A new key per upload makes immutable safe. Non-public images must never sit in a shared cache.
        "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable",
      },
    });
  });
}
