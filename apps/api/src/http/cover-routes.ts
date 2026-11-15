import type { Hono, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import {
  COVER_FOCAL_BODY_LIMIT,
  COVER_FULL_MAX_BYTES,
  COVER_OG_MAX_BYTES,
  COVER_SMALL_MAX_BYTES,
  COVER_UPLOAD_BODY_LIMIT,
  type InvalidUploadReason,
  type PanelCoverResponse,
} from "@atlas/contract";
import { D1CoverRepository, coverToken, toPanelCover } from "../adapters/d1-cover-repository";
import { D1MapImageRepository } from "../adapters/d1-map-image-repository";
import { sha256Hex } from "../adapters/crypto";
import { BASE_VERSION_REGEX, parseFocalPart, validateCoverSet, validateOgOnly } from "../domain/cover-image";
import { errorResponse } from "./errors";
import { NO_STORE, SESSION_COOKIE, TOKEN_43, deleteKeys, mediaLimiter, ownerGuard, randomHex32, seconds } from "./map-routes";
import type { AppContext, AppEnv } from "./types";

const PUT_PARTS = new Set(["full", "small", "og", "fx", "fy"]);
const PATCH_PARTS = new Set(["og", "fx", "fy", "baseVersion"]);
/** Event ids of organizer events are UUIDs; seeded demo events are `evt_{slug}` (underscore). */
const MEDIA_EVENT_ID = /^[a-z0-9_-]{1,64}$/;
const MEDIA_FILE = /^[0-9a-f]{32}-(full\.webp|800\.webp|og\.jpg)$/;

/** One privacy-safe line per cover action: request id, action, organizer, event, reason code. Never file names, bytes or focal values. */
function logCover(c: AppContext, action: string, eventId: string, reason?: string): void {
  console.log(
    `[cover] requestId=${c.get("requestId")} action=${action} organizer=${c.get("user").id} event=${eventId}${reason ? ` reason=${reason}` : ""}`,
  );
}

/** Same per-organizer limiter as the map upload (UPLOAD_LIMITER, ~5 / 60 s). Fails open; the D1 daily counter is the real cap. */
const coverUploadLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.UPLOAD_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.get("user").id })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) {
      logCover(c, "cover_rate_limited", c.req.param("id") ?? "-", "per_minute");
      return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": "60" });
    }
  }
  await next();
};

const tooLarge = (c: AppContext) => {
  logCover(c, "cover_rejected", c.req.param("id") ?? "-", "payload_too_large");
  return errorResponse(c, 413, "payload_too_large", NO_STORE);
};
const limitPut = bodyLimit({ maxSize: COVER_UPLOAD_BODY_LIMIT, onError: (c) => tooLarge(c as AppContext) });
const limitFocal = bodyLimit({ maxSize: COVER_FOCAL_BODY_LIMIT, onError: (c) => tooLarge(c as AppContext) });

function rejected(c: AppContext, eventId: string, failure: { code: "unsupported_image_type" } | { code: "invalid_upload"; reason: InvalidUploadReason }): Response {
  if (failure.code === "unsupported_image_type") {
    logCover(c, "cover_rejected", eventId, "unsupported_image_type");
    return errorResponse(c, 415, "unsupported_image_type", NO_STORE);
  }
  logCover(c, "cover_rejected", eventId, failure.reason);
  return errorResponse(c, 400, "invalid_upload", NO_STORE, {}, undefined, failure.reason);
}
const invalid = (c: AppContext, eventId: string, reason: InvalidUploadReason) => rejected(c, eventId, { code: "invalid_upload", reason });

/** Exact part allowlist: no unknown part, no duplicate. Returns false when violated. */
function partsAllowed(form: FormData, allowed: ReadonlySet<string>): boolean {
  const seen = new Set<string>();
  for (const name of form.keys()) {
    if (!allowed.has(name) || seen.has(name)) return false;
    seen.add(name);
  }
  return true;
}

