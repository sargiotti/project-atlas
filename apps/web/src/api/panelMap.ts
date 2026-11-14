import { panelMapResponseSchema, type PanelMap } from "@atlas/contract";

// Slice 08a: map upload client. XHR for the multipart POST (fetch has no upload progress), fetch for the theme PATCH.
// The server is the authority; this only maps its answers to message keys (peMap* in the i18n catalogs).
const BASE = "/api/v1/panel/events";

export type MapMessageKey =
  | "peMapRejected"
  | "peMapNotDraft"
  | "peMapChanged"
  | "peMapNetT"
  | "peMapServerS"
  | "peMapRateMinT"
  | "peMapRateDayT"
  | "peMapThemeFail";

export type MapFail =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "rate_limited"; kind: "minute" | "day"; retryAfter: number; key: MapMessageKey }
  | { status: "aborted" }
  | { status: "error"; key: MapMessageKey; code?: string; reason?: string; retryable: boolean };
export type MapResult = { status: "ok"; map: PanelMap } | MapFail;

/** `error.reason` values of 400 invalid_upload (contract). All mean "this image can't be used": re-export it. */
export const INVALID_UPLOAD_REASONS = [
  "missing_part", "unknown_part", "bad_theme", "corrupt_image", "mixed_formats", "full_size_out_of_range",
  "small_size_out_of_range", "aspect_out_of_range", "aspect_mismatch", "metadata_present",
] as const;
const REASON_KEY: Record<(typeof INVALID_UPLOAD_REASONS)[number], MapMessageKey> = {
  missing_part: "peMapServerS", // our bug, not the organizer's image
  unknown_part: "peMapServerS",
  bad_theme: "peMapServerS",
  mixed_formats: "peMapServerS",
  aspect_mismatch: "peMapServerS",
  corrupt_image: "peMapRejected",
  full_size_out_of_range: "peMapRejected",
  small_size_out_of_range: "peMapServerS",
  aspect_out_of_range: "peMapRejected",
  metadata_present: "peMapRejected",
};

/** Retry-After up to this many seconds is the per-minute limiter (shown as a countdown); more is the daily quota. */
export const MINUTE_LIMIT_MAX_SECONDS = 120;

/** Pure: HTTP status + error body + Retry-After header -> outcome. */
export function mapFailure(status: number, body: any, retryAfterHeader: string | null): MapFail {
  const code: string | undefined = typeof body?.error?.code === "string" ? body.error.code : undefined;
  const reason: string | undefined = typeof body?.error?.reason === "string" ? body.error.reason : undefined;
  if (status === 401) return { status: "unauthenticated" };
  if (status === 404) return { status: "not_found" }; // event_not_found / map_not_found: never probe further
  if (status === 429) {
    const n = Number(retryAfterHeader);
    const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60;
    const minute = retryAfter <= MINUTE_LIMIT_MAX_SECONDS;
    return { status: "rate_limited", kind: minute ? "minute" : "day", retryAfter, key: minute ? "peMapRateMinT" : "peMapRateDayT" };
  }
  if (status === 409 && code === "event_not_draft") return { status: "error", key: "peMapNotDraft", code, retryable: false };
  // Lost a race with another replace of the same event: the card reloads the event; sending again is safe.
  if (status === 409 && code === "map_changed") return { status: "error", key: "peMapChanged", code, retryable: true };
  if (status === 400 && code === "invalid_upload") {
    const key = (REASON_KEY as Record<string, MapMessageKey>)[reason ?? ""] ?? "peMapRejected";
    return { status: "error", key, code, reason, retryable: false };
  }
  if (code === "payload_too_large" || code === "unsupported_image_type" || code === "unsupported_media_type" || code === "validation_error") {
    return { status: "error", key: "peMapRejected", code, retryable: false };
  }
  if (code === "invalid_origin") return { status: "error", key: "peMapServerS", code, retryable: false };
  return { status: "error", key: "peMapServerS", code, reason, retryable: status >= 500 || status === 0 };
}

export type UploadInput = { full: Blob; small: Blob; theme: "light" | "dark" };

/** POST /panel/events/:id/map. `onProgress` gets 0..1 of the request body (true progress needs XHR). */
export function uploadMap(eventId: string, input: UploadInput, opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}): Promise<MapResult> {
  return new Promise((resolve) => {
    const ext = input.full.type === "image/webp" ? "webp" : "jpg";
    const form = new FormData();
    form.append("full", input.full, `full.${ext}`);
    form.append("small", input.small, `small.${ext}`);
    form.append("theme", input.theme);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/${encodeURIComponent(eventId)}/map`);
    xhr.setRequestHeader("Accept", "application/json"); // no Content-Type: the browser adds the multipart boundary
    xhr.upload.onprogress = (e) => e.lengthComputable && opts.onProgress?.(e.loaded / e.total);
    xhr.onerror = xhr.ontimeout = () => resolve({ status: "error", key: "peMapNetT", retryable: true });
    xhr.onabort = () => resolve({ status: "aborted" });
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 200) {
        const parsed = panelMapResponseSchema.safeParse(body);
        return resolve(parsed.success ? { status: "ok", map: parsed.data.map } : { status: "error", key: "peMapServerS", retryable: true });
      }
      resolve(mapFailure(xhr.status, body, xhr.getResponseHeader("Retry-After")));
    };
    if (opts.signal) {
      if (opts.signal.aborted) return resolve({ status: "aborted" });
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** PATCH /panel/events/:id/map/theme (override). */
export async function setMapTheme(eventId: string, theme: "light" | "dark"): Promise<MapResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}/map/theme`, {
      method: "PATCH",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    if (res.ok) {
      const parsed = panelMapResponseSchema.safeParse(body);
      if (parsed.success) return { status: "ok", map: parsed.data.map };
      return { status: "error", key: "peMapThemeFail", retryable: true };
    }
    const f = mapFailure(res.status, body, res.headers.get("Retry-After"));
    // A theme save failure always reads "couldn't save the map theme" except where the whole screen must change.
    return f.status === "error" ? { ...f, key: f.key === "peMapNotDraft" || f.key === "peMapChanged" ? f.key : "peMapThemeFail" } : f;
  } catch {
    return { status: "error", key: "peMapThemeFail", retryable: true };
  }
}
