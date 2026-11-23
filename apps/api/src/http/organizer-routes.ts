import type { Hono, MiddlewareHandler } from "hono";
import {
  REQUEST_ID_REGEX,
  emptyActionBodySchema,
  inviteActionBodySchema,
  ORGANIZER_REQUEST_LIMITS,
  ORGANIZER_TURNSTILE_ACTION,
  organizerRequestListQuerySchema,
  type OrganizerRequestSummary,
  organizerRequestSchema,
  toOrganizerFieldErrors,
  type InviteFromRequestResponse,
  type OrganizerRequestActionResponse,
  type OrganizerRequestListResponse,
  type OrganizerRequestResponse,
} from "@atlas/contract";
import { D1OrganizerRequestRepository } from "../adapters/d1-organizer-request-repository";
import { D1AuthRepository } from "../adapters/d1-auth-repository";
import { randomId, randomToken, sha256Hex } from "../adapters/crypto";
import { INVITE_TTL_MS, normalizeEmail } from "../domain/auth";
import { sendInviteEmail } from "../application/invite-email";
import { sendNotification } from "../application/organizer-notify";
import { isAllowedTurnstileHostname, verifyTurnstile } from "../application/turnstile";
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

/** Empty body = `{}`; malformed JSON = `undefined` (which no schema accepts). */
async function readActionBody(c: AppContext): Promise<unknown> {
  try {
    const text = await c.req.text();
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Positive integer id from the URL, or null (answered as 404, same as an unknown id). */
function requestIdParam(c: AppContext): number | null {
  const raw = c.req.param("id") ?? "";
  const n = REQUEST_ID_REGEX.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}

/** Logs: request id, row id, invite id, action, outcome, Resend HTTP status. Never the email, note, token, link or a response body. */
function logInvite(c: AppContext, action: string, outcome: string, rowId: number, extra = ""): void {
  console.log(`[organizer-invite] requestId=${c.get("requestId")} action=${action} row=${rowId} outcome=${outcome}${extra}`);
}

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
      isAllowedHostname: (h) => isAllowedTurnstileHostname(c.env.PUBLIC_ORIGIN, h),
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
  // The wildcard also covers the list itself and every /:id action (slice 31).
  app.use("/api/v1/admin/organizer-requests/*", adminLimiter);
  // Slice 44: no query parameters; the windows come from the server clock.
  app.get("/api/v1/admin/organizer-requests/summary", async (c) => {
    const body: OrganizerRequestSummary = await new D1OrganizerRequestRepository(c.env.DB).summary(Date.now());
    return c.json(body, 200, { "Cache-Control": NO_STORE });
  });
  app.get("/api/v1/admin/organizer-requests", async (c) => {
    const parsed = organizerRequestListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE);
    let cursor: { createdAt: number; id: number } | undefined;
    if (parsed.data.cursor) {
      const [createdAt, id] = parsed.data.cursor.split(":") as [string, string];
      if (!/^\d+$/.test(id)) return errorResponse(c, 400, "validation_error", NO_STORE);
      cursor = { createdAt: Number(createdAt), id: Number(id) };
    }
    const body: OrganizerRequestListResponse = await new D1OrganizerRequestRepository(c.env.DB).list(parsed.data.limit, parsed.data.status, Date.now(), cursor);
    return c.json(body, 200, { "Cache-Control": NO_STORE });
  });

  const inviteAction = (mode: "invite" | "again") => async (c: AppContext) => {
    const action = mode === "invite" ? "invite" : "invite_again";
    const id = requestIdParam(c);
    if (id === null) return errorResponse(c, 404, "not_found", NO_STORE);
    const parsed = inviteActionBodySchema.safeParse(await readActionBody(c));
    if (!parsed.success) return errorResponse(c, 400, "validation_error", NO_STORE);
    const note = parsed.data.note;

    const repo = new D1OrganizerRequestRepository(c.env.DB);
    // Recipient and locale come from the stored row only.
    const target = await repo.inviteTarget(id);
    if (!target) return errorResponse(c, 404, "not_found", NO_STORE);
    const fail = (code: "invalid_transition" | "email_already_registered" | "invite_already_pending" | "invite_cap_reached") => {
      logInvite(c, action, code, id);
      return errorResponse(c, 409, code, NO_STORE);
    };
    if (target.status !== (mode === "invite" ? "pending" : "invited")) return fail("invalid_transition");
    // The configured Admin email is an account in waiting (same rule as POST /admin/invites).
    if (c.env.ADMIN_EMAIL && normalizeEmail(c.env.ADMIN_EMAIL) === normalizeEmail(target.email)) return fail("email_already_registered");

    const now = Date.now();
    await new D1AuthRepository(c.env.DB).purgeEndedInvites(now);
    const token = randomToken();
    const inviteId = randomId("inv");
    const outcome = await repo.inviteFromRequest({
      requestId: id,
      mode,
      expectedInviteId: target.inviteId,
      inviteId,
      tokenHash: await sha256Hex(token),
      adminId: c.get("user").id,
      now,
      expiresAt: now + INVITE_TTL_MS,
    });
    if (outcome === "not_found") return errorResponse(c, 404, "not_found", NO_STORE);
    if (outcome !== "invited") return fail(outcome);

    // The invite exists from here on. Whatever happens to the email, the link goes back once (failed / skipped).
    const link = `${c.env.PUBLIC_ORIGIN.replace(/\/+$/, "")}/panel/invite/${token}`;
    let emailStatus: InviteFromRequestResponse["emailStatus"] = "failed";
    let httpStatus: number | undefined;
    try {
      if (!(await repo.reserveInviteEmail(inviteId, now))) emailStatus = "skipped";
      else {
        const sent = await sendInviteEmail(c.env, target.locale, { note, link, email: target.email }, c.get("requestId"));
        emailStatus = sent.status;
        httpStatus = sent.httpStatus;
      }
    } catch {
      emailStatus = "failed";
    }
    logInvite(c, action, "invited", id, ` invite=${inviteId} email=${emailStatus}${httpStatus ? ` resend=${httpStatus}` : ""}`);

    const request = await repo.get(id, now);
    if (!request) return errorResponse(c, 404, "not_found", NO_STORE);
    const body: InviteFromRequestResponse = { request, emailStatus, ...(emailStatus === "sent" ? {} : { inviteLink: link }) };
    return c.json(body, 201, { "Cache-Control": NO_STORE });
  };
  app.post("/api/v1/admin/organizer-requests/:id/invite", inviteAction("invite"));
  app.post("/api/v1/admin/organizer-requests/:id/invite-again", inviteAction("again"));

  const simpleAction = (action: "discard" | "restore") => async (c: AppContext) => {
    const id = requestIdParam(c);
    if (id === null) return errorResponse(c, 404, "not_found", NO_STORE);
    if (!emptyActionBodySchema.safeParse(await readActionBody(c)).success) return errorResponse(c, 400, "validation_error", NO_STORE);
    const repo = new D1OrganizerRequestRepository(c.env.DB);
    const outcome = await (action === "discard" ? repo.discard(id) : repo.restore(id));
    logInvite(c, action, outcome, id);
    if (outcome === "not_found") return errorResponse(c, 404, "not_found", NO_STORE);
    if (outcome === "invalid_transition") return errorResponse(c, 409, "invalid_transition", NO_STORE);
    const request = await repo.get(id, Date.now());
    if (!request) return errorResponse(c, 404, "not_found", NO_STORE);
    const body: OrganizerRequestActionResponse = { request };
    return c.json(body, 200, { "Cache-Control": NO_STORE });
  };
  app.post("/api/v1/admin/organizer-requests/:id/discard", simpleAction("discard"));
  app.post("/api/v1/admin/organizer-requests/:id/restore", simpleAction("restore"));
}