const isFile = (v: File | string | null): v is File => v !== null && typeof v !== "string";

async function parseMultipart(c: AppContext): Promise<FormData | null> {
  try {
    return await c.req.formData();
  } catch {
    return null;
  }
}
const isMultipart = (c: AppContext) => /^multipart\/form-data\s*;/i.test(c.req.header("content-type") ?? "");

/** 429 for the daily quota (shared with map uploads), with the seconds left until 00:00 UTC. */
function dailyQuotaExceeded(c: AppContext, eventId: string, now: number): Response {
  logCover(c, "cover_rate_limited", eventId, "daily_quota");
  const d = new Date(now);
  const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": String(seconds(nextMidnight - now)) });
}

export function registerCoverRoutes(app: Hono<AppEnv>): void {
  // Create or replace. Origin check, session and the generic write limiter already ran (panel prefix chain, which
  // skips the JSON-only rule and the 8 KB limit for this path). Here: upload limiter -> owner -> 1.25 MiB limit -> parse
  // -> validate -> quota -> R2 -> D1 compare-and-swap -> delete the old objects.
  app.put("/api/v1/panel/events/:id/cover", coverUploadLimiter, ownerGuard, limitPut, async (c) => {
    const eventId = c.req.param("id");
    const ownerId = c.get("user").id;
    if (!isMultipart(c)) return errorResponse(c, 415, "unsupported_media_type", NO_STORE);
    const form = await parseMultipart(c);
    if (!form) return invalid(c, eventId, "missing_part");
    if (!partsAllowed(form, PUT_PARTS)) return invalid(c, eventId, "unknown_part");
    const full = form.get("full");
    const small = form.get("small");
    const og = form.get("og");
    if (!isFile(full) || !isFile(small) || !isFile(og)) return invalid(c, eventId, "missing_part");
    if (full.size > COVER_FULL_MAX_BYTES || small.size > COVER_SMALL_MAX_BYTES || og.size > COVER_OG_MAX_BYTES) return tooLarge(c);

    const fullBytes = new Uint8Array(await full.arrayBuffer());
    const smallBytes = new Uint8Array(await small.arrayBuffer());
    const ogBytes = new Uint8Array(await og.arrayBuffer());
    const set = validateCoverSet(fullBytes, smallBytes, ogBytes);
    if (!set.ok) return rejected(c, eventId, set);

    const fx = parseFocalPart(form.get("fx"));
    const fy = parseFocalPart(form.get("fy"));
    if (fx === null || fy === null) return invalid(c, eventId, "bad_focal");

    const quota = new D1MapImageRepository(c.env.DB);
    const now = Date.now();
    if (!(await quota.claimUpload(ownerId, now))) return dailyQuotaExceeded(c, eventId, now);

    // Server-generated keys only, one fresh random token per file. A new key per upload makes the immutable cache safe,
    // and identical bytes uploaded twice can never produce the key of the live file.
    const prefix = `covers/${eventId}/`;
    const fullKey = `${prefix}${randomHex32()}-full.webp`;
    const smallKey = `${prefix}${randomHex32()}-800.webp`;
    const ogKey = `${prefix}${randomHex32()}-og.jpg`;
    try {
      await c.env.MAPS.put(fullKey, fullBytes, { httpMetadata: { contentType: "image/webp" } });
      await c.env.MAPS.put(smallKey, smallBytes, { httpMetadata: { contentType: "image/webp" } });
      await c.env.MAPS.put(ogKey, ogBytes, { httpMetadata: { contentType: "image/jpeg" } });
    } catch (err) {
      await deleteKeys(c, [fullKey, smallKey, ogKey], "new_after_put_failure", "cover");
      throw err;
    }

    const repo = new D1CoverRepository(c.env.DB);
    let previous: Awaited<ReturnType<D1CoverRepository["get"]>>;
    let switched: boolean;
    try {
      previous = await repo.get(eventId);
      switched = await repo.switchTo(
        eventId,
        ownerId,
        {
          fullKey,
          fullWidth: set.full.width,
          fullHeight: set.full.height,
          smallKey,
          smallWidth: set.small.width,
          smallHeight: set.small.height,
          ogKey,
          focalX: fx,
          focalY: fy,
        },
        now,
        previous ? { fullKey: previous.fullKey, ogKey: previous.ogKey } : null,
      );
    } catch (err) {
      await deleteKeys(c, [fullKey, smallKey, ogKey], "new_after_d1_failure", "cover");
      throw err;
    }
    if (!switched) {
      // Either the event is gone (deleted meanwhile), or a concurrent replace won the compare-and-swap.
      await deleteKeys(c, [fullKey, smallKey, ogKey], "new_after_switch_refused", "cover");
      if (!(await quota.isOwner(eventId, ownerId))) return errorResponse(c, 404, "event_not_found", NO_STORE);
      logCover(c, "cover_rejected", eventId, "cover_changed");
      return errorResponse(c, 409, "cover_changed", NO_STORE);
    }

    // Only now, with the new row committed, are the old objects removed.
    if (previous) await deleteKeys(c, [previous.fullKey, previous.smallKey, previous.ogKey], "replaced", "cover");
    logCover(c, previous ? "cover_replaced" : "cover_uploaded", eventId);

    const stored = await repo.get(eventId);
    const cover = stored ? toPanelCover(stored) : null;
    if (!cover) throw new Error("cover row missing after switch");
    const body: PanelCoverResponse = { cover };
    return c.json(body);
  });

  // Focal point only: replaces the link-preview JPEG and the focal point; the WebP files stay.
  app.patch("/api/v1/panel/events/:id/cover/focal", coverUploadLimiter, ownerGuard, limitFocal, async (c) => {
    const eventId = c.req.param("id");
    const ownerId = c.get("user").id;
    if (!isMultipart(c)) return errorResponse(c, 415, "unsupported_media_type", NO_STORE);
    const form = await parseMultipart(c);
    if (!form) return invalid(c, eventId, "missing_part");
    if (!partsAllowed(form, PATCH_PARTS)) return invalid(c, eventId, "unknown_part");
    const og = form.get("og");
    if (!isFile(og)) return invalid(c, eventId, "missing_part");
    if (og.size > COVER_OG_MAX_BYTES) return tooLarge(c);

    const ogBytes = new Uint8Array(await og.arrayBuffer());
    const checked = validateOgOnly(ogBytes);
    if (!checked.ok) return rejected(c, eventId, checked);

    const fx = parseFocalPart(form.get("fx"));
    const fy = parseFocalPart(form.get("fy"));
    const baseVersion = form.get("baseVersion");
    if (fx === null || fy === null || typeof baseVersion !== "string" || !BASE_VERSION_REGEX.test(baseVersion)) {
      return invalid(c, eventId, "bad_focal");
    }

    // Existence and version are checked before the quota is claimed: a stale edit costs nothing.
    const repo = new D1CoverRepository(c.env.DB);
    const current = await repo.get(eventId);
    if (!current) {
      logCover(c, "cover_rejected", eventId, "cover_not_found");
      return errorResponse(c, 404, "cover_not_found", NO_STORE);
    }
    if (coverToken(current.fullKey) !== baseVersion) {
      logCover(c, "cover_rejected", eventId, "cover_changed");
      return errorResponse(c, 409, "cover_changed", NO_STORE);
    }

    const now = Date.now();
    if (!(await new D1MapImageRepository(c.env.DB).claimUpload(ownerId, now))) return dailyQuotaExceeded(c, eventId, now);

    const newOgKey = `covers/${eventId}/${randomHex32()}-og.jpg`;
    try {
      await c.env.MAPS.put(newOgKey, ogBytes, { httpMetadata: { contentType: "image/jpeg" } });
    } catch (err) {
      await deleteKeys(c, [newOgKey], "new_after_put_failure", "cover");
      throw err;
    }
    let switched: boolean;
    try {
      switched = await repo.refocus(eventId, ownerId, { fullKey: current.fullKey, previousOgKey: current.ogKey, ogKey: newOgKey, focalX: fx, focalY: fy }, now);
    } catch (err) {
      await deleteKeys(c, [newOgKey], "new_after_d1_failure", "cover");
      throw err;
    }
    if (!switched) {
      await deleteKeys(c, [newOgKey], "new_after_switch_refused", "cover");
      if (!(await new D1MapImageRepository(c.env.DB).isOwner(eventId, ownerId))) return errorResponse(c, 404, "event_not_found", NO_STORE);
      logCover(c, "cover_rejected", eventId, "cover_changed");
      return errorResponse(c, 409, "cover_changed", NO_STORE);
    }
    await deleteKeys(c, [current.ogKey], "replaced_og", "cover");
    logCover(c, "cover_focal_updated", eventId);

    const stored = await repo.get(eventId);
    const cover = stored ? toPanelCover(stored) : null;
    if (!cover) throw new Error("cover row missing after refocus");
    const body: PanelCoverResponse = { cover };
    return c.json(body);
  });

  // Remove. D1 first (owner-guarded), then the objects; 204 even when there was no cover (idempotent). No upload quota.
  app.delete("/api/v1/panel/events/:id/cover", ownerGuard, async (c) => {
    const eventId = c.req.param("id");
    const repo = new D1CoverRepository(c.env.DB);
    const previous = await repo.get(eventId);
    if (previous && (await repo.remove(eventId, c.get("user").id, Date.now()))) {
      await deleteKeys(c, [previous.fullKey, previous.smallKey, previous.ogKey], "removed", "cover");
      logCover(c, "cover_removed", eventId);
    }
    return c.body(null, 204);
  });
}

