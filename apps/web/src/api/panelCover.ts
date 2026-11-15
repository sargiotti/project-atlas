import { panelCoverResponseSchema, type PanelCover } from "@atlas/contract";

// Slice 14: cover client. XHR for the multipart PUT (fetch has no upload progress); fetch for PATCH focal and DELETE.
// The server is the authority; this only maps its answers to message keys (cv* in the i18n catalogs).
const BASE = "/api/v1/panel/events";

export type CoverMessageKey = "cvFailRejected" | "cvFailChanged" | "cvFailNet" | "cvFailServer" | "cvFailRateMin" | "cvFailRateDay" | "cvFailGone";

export type CoverFail =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "rate_limited"; kind: "minute" | "day"; retryAfter: number; key: CoverMessageKey }
  | { status: "aborted" }
  | { status: "error"; key: CoverMessageKey; code?: string; reason?: string; retryable: boolean };
export type CoverResult = { status: "ok"; cover: PanelCover } | CoverFail;

/** Retry-After up to this many seconds is the per-minute limiter (shown as a countdown); more is the daily quota. */
export const MINUTE_LIMIT_MAX_SECONDS = 120;

/** Pure: HTTP status + error body + Retry-After header -> outcome. */
export function coverFailure(status: number, body: any, retryAfterHeader: string | null): CoverFail {
  const code: string | undefined = typeof body?.error?.code === "string" ? body.error.code : undefined;
  const reason: string | undefined = typeof body?.error?.reason === "string" ? body.error.reason : undefined;
  if (status === 401) return { status: "unauthenticated" };
  if (status === 404 && code === "cover_not_found") return { status: "error", key: "cvFailGone", code, retryable: false };
  if (status === 404) return { status: "not_found" }; // event_not_found: never probe further
  if (status === 429) {
    const n = Number(retryAfterHeader);
    const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60;
    const minute = retryAfter <= MINUTE_LIMIT_MAX_SECONDS;
    return { status: "rate_limited", kind: minute ? "minute" : "day", retryAfter, key: minute ? "cvFailRateMin" : "cvFailRateDay" };
  }
  // Lost a race with another replace of the same cover: reload the event, then sending again is safe.
  if (status === 409 && code === "cover_changed") return { status: "error", key: "cvFailChanged", code, retryable: true };
  if (code === "invalid_upload" || code === "payload_too_large" || code === "unsupported_image_type" || code === "unsupported_media_type" || code === "validation_error") {
    // missing/unknown part, bad focal: our bug, not the organizer's image
    const ours = reason === "missing_part" || reason === "unknown_part" || reason === "bad_focal" || reason === "og_not_baseline" || reason === "og_size_invalid" || reason === "small_size_out_of_range" || reason === "aspect_mismatch";
    return { status: "error", key: ours ? "cvFailServer" : "cvFailRejected", code, reason, retryable: false };
  }
  if (code === "invalid_origin") return { status: "error", key: "cvFailServer", code, retryable: false };
  return { status: "error", key: "cvFailServer", code, reason, retryable: status >= 500 || status === 0 };
}

const parseOk = (body: any): CoverResult => {
  const parsed = panelCoverResponseSchema.safeParse(body);
  return parsed.success ? { status: "ok", cover: parsed.data.cover } : { status: "error", key: "cvFailServer", retryable: true };
};

function sendForm(method: "PUT" | "PATCH", path: string, form: FormData, opts: { onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<CoverResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE}/${path}`);
    xhr.setRequestHeader("Accept", "application/json"); // no Content-Type: the browser adds the multipart boundary
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onerror = xhr.ontimeout = () => resolve({ status: "error", key: "cvFailNet", retryable: true });
    xhr.onabort = () => resolve({ status: "aborted" });
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      resolve(xhr.status === 200 ? parseOk(body) : coverFailure(xhr.status, body, xhr.getResponseHeader("Retry-After")));
    };
    if (opts.signal) {
      if (opts.signal.aborted) return resolve({ status: "aborted" });
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

export type CoverUpload = { full: Blob; small: Blob; og: Blob; fx: number; fy: number };

/** PUT /panel/events/:id/cover: create or replace (idempotent). */
export function putCover(eventId: string, c: CoverUpload, opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<CoverResult> {
  const form = new FormData();
  const ext = c.full.type === "image/jpeg" ? "jpg" : "webp"; // JPEG where the browser can't encode WebP (Safari)
  form.append("full", c.full, `full.${ext}`);
  form.append("small", c.small, `small.${ext}`);
  form.append("og", c.og, "og.jpg");
  form.append("fx", String(c.fx));
  form.append("fy", String(c.fy));
  return sendForm("PUT", `${encodeURIComponent(eventId)}/cover`, form, opts);
}

/** PATCH /panel/events/:id/cover/focal: only the preview JPEG and the focal point. `baseVersion` is the stored cover's version. */
export function patchFocal(eventId: string, c: { og: Blob; fx: number; fy: number; baseVersion: string }, opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<CoverResult> {
  const form = new FormData();
  form.append("og", c.og, "og.jpg");
  form.append("fx", String(c.fx));
  form.append("fy", String(c.fy));
  form.append("baseVersion", c.baseVersion);
  return sendForm("PATCH", `${encodeURIComponent(eventId)}/cover/focal`, form, opts);
}

/** DELETE /panel/events/:id/cover: 204 even when there was none. */
export async function deleteCover(eventId: string): Promise<{ status: "ok" } | CoverFail> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/cover`, { method: "DELETE", headers: { Accept: "application/json" } });
    if (res.status === 204 || res.status === 200) return { status: "ok" };
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    return coverFailure(res.status, body, res.headers.get("Retry-After"));
  } catch {
    return { status: "error", key: "cvFailNet", retryable: true };
  }
}
