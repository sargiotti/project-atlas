import type { Hono, MiddlewareHandler } from "hono";
import {
  ORGANIZER_REQUEST_LIMITS,
  ORGANIZER_TURNSTILE_ACTION,
  organizerRequestListQuerySchema,
  organizerRequestSchema,
  toOrganizerFieldErrors,
  type OrganizerRequestListResponse,
  type OrganizerRequestResponse,
} from "@atlas/contract";
import { D1OrganizerRequestRepository } from "../adapters/d1-organizer-request-repository";
import { sendNotification } from "../application/organizer-notify";
import { verifyTurnstile } from "../application/turnstile";
import { adminLimiter } from "./admin-event-routes";
import { guardMutations, limitBody } from "./auth-routes";
import { errorResponse } from "./errors";
import type { AppContext, AppEnv } from "./types";

const NO_STORE = "no-store";
const OK_BODY: OrganizerRequestResponse = { ok: true };

/** Per-IP, before Turnstile and D1. Fails open: the D1 daily caps are the real bound. */
const formLimiter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.FORM_LIMITER;
  if (limiter) {
    let allowed = true;
    try {
      allowed = (await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" })).success;
    } catch {
      allowed = true;
    }
    if (!allowed) return errorResponse(c, 429, "rate_limited", NO_STORE, { "Retry-After": "60" });
  }
  await next();
};

const created = (c: AppContext) => c.json(OK_BODY, 201, { "Cache-Control": NO_STORE });

/** After the response is sent when a Worker context exists (waitUntil); awaited otherwise (unit tests). */
async function afterResponse(c: AppContext, work: Promise<unknown>): Promise<void> {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

export function registerOrganizerRoutes(app: Hono<AppEnv>): void {
  app.use("/api/v1/organizer-requests", guardMutations, limitBody, formLimiter);

  // Order: zod -> honeypot -> fill time -> Turnstile -> caps + insert -> email.
  app.post("/api/v1/organizer-requests", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      raw = undefined;
    }
    const parsed = organizerRequestSchema.safeParse(raw);
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE, {}, toOrganizerFieldErrors(parsed.error));
    const r = parsed.data;

    // Honeypot: the normal success, nothing stored or sent, so bots learn nothing.
    if (r.website !== undefined && r.website.trim() !== "") return created(c);
    if (r.elapsedMs < ORGANIZER_REQUEST_LIMITS.minElapsedMs) return errorResponse(c, 400, "submission_rejected", NO_STORE);

    const outcome = await verifyTurnstile({
      secret: c.env.TURNSTILE_SECRET,
      token: r.turnstileToken,
      remoteIp: c.req.header("cf-connecting-ip"),
      action: ORGANIZER_TURNSTILE_ACTION,
      hostname: new URL(c.env.PUBLIC_ORIGIN).hostname,
    });
    if (outcome === "unavailable") {
      console.error(`[organizer-request] requestId=${c.get("requestId")} outcome=turnstile_unavailable`);
      return errorResponse(c, 503, "service_unavailable", NO_STORE);
    }
    if (outcome === "rejected") return errorResponse(c, 400, "submission_rejected", NO_STORE);

    const repo = new D1OrganizerRequestRepository(c.env.DB);
    const now = Date.now();
    const result = await repo.insertWithCaps(r, now);
    if (result.kind === "global_cap") {
      console.error(`[organizer-request] requestId=${c.get("requestId")} outcome=daily_cap_reached`);
      return errorResponse(c, 429, "daily_cap_reached", NO_STORE);
    }
    // Per-email cap: uniform success, nothing stored, so nobody can probe whether an email was used.
    if (result.kind === "email_cap") return created(c);

    console.log(`[organizer-request] requestId=${c.get("requestId")} outcome=stored`);
    await afterResponse(
      c,
      sendNotification(c.env, result.id, now, r, c.get("requestId"))
        .then((status) => repo.setEmailStatus(result.id, status))
        .catch((err) => console.error(`[organizer-request] requestId=${c.get("requestId")} outcome=status_update_failed name=${err instanceof Error ? err.name : "NonError"}`)),
    );
    return created(c);
  });

  // Admin only: the /api/v1/admin/* prefix chain (guardMutations, limitBody, requireAuth, requireAdmin) is registered
  // earlier by registerAuthRoutes and runs first.
  app.use("/api/v1/admin/organizer-requests", adminLimiter);
  app.get("/api/v1/admin/organizer-requests", async (c) => {
    const parsed = organizerRequestListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE);
    let cursor: { createdAt: number; id: number } | undefined;
    if (parsed.data.cursor) {
      const [createdAt, id] = parsed.data.cursor.split(":") as [string, string];
      if (!/^\d+$/.test(id)) return errorResponse(c, 400, "validation_error", NO_STORE);
      cursor = { createdAt: Number(createdAt), id: Number(id) };
    }
    const body: OrganizerRequestListResponse = await new D1OrganizerRequestRepository(c.env.DB).list(parsed.data.limit, cursor);
    return c.json(body, 200, { "Cache-Control": NO_STORE });
  });
}