/**
 * Serves cover images through the Worker (the bucket is never public). One D1 read per request. Same gating as
 * `/media/maps`: a published event's covers are public; otherwise only the owner (any status) and an Admin (only while
 * In review) may fetch them; everything else that does not resolve is a plain 404 (never 401/403).
 */
export function registerCoverMediaRoutes(app: Hono<AppEnv>): void {
  app.get("/media/covers/:eventId/:file", mediaLimiter, async (c) => {
    const eventId = c.req.param("eventId");
    const file = c.req.param("file");
    const notFound = () => errorResponse(c, 404, "not_found", "no-store");
    if (!MEDIA_EVENT_ID.test(eventId) || !MEDIA_FILE.test(file)) return notFound();

    const token = getCookie(c, SESSION_COOKIE);
    const sessionHash = token && TOKEN_43.test(token) ? await sha256Hex(token) : null;
    const key = `covers/${eventId}/${file}`;
    const found = await new D1CoverRepository(c.env.DB).lookupForMedia(eventId, sessionHash, Date.now());
    if (!found || !found.keys.includes(key)) return notFound();
    const isPublic = found.status === "published";
    if (!isPublic && !found.viewerIsOwner && !(found.viewerIsAdmin && found.status === "in_review")) return notFound();

    const object = await c.env.MAPS.get(key);
    if (!object) return notFound();

    const og = file.endsWith("-og.jpg");
    const suffixType = og ? "image/jpeg" : "image/webp";
    // The type stored at upload (set from the sniffed bytes). A missing or unexpected value falls back to the suffix.
    const stored = object.httpMetadata?.contentType;
    const contentType = stored === "image/webp" || stored === "image/jpeg" ? stored : suffixType;
    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename="${og ? "cover-og.jpg" : "cover.webp"}"`,
        // A new key per upload makes immutable safe. Non-public images must never sit in a shared cache.
        "Cache-Control": isPublic ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable",
      },
    });
  });
}
