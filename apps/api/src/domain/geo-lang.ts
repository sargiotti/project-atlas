import { GEO_OVERRIDE_REGEX } from "@atlas/contract";

/**
 * Default language for a visitor from Cloudflare's `request.cf`: `ca` only when the country is exactly ES and
 * the region code is exactly CT (a bare "CT" is also Connecticut). Anything missing, malformed or different is
 * null. Never throws; the region is read once here and dropped, never stored, logged or used as a cache key.
 */
export function geoLang(cf: unknown): "ca" | null {
  try {
    if (typeof cf !== "object" || cf === null) return null;
    const raw = cf as Record<string, unknown>;
    return raw.country === "ES" && raw.regionCode === "CT" ? "ca" : null;
  } catch {
    return null;
  }
}

/**
 * Applies the `?geo=` override on top of the real result. A valid value is never echoed.
 * - null or invalid: the real result is used unchanged
 * - `ct`: "ca"; `none`: null
 */
export function applyGeoOverride(real: "ca" | null, geoParam: string | null): "ca" | null {
  if (geoParam === null) return real;
  const value = geoParam.toUpperCase();
  if (!GEO_OVERRIDE_REGEX.test(value)) return real;
  return value === "CT" ? "ca" : null;
}
