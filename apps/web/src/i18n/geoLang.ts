import { geoLangSchema } from "@atlas/contract";
import { isLang } from "./detect";
import type { Lang } from "./messages";

/**
 * Catalonia default language (slice 21b). The server answers { lang: "ca" | null } from the request's coarse location.
 * The result is used in memory only: never written to atlas.lang, any storage or cookie, and never sent to analytics.
 */
const TIMEOUT_MS = 1500;
let pending: Promise<Lang | null> | null = null;
let resolved: Lang | null = null;

/** Debug override for validation outside Catalonia: ?geo=ct or ?geo=none (forwarded, never persisted). */
export function geoOverride(search: string): "ct" | "none" | null {
  const raw = new URLSearchParams(search).get("geo")?.toLowerCase();
  return raw === "ct" || raw === "none" ? raw : null;
}

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** Ask only when there is no stored choice (caller checks) and the device timezone is Europe/Madrid. The zone never leaves the device. */
export function shouldAskGeo(search = typeof window !== "undefined" ? window.location.search : ""): boolean {
  return geoOverride(search) !== null || timeZone() === "Europe/Madrid";
}

async function request(search: string): Promise<Lang | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const override = geoOverride(search);
    const qs = override ? `?${new URLSearchParams({ geo: override })}` : "";
    const res = await fetch(`/api/v1/geo-lang${qs}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const { lang } = geoLangSchema.parse(await res.json());
    return isLang(lang) ? lang : null;
  } catch {
    return null; // error, timeout, 429, bad shape: fall back silently, no retry
  } finally {
    clearTimeout(timer);
  }
}

/** One request per page load, shared by the visitor and panel providers. */
export function fetchGeoLang(search = typeof window !== "undefined" ? window.location.search : ""): Promise<Lang | null> {
  pending ??= request(search).then((l) => (resolved = l));
  return pending;
}

/** Answer already received this page load (sync), else null. */
export function knownGeoLang(): Lang | null {
  return resolved;
}

/** Test helper. */
export function resetGeoLang() {
  pending = null;
  resolved = null;
}
